namespace Erp.Api;

public class User
{
    public int Id { get; set; }
    public required string Username { get; set; } // stored lower-case
    public required string DisplayName { get; set; }
    public string PasswordHash { get; set; } = "";
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public List<Role> Roles { get; set; } = [];
}
