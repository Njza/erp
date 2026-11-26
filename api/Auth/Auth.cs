using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Erp.Api;

/// The permission catalog. Add a constant here, then use it in RequirePermission(...).
/// Convention: "<module>.<action>". The admin role receives every code at startup.
public static class Perm
{
    public const string UserRead = "user.read";
    public const string UserWrite = "user.write";
    public const string RoleRead = "role.read";
    public const string RoleWrite = "role.write";
    public const string BillRead = "bill.read";
    public const string BillWrite = "bill.write";
    public const string ProductWrite = "product.write";

    public static readonly string[] All =
        [.. typeof(Perm).GetFields().Where(f => f.IsLiteral).Select(f => (string)f.GetRawConstantValue()!)];
}

public class TokenService(SymmetricSecurityKey key)
{
    public const string Issuer = "erp";
    // shortcut: one 8-hour access token, no refresh token or server-side revocation;
    // upgrade when sessions must outlive 8 hours or be revoked at once.
    static readonly TimeSpan Lifetime = TimeSpan.FromHours(8);

    public (string Token, DateTime ExpiresAt) Create(User user)
    {
        var expires = DateTime.UtcNow.Add(Lifetime);
        var token = new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = Issuer,
            Subject = new ClaimsIdentity([new Claim("sub", user.Id.ToString())]),
            Expires = expires,
            SigningCredentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256),
        });
        return (token, expires);
    }
}

public static class AuthExtensions
{
    public static int UserId(this ClaimsPrincipal user) => int.Parse(user.FindFirstValue("sub")!);

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
            var userId = ctx.HttpContext.User.UserId();
            var allowed = await db.Users.AnyAsync(u =>
                u.Id == userId && u.IsActive && (code == null || u.Roles.Any(r => r.Permissions.Contains(code))));
            if (!allowed) throw new AppException(403, "FORBIDDEN", "您没有权限执行此操作。");
            return await next(ctx);
        });
}
