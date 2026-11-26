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

/// A printed "更换配件清单". The company header is not stored: it comes from the print settings.
public class PartsBill
{
    public int Id { get; set; }
    public required string No { get; set; } // 单据编号, unique
    public DateOnly Date { get; set; }
    public string Handler { get; set; } = "";   // 经手人
    public string Customer { get; set; } = "";  // 使用单位
    public string Picker { get; set; } = "";    // 出仓领件人
    public string Installer { get; set; } = ""; // 维修安装员
    public string Receiver { get; set; } = "";  // 使用单位收货人
    public bool Settle { get; set; }            // 配件更换完毕即结算
    public bool Warranty { get; set; }          // 配件保修半年，易损件除外
    public List<PartsBillRow> Rows { get; set; } = []; // stored as one JSON column, in print order
    public decimal Total { get; set; }          // computed by the server from Rows
    public int CreatedById { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// One printed line. A line with only a name is a note (for example a part serial number).
public class PartsBillRow
{
    public string Name { get; set; } = "";
    public string Unit { get; set; } = "";    // 单位（梯号）
    public decimal? Qty { get; set; }
    public string QtyUnit { get; set; } = ""; // 台, 个, ...
    public decimal? Price { get; set; }
}

public class AppDb(DbContextOptions<AppDb> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Role> Roles => Set<Role>();
    public DbSet<PartsBill> PartsBills => Set<PartsBill>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<User>().HasIndex(u => u.Username).IsUnique();
        b.Entity<Role>().HasIndex(r => r.Name).IsUnique();
        b.Entity<PartsBill>(e =>
        {
            e.HasIndex(x => x.No).IsUnique();
            e.Property(x => x.Total).HasPrecision(18, 2);
            e.OwnsMany(x => x.Rows, rows => rows.ToJson());
        });
    }
}
