using System.Security.Claims;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Erp.Api;

public class TokenService(SymmetricSecurityKey key)
{
    public const string Issuer = "erp";
    // shortcut: one 8-hour access token, no refresh token; upgrade when sessions must outlive 8 hours.
    // Signing out revokes it (RevokedToken); a password change revokes all of a user's tokens (TokenVersion).
    static readonly TimeSpan Lifetime = TimeSpan.FromHours(8);

    public (string Token, DateTime ExpiresAt) Create(User user)
    {
        var expires = DateTime.UtcNow.Add(Lifetime);
        var token = new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = Issuer,
            Subject = new ClaimsIdentity([new Claim("sub", user.Id.ToString()), new Claim("ver", user.TokenVersion.ToString()), new Claim("jti", Guid.NewGuid().ToString())]),
            Expires = expires,
            SigningCredentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256),
        });
        return (token, expires);
    }
}
