namespace Erp.Api;

/// A signed-out token. It stays valid by its signature until it expires, so its id is refused until then.
public class RevokedToken
{
    public required string Id { get; set; } // the token's "jti"
    public DateTime ExpiresAt { get; set; }  // after this the token is refused anyway, and the row may go
}
