using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;

namespace Erp.Api;

public class AppDb(DbContextOptions<AppDb> options, IHttpContextAccessor http) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Role> Roles => Set<Role>();
    public DbSet<PartsBill> PartsBills => Set<PartsBill>();
    public DbSet<Product> Products => Set<Product>();
    public DbSet<NameOption> NameOptions => Set<NameOption>();
    public DbSet<RevokedToken> RevokedTokens => Set<RevokedToken>();
    public DbSet<AuditEntry> AuditEntries => Set<AuditEntry>();

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
        b.Entity<AuditEntry>(e =>
        {
            e.Property(x => x.Changes).HasColumnType("jsonb");
            e.HasIndex(x => new { x.Entity, x.EntityId });
            e.HasIndex(x => x.At);
        });
    }

    // Never written to the audit log: the hash is secret, and the login counters change on every wrong password.
    static readonly HashSet<string> Hidden = [nameof(User.PasswordHash)];
    static readonly HashSet<string> Skipped = [nameof(User.FailedLogins), nameof(User.LockedUntil), nameof(PartsBill.UpdatedAt)];

    /// Saves, and in the same transaction writes one AuditEntry per created, changed or deleted record.
    public override async Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken ct = default)
    {
        var changed = ChangeTracker.Entries()
            .Where(e => e.Entity is not AuditEntry and not RevokedToken && e.State is EntityState.Added or EntityState.Modified or EntityState.Deleted)
            .Select(e => (Entry: e, Action: e.State.ToString(), Changes: Describe(e)))
            .Where(c => c.Action != nameof(EntityState.Modified) || c.Changes.Count > 0)
            .ToList();
        if (changed.Count == 0) return await base.SaveChangesAsync(acceptAllChangesOnSuccess, ct);

        await using var tx = Database.CurrentTransaction is null ? await Database.BeginTransactionAsync(ct) : null;
        var result = await base.SaveChangesAsync(acceptAllChangesOnSuccess, ct); // new records get their ids here
        var userId = http.HttpContext?.User.FindFirst("sub")?.Value;
        AuditEntries.AddRange(changed.Select(c => new AuditEntry
        {
            UserId = int.TryParse(userId, out var id) ? id : null,
            Action = c.Action,
            Entity = c.Entry.Metadata.ShortName(),
            EntityId = string.Join(",", c.Entry.Properties.Where(p => p.Metadata.IsPrimaryKey()).Select(p => p.CurrentValue)),
            Changes = JsonSerializer.Serialize(c.Changes),
        }));
        await base.SaveChangesAsync(acceptAllChangesOnSuccess, ct);
        if (tx is not null) await tx.CommitAsync(ct);
        return result;
    }

    static Dictionary<string, object?> Describe(EntityEntry e)
    {
        var values = new Dictionary<string, object?>();
        foreach (var p in e.Properties.Where(p => !Skipped.Contains(p.Metadata.Name)))
        {
            object? Shown(object? v) => Hidden.Contains(p.Metadata.Name) ? "***" : v;
            if (e.State == EntityState.Modified)
            {
                if (p.IsModified && !Equals(p.OriginalValue, p.CurrentValue)) values[p.Metadata.Name] = new[] { Shown(p.OriginalValue), Shown(p.CurrentValue) };
            }
            else if (!p.Metadata.IsPrimaryKey())
                values[p.Metadata.Name] = Shown(e.State == EntityState.Deleted ? p.OriginalValue : p.CurrentValue);
        }
        // Bill lines: the whole new list when it changed (the old list is in the previous entry).
        foreach (var c in e.ComplexCollections.Where(c => e.State != EntityState.Modified || c.IsModified))
            values[c.Metadata.Name] = c.CurrentValue;
        return values;
    }
}
