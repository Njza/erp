using System.ComponentModel.DataAnnotations;
using Microsoft.EntityFrameworkCore;

namespace Erp.Api;

public record SaveNameRequest(
    [Required(ErrorMessage = "请输入名称。"), MaxLength(100, ErrorMessage = "名称不能超过 100 个字符。")] string Name);

public static class NameEndpoints
{
    /// /api/names/customer, /api/names/handler, /api/names/installer: the same four operations for each list.
    public static void MapNames(this RouteGroupBuilder api)
    {
        Map(api, NameKind.Customer, Perm.CustomerWrite);
        Map(api, NameKind.Handler, Perm.StaffWrite);
        Map(api, NameKind.Installer, Perm.StaffWrite);
    }

    static void Map(RouteGroupBuilder api, string kind, string writePermission)
    {
        var g = api.MapGroup($"/names/{kind}");

        // Every signed-in user may read the lists: the bill page uses them for suggestions.
        // shortcut: returns the whole list and the pages filter in the browser;
        // add server-side search and paging when a list passes a few thousand.
        g.MapGet("", async (AppDb db) => await db.NameOptions
            .Where(n => n.Kind == kind && n.DeletedAt == null).OrderBy(n => n.Name)
            .Select(n => new { n.Id, n.Name }).ToListAsync())
            .RequireActiveUser();

        g.MapPost("", async (SaveNameRequest req, AppDb db) =>
        {
            var name = req.Name.Trim();
            var option = await db.NameOptions.SingleOrDefaultAsync(n => n.Kind == kind && n.Name == name);
            if (option is { DeletedAt: null }) throw new AppException(409, "DUPLICATE", "已存在相同的记录。");
            if (option is null) db.NameOptions.Add(option = new NameOption { Kind = kind, Name = name });
            else option.DeletedAt = null; // adding a deleted name again restores it
            await db.SaveChangesAsync();
            return new { option.Id };
        }).RequirePermission(writePermission);

        g.MapPut("/{id:int}", async (int id, SaveNameRequest req, AppDb db) =>
        {
            var option = await Find(db, kind, id);
            option.Name = req.Name.Trim();
            await db.SaveChangesAsync(); // a name that exists, deleted ones included, becomes 409
            return Results.NoContent();
        }).RequirePermission(writePermission);

        // Soft delete: the name leaves the list, bills that used it keep their text.
        g.MapDelete("/{id:int}", async (int id, AppDb db) =>
        {
            (await Find(db, kind, id)).DeletedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            return Results.NoContent();
        }).RequirePermission(writePermission);
    }

    static async Task<NameOption> Find(AppDb db, string kind, int id) =>
        await db.NameOptions.SingleOrDefaultAsync(n => n.Id == id && n.Kind == kind && n.DeletedAt == null)
        ?? throw new AppException(404, "NOT_FOUND", "记录不存在。");
}
