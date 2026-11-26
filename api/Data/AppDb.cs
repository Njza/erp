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

/// A part that can be picked on a bill. Bills copy the name and unit as text, so a product
/// can be renamed or deleted without changing old bills. Deleting is soft, see NameOption. No price: prices are typed per bill.
public class Product
{
    public int Id { get; set; }
    public required string Name { get; set; } // unique
    public required string Unit { get; set; } // 台, 个, 条, ...
    public DateTime? DeletedAt { get; set; }  // soft delete: hidden from lists, restored when the name is used again
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// A name offered in a suggestion list of the bill page: a customer (使用单位), a handler (经手人)
/// or an installer (维修安装员). Bills copy the name as text, so renaming or deleting one
/// never changes an old bill. Deleting is soft: the row stays and comes back when the name is used again.
public class NameOption
{
    public int Id { get; set; }
    public required string Kind { get; set; } // one of NameKind
    public required string Name { get; set; } // unique within its kind, deleted rows included
    public DateTime? DeletedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public static class NameKind
{
    public const string Customer = "customer";
    public const string Handler = "handler";
    public const string Installer = "installer";
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
    public int PrintCount { get; set; }         // how many times the print dialog was opened for this bill
    public DateTime? LastPrintedAt { get; set; }
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
            e.OwnsMany(x => x.Rows, rows => rows.ToJson());
        });
    }
}
