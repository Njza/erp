using Microsoft.EntityFrameworkCore;

namespace Erp.Api;

public class AppDb(DbContextOptions<AppDb> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Role> Roles => Set<Role>();
    public DbSet<PartsBill> PartsBills => Set<PartsBill>();
    public DbSet<Product> Products => Set<Product>();
    public DbSet<NameOption> NameOptions => Set<NameOption>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<User>().HasIndex(u => u.Username).IsUnique();
        b.Entity<Role>().HasIndex(r => r.Name).IsUnique();
        b.Entity<Product>().HasIndex(p => p.Name).IsUnique();
        b.Entity<NameOption>().HasIndex(n => new { n.Kind, n.Name }).IsUnique();
        b.Entity<PartsBill>(e =>
        {
            e.HasIndex(x => x.No).IsUnique();
            e.Property(x => x.Total).HasPrecision(18, 2);
            e.ComplexCollection(x => x.Rows, rows => rows.ToJson());
        });
    }
}
