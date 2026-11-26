using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Erp.Api;

public record LoginRequest(
    [Required(ErrorMessage = "请输入用户名。")] string Username,
    [Required(ErrorMessage = "请输入密码。")] string Password);

public record ChangePasswordRequest(
    [Required(ErrorMessage = "请输入当前密码。")] string CurrentPassword,
    [Required(ErrorMessage = "请输入新密码。"), MinLength(8, ErrorMessage = "密码至少 8 位。")] string NewPassword);

public static class AuthEndpoints
{
    public static readonly PasswordHasher<User> Hasher = new();
    // Checked when the username does not exist, so that answer takes as long as a wrong password.
    static readonly string DummyHash = Hasher.HashPassword(null!, Guid.NewGuid().ToString());

    const int MaxFailedLogins = 5;
    static readonly TimeSpan LockoutTime = TimeSpan.FromMinutes(15);

    public static void MapAuth(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/auth");

        g.MapPost("/login", async (LoginRequest req, AppDb db, TokenService tokens, HttpContext http, IHostEnvironment env) =>
        {
            var username = req.Username.Trim().ToLowerInvariant();
            var user = await db.Users.SingleOrDefaultAsync(u => u.Username == username);
            var now = DateTime.UtcNow;
            var locked = user?.LockedUntil > now;
            // One message for every failure, a locked account included, so the response does not reveal which usernames exist.
            var result = Hasher.VerifyHashedPassword(user!, user?.PasswordHash ?? DummyHash, req.Password);
            if (user is null || !user.IsActive || locked || result == PasswordVerificationResult.Failed)
            {
                if (user is not null && !locked && result == PasswordVerificationResult.Failed)
                    await CountFailedLogin(db, user.Id, now);
                throw new AppException(401, "INVALID_CREDENTIALS", $"用户名或密码错误。连续输错 {MaxFailedLogins} 次，账号将锁定 {LockoutTime.TotalMinutes} 分钟。");
            }
            user.FailedLogins = 0;
            user.LockedUntil = null;
            if (result == PasswordVerificationResult.SuccessRehashNeeded)
                user.PasswordHash = Hasher.HashPassword(user, req.Password); // the framework raised the hash strength since this password was stored
            await db.SaveChangesAsync();

            return new { expiresAt = SignIn(http, env, tokens, user) };
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

        // Every signed-in user changes their own password here. Other sessions of this user end; this one gets a new cookie.
        g.MapPost("/password", async (ChangePasswordRequest req, ClaimsPrincipal principal, AppDb db, TokenService tokens, HttpContext http, IHostEnvironment env) =>
        {
            var user = await db.Users.SingleAsync(u => u.Id == principal.UserId());
            if (Hasher.VerifyHashedPassword(user, user.PasswordHash, req.CurrentPassword) == PasswordVerificationResult.Failed)
                throw new AppException(400, "WRONG_PASSWORD", "当前密码不正确。");
            user.PasswordHash = Hasher.HashPassword(user, req.NewPassword);
            user.TokenVersion++;
            await db.SaveChangesAsync();
            SignIn(http, env, tokens, user);
            return Results.NoContent();
        }).RequireActiveUser().RequireRateLimiting("login"); // limited like login: a stolen session must not guess the password
    }

    /// The token goes out only in the cookie, never in the body, so a script cannot get it.
    static DateTime SignIn(HttpContext http, IHostEnvironment env, TokenService tokens, User user)
    {
        var (token, expiresAt) = tokens.Create(user);
        http.Response.Cookies.Append(AuthExtensions.TokenCookie, token, AuthExtensions.TokenCookieOptions(env, expiresAt));
        return expiresAt;
    }

    /// One UPDATE in the database, so wrong passwords sent at the same moment are all counted.
    /// The count restarts at a lockout, so after it ends the user has MaxFailedLogins tries again.
    static Task CountFailedLogin(AppDb db, int userId, DateTime now) =>
        db.Users.Where(u => u.Id == userId).ExecuteUpdateAsync(s => s
            .SetProperty(u => u.LockedUntil, u => u.FailedLogins + 1 >= MaxFailedLogins ? now + LockoutTime : u.LockedUntil)
            .SetProperty(u => u.FailedLogins, u => u.FailedLogins + 1 >= MaxFailedLogins ? 0 : u.FailedLogins + 1));
}
