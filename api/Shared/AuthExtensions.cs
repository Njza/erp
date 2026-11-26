using System.Security.Claims;
using Microsoft.EntityFrameworkCore;

namespace Erp.Api;

public static class AuthExtensions
{
    /// The browser keeps the login token in this HttpOnly cookie, so no script on the page can read it.
    public const string TokenCookie = "erp_token";
    /// The cookie counts only on a request with this header. Another site cannot add a header to a
    /// request it makes the browser send, so it cannot use the visitor's cookie (CSRF).
    public const string CsrfHeader = "X-Requested-With";

    public static CookieOptions TokenCookieOptions(IHostEnvironment env, DateTimeOffset? expires = null) => new()
    {
        HttpOnly = true,
        Secure = !env.IsDevelopment(), // development runs on plain http://localhost
        SameSite = SameSiteMode.Strict,
        Path = "/api",
        Expires = expires,
    };

    public static int UserId(this ClaimsPrincipal user) => int.Parse(user.FindFirstValue("sub")!);

    /// A token from before this claim existed counts as version 0, so it keeps working until the password changes.
    public static int TokenVersion(this ClaimsPrincipal user) => int.TryParse(user.FindFirstValue("ver"), out var v) ? v : 0;

    /// Refuses unless the signed-in user holds every one of these permissions, so that nobody with
    /// role.write or user.write can give out (to themself or anyone) more than they have.
    public static async Task EnsureHolds(this ClaimsPrincipal principal, AppDb db, IEnumerable<string> permissions)
    {
        var id = principal.UserId();
        var mine = (await db.Users.Where(u => u.Id == id).SelectMany(u => u.Roles.Select(r => r.Permissions)).ToListAsync())
            .SelectMany(p => p);
        var missing = permissions.Except(mine).ToArray();
        if (missing.Length > 0)
            throw new AppException(403, "PERMISSION_NOT_HELD", $"不能授予或改动您自己没有的权限：{string.Join("、", missing)}");
    }

    /// The token's id; null on tokens from before ids were added (they cannot be revoked one by one, and expire within 8 hours).
    public static string? TokenId(this ClaimsPrincipal user) => user.FindFirstValue("jti");

    public static AppException TokenExpired() => new(401, "TOKEN_EXPIRED", "登录已失效，请重新登录。");

    /// Permissions are read from the database on each request, so a role change
    /// or a disabled account takes effect at once, not when the token expires.
    public static RouteHandlerBuilder RequirePermission(this RouteHandlerBuilder builder, string code) =>
        builder.RequireActiveUser(code);

    /// For data every signed-in user may read. Still checks the database, so a disabled account is refused at once.
    public static RouteHandlerBuilder RequireActiveUser(this RouteHandlerBuilder builder) =>
        builder.RequireActiveUser(null);

    static RouteHandlerBuilder RequireActiveUser(this RouteHandlerBuilder builder, string? code) =>
        builder.RequireAuthorization().AddEndpointFilter(async (ctx, next) =>
        {
            var db = ctx.HttpContext.RequestServices.GetRequiredService<AppDb>();
            var principal = ctx.HttpContext.User;
            var userId = principal.UserId();
            var jti = principal.TokenId();
            var user = await db.Users.Where(u => u.Id == userId && u.IsActive)
                .Select(u => new
                {
                    u.TokenVersion,
                    Allowed = code == null || u.Roles.Any(r => r.Permissions.Contains(code)),
                    Revoked = jti != null && db.RevokedTokens.Any(t => t.Id == jti),
                })
                .SingleOrDefaultAsync();
            if (user is not null && (user.Revoked || user.TokenVersion != principal.TokenVersion())) throw TokenExpired();
            if (user is not { Allowed: true }) throw new AppException(403, "FORBIDDEN", "您没有权限执行此操作。");
            return await next(ctx);
        });
}
