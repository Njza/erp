using Microsoft.EntityFrameworkCore;

namespace Erp.Api;

public static class AuditEndpoints
{
    const int PageSize = 50;

    public static void MapAudit(this RouteGroupBuilder api)
    {
        // Newest first. entity and entityId narrow it to one kind of record, or one record.
        api.MapGet("/audit", async (string? entity, string? entityId, int? page, AppDb db) =>
        {
            var query = db.AuditEntries.AsQueryable();
            if (!string.IsNullOrWhiteSpace(entity)) query = query.Where(a => a.Entity == entity);
            if (!string.IsNullOrWhiteSpace(entityId)) query = query.Where(a => a.EntityId == entityId.Trim());
            var total = await query.CountAsync();
            var items = await query.OrderByDescending(a => a.Id)
                .Skip((Math.Max(page ?? 1, 1) - 1) * PageSize).Take(PageSize)
                .Select(a => new
                {
                    a.Id, a.At, a.Action, a.Entity, a.EntityId, a.Changes,
                    User = db.Users.Where(u => u.Id == a.UserId).Select(u => u.DisplayName).FirstOrDefault(),
                })
                .ToListAsync();
            return new { items, total, pageSize = PageSize };
        }).RequirePermission(Perm.AuditRead);
    }
}
