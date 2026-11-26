using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Erp.Api;

public record LoginRequest(
    [Required(ErrorMessage = "请输入用户名。")] string Username,
    [Required(ErrorMessage = "请输入密码。")] string Password);

public static class AuthEndpoints
{
    public static readonly PasswordHasher<User> Hasher = new();

    public static void MapAuth(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/auth");

        g.MapPost("/login", async (LoginRequest req, AppDb db, TokenService tokens) =>
        {
            var username = req.Username.Trim().ToLowerInvariant();
            var user = await db.Users.SingleOrDefaultAsync(u => u.Username == username);
            // One message for every failure, so the response does not reveal which usernames exist.
            if (user is null || !user.IsActive ||
                Hasher.VerifyHashedPassword(user, user.PasswordHash, req.Password) == PasswordVerificationResult.Failed)
                throw new AppException(401, "INVALID_CREDENTIALS", "用户名或密码错误。");

            var (token, expiresAt) = tokens.Create(user);
            return new { token, expiresAt };
        }).RequireRateLimiting("login");

        g.MapGet("/me", async (ClaimsPrincipal principal, AppDb db) =>
        {
            var id = principal.UserId();
            var me = await db.Users.Where(u => u.Id == id && u.IsActive)
                .Select(u => new { u.Id, u.Username, u.DisplayName, Permissions = u.Roles.Select(r => r.Permissions).ToList() })
                .SingleOrDefaultAsync()
                ?? throw new AppException(401, "ACCOUNT_DISABLED", "您的账号已被停用。");
            return new { me.Id, me.Username, me.DisplayName, Permissions = me.Permissions.SelectMany(p => p).Distinct() };
        }).RequireAuthorization();
    }
}
