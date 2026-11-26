using System.Security.Claims;
using Microsoft.EntityFrameworkCore;

namespace Erp.Api;

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
