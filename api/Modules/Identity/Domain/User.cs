namespace Erp.Api;

public class User
{
    public int Id { get; set; }
    public required string Username { get; set; } // stored lower-case
    public required string DisplayName { get; set; }
    public string PasswordHash { get; set; } = "";
    public bool IsActive { get; set; } = true;
    public int TokenVersion { get; set; } // copied into each token; a password change adds one, so older tokens stop working
    public int FailedLogins { get; set; }       // wrong passwords in a row; reset by a good login or a lockout
    public DateTime? LockedUntil { get; set; }   // set after MaxFailedLogins wrong passwords; login is refused until then
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public List<Role> Roles { get; set; } = [];
}
