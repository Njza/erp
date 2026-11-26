using System.Text;
using System.Threading.RateLimiting;
using Erp.Api;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);
var cfg = builder.Configuration;

var jwtKeyText = cfg["Jwt:Key"] ?? "";
if (jwtKeyText.Length < 32) throw new InvalidOperationException("Set Jwt:Key to a random secret of at least 32 characters.");
var jwtKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKeyText));

builder.Services.AddHttpContextAccessor(); // AppDb reads the signed-in user for the audit log
builder.Services.AddDbContext<AppDb>(o => o.UseNpgsql(cfg.GetConnectionString("Default")));
builder.Services.AddSingleton(new TokenService(jwtKey));

// Error contract: every non-2xx response is ProblemDetails with a "code" (see Shared/Errors.cs).
builder.Services.AddProblemDetails(o => o.CustomizeProblemDetails = c =>
{
    // No "code" yet means the framework wrote this response (not AppExceptionHandler): give it a code and a Chinese title.
    var p = c.ProblemDetails;
    if (!p.Extensions.TryAdd("code", $"HTTP_{p.Status}")) return;
    p.Title = p.Status switch
    {
        400 => "提交的数据有误。",
        401 => "请先登录。",
        403 => "您没有权限执行此操作。",
        404 => "请求的资源不存在。",
        429 => "操作过于频繁，请稍后再试。",
        _ => $"请求失败（{p.Status}）。",
    };
});
builder.Services.AddExceptionHandler<AppExceptionHandler>();
// Development throws on an unreadable request body and Production does not; make both throw,
// so the error handler gives the same response in every environment.
builder.Services.Configure<Microsoft.AspNetCore.Routing.RouteHandlerOptions>(o => o.ThrowOnBadRequest = true);
builder.Services.AddValidation(); // DataAnnotations on request records -> 400 with "errors"

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(o =>
{
    o.MapInboundClaims = false; // keep "sub" as "sub"
    o.TokenValidationParameters = new()
    {
        ValidIssuer = TokenService.Issuer,
        ValidateAudience = false,
        IssuerSigningKey = jwtKey,
        ValidAlgorithms = [SecurityAlgorithms.HmacSha256],
    };
    // Browsers send the token in a cookie (see AuthExtensions.TokenCookie); programs may send an Authorization header.
    o.Events = new()
    {
        OnMessageReceived = ctx =>
        {
            var req = ctx.Request;
            if (!req.Headers.ContainsKey("Authorization") && req.Headers.ContainsKey(AuthExtensions.CsrfHeader)
                && req.Cookies.TryGetValue(AuthExtensions.TokenCookie, out var token))
                ctx.Token = token;
            return Task.CompletedTask;
        },
    };
});
builder.Services.AddAuthorization();

// The client IP (used by the login rate limit) comes from X-Forwarded-For only when the request comes
// from ForwardedHeaders:KnownNetwork, the web container's network. Any other sender, such as another
// container on the shared database network, is counted under its own address and cannot fake one.
builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor;
    o.KnownIPNetworks.Clear();
    o.KnownProxies.Clear();
    foreach (var network in (cfg["ForwardedHeaders:KnownNetwork"] ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        o.KnownIPNetworks.Add(System.Net.IPNetwork.Parse(network));
});

builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = 429;
    // shortcut: counted per client IP in this process; with several instances move the counter to a shared store.
    o.AddPolicy("login", http => RateLimitPartition.GetFixedWindowLimiter(
        http.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new() { PermitLimit = 10, Window = TimeSpan.FromMinutes(1) }));
});

var app = builder.Build();

app.UseForwardedHeaders();
app.UseExceptionHandler();
app.UseStatusCodePages(); // gives bare 401/403/404/429 the same ProblemDetails body
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();

var api = app.MapGroup("/api");
api.MapAuth();
api.MapUsers();
api.MapRoles();
api.MapPartsBills();
api.MapProducts();
api.MapNames();
api.MapAudit();
// The release tag this build came from (App:Version, set by deploy.sh); "dev" on a local build.
api.MapGet("/version", () => new { version = cfg["App:Version"] ?? "dev" }).RequireAuthorization();

await DbInit.RunAsync(app.Services, cfg);
app.Run();
