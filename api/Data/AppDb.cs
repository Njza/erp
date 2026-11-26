using Microsoft.EntityFrameworkCore;

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

public class Role
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public string[] Permissions { get; set; } = []; // codes from Perm; a Postgres text[]
    public List<User> Users { get; set; } = [];
}

public class AppDb(DbContextOptions<AppDb> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Role> Roles => Set<Role>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<User>().HasIndex(u => u.Username).IsUnique();
        b.Entity<Role>().HasIndex(r => r.Name).IsUnique();
    }
}
