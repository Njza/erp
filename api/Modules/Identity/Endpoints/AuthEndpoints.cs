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
    // Checked when the username does not exist, so that answer takes as long as a wrong password.
    static readonly string DummyHash = Hasher.HashPassword(null!, Guid.NewGuid().ToString());

    public static void MapAuth(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/auth");

        g.MapPost("/login", async (LoginRequest req, AppDb db, TokenService tokens, HttpContext http, IHostEnvironment env) =>
        {
            var username = req.Username.Trim().ToLowerInvariant();
            var user = await db.Users.SingleOrDefaultAsync(u => u.Username == username);
            // One message for every failure, so the response does not reveal which usernames exist.
            var result = Hasher.VerifyHashedPassword(user!, user?.PasswordHash ?? DummyHash, req.Password);
            if (user is null || !user.IsActive || result == PasswordVerificationResult.Failed)
                throw new AppException(401, "INVALID_CREDENTIALS", "用户名或密码错误。");
            if (result == PasswordVerificationResult.SuccessRehashNeeded)
            {
                // The framework raised the hash strength since this password was stored: store it again.
                user.PasswordHash = Hasher.HashPassword(user, req.Password);
                await db.SaveChangesAsync();
            }

            var (token, expiresAt) = tokens.Create(user);
            // The token goes out only in the cookie, never in the body, so a script cannot get it.
            http.Response.Cookies.Append(AuthExtensions.TokenCookie, token, AuthExtensions.TokenCookieOptions(env, expiresAt));
            return new { expiresAt };
        }).RequireRateLimiting("login");

        // Open to everyone: it only removes the cookie from this browser.
        g.MapPost("/logout", (HttpContext http, IHostEnvironment env) =>
        {
            http.Response.Cookies.Delete(AuthExtensions.TokenCookie, AuthExtensions.TokenCookieOptions(env));
            return Results.NoContent();
        });

        g.MapGet("/me", async (ClaimsPrincipal principal, AppDb db) =>
        {
            var id = principal.UserId();
            var me = await db.Users.Where(u => u.Id == id && u.IsActive)
                .Select(u => new { u.Id, u.Username, u.DisplayName, u.TokenVersion, Permissions = u.Roles.Select(r => r.Permissions).ToList() })
                .SingleOrDefaultAsync()
                ?? throw new AppException(401, "ACCOUNT_DISABLED", "您的账号已被停用。");
            if (me.TokenVersion != principal.TokenVersion()) throw AuthExtensions.TokenExpired();
            return new { me.Id, me.Username, me.DisplayName, Permissions = me.Permissions.SelectMany(p => p).Distinct() };
        }).RequireAuthorization();
    }
}
