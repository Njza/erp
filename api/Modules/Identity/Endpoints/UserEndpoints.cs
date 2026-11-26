using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;

namespace Erp.Api;

public record CreateUserRequest(
    [Required(ErrorMessage = "请输入用户名。"), RegularExpression("^[A-Za-z0-9._-]{3,50}$", ErrorMessage = "用户名须为 3-50 位字母、数字、“.”、“_”或“-”。")] string Username,
    [Required(ErrorMessage = "请输入姓名。"), MaxLength(100, ErrorMessage = "姓名不能超过 100 个字符。")] string DisplayName,
    [Required(ErrorMessage = "请输入密码。"), MinLength(8, ErrorMessage = "密码至少 8 位。")] string Password,
    int[] RoleIds);

public record UpdateUserRequest(
    [Required(ErrorMessage = "请输入姓名。"), MaxLength(100, ErrorMessage = "姓名不能超过 100 个字符。")] string DisplayName,
    bool IsActive,
    int[] RoleIds,
    [MinLength(8, ErrorMessage = "密码至少 8 位。")] string? Password); // null keeps the current password

public static class UserEndpoints
{
    public static void MapUsers(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/users");

        // shortcut: returns every user, no paging or search; add both before the list passes a few hundred rows.
        g.MapGet("", async (AppDb db) => await db.Users.OrderBy(u => u.Username)
            .Select(u => new { u.Id, u.Username, u.DisplayName, u.IsActive, RoleIds = u.Roles.Select(r => r.Id) })
            .ToListAsync()).RequirePermission(Perm.UserRead);

        g.MapPost("", async (CreateUserRequest req, AppDb db) =>
        {
            var user = new User
            {
                Username = req.Username.ToLowerInvariant(),
                DisplayName = req.DisplayName.Trim(),
                Roles = await db.Roles.Where(r => req.RoleIds.Contains(r.Id)).ToListAsync(),
            };
            user.PasswordHash = AuthEndpoints.Hasher.HashPassword(user, req.Password);
            db.Users.Add(user);
            await db.SaveChangesAsync(); // a duplicate username becomes 409 in AppExceptionHandler
            return new { user.Id };
        }).RequirePermission(Perm.UserWrite);

        g.MapPut("/{id:int}", async (int id, UpdateUserRequest req, ClaimsPrincipal principal, AppDb db) =>
        {
            var user = await db.Users.Include(u => u.Roles).SingleOrDefaultAsync(u => u.Id == id)
                ?? throw new AppException(404, "NOT_FOUND", "用户不存在。");
            var roles = await db.Roles.Where(r => req.RoleIds.Contains(r.Id)).ToListAsync();

            // Guard against an administrator locking themself out.
            if (id == principal.UserId() && (!req.IsActive || !roles.Any(r => r.Permissions.Contains(Perm.UserWrite))))
                throw new AppException(400, "SELF_LOCKOUT", "不能停用自己的账号，也不能移除自己的用户管理权限。");

            user.DisplayName = req.DisplayName.Trim();
            user.IsActive = req.IsActive;
            user.Roles = roles;
            if (req.Password is not null)
            {
                user.PasswordHash = AuthEndpoints.Hasher.HashPassword(user, req.Password);
                user.TokenVersion++; // signs this user out everywhere, the administrator included when it is their own password
            }
            await db.SaveChangesAsync();
            return Results.NoContent();
        }).RequirePermission(Perm.UserWrite);
    }
}
