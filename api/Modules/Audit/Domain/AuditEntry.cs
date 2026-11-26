namespace Erp.Api;

/// One row each time a record is created, changed or deleted. Written by AppDb.SaveChangesAsync, so
/// every endpoint is covered without code of its own. Bulk updates (ExecuteUpdate: print count,
/// failed-login count) bypass it on purpose.
public class AuditEntry
{
    public long Id { get; set; }
    public DateTime At { get; set; } = DateTime.UtcNow;
    public int? UserId { get; set; }            // who; null when no one was signed in (login, startup)
    public required string Action { get; set; } // Added, Modified or Deleted
    public required string Entity { get; set; } // entity type, e.g. PartsBill; RoleUser is a role given to or taken from a user
    public required string EntityId { get; set; }
    public required string Changes { get; set; } // JSON: added/deleted -> { field: value }, modified -> { field: [old, new] }
}
