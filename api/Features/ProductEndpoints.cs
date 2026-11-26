using System.ComponentModel.DataAnnotations;
using Microsoft.EntityFrameworkCore;

namespace Erp.Api;

public record SaveProductRequest(
    [Required(ErrorMessage = "请输入产品名称。"), MaxLength(100, ErrorMessage = "产品名称不能超过 100 个字符。")] string Name,
    [Required(ErrorMessage = "请输入单位。"), MaxLength(10, ErrorMessage = "单位不能超过 10 个字符。")] string Unit);

public static class ProductEndpoints
{
    public static void MapProducts(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/products");

        // Every signed-in user may read products: the bill page uses them for suggestions.
        // shortcut: returns every product in one response and the pages filter in the browser;
        // add server-side search and paging when the list passes a few thousand.
        g.MapGet("", async (AppDb db) => await db.Products.Where(p => p.DeletedAt == null).OrderBy(p => p.Name)
            .Select(p => new { p.Id, p.Name, p.Unit }).ToListAsync())
            .RequireActiveUser();

        g.MapPost("", async (SaveProductRequest req, AppDb db) =>
        {
            var name = req.Name.Trim();
            var product = await db.Products.SingleOrDefaultAsync(p => p.Name == name);
            if (product is { DeletedAt: null }) throw new AppException(409, "DUPLICATE", "已存在相同的记录。");
            if (product is null) db.Products.Add(product = new Product { Name = name, Unit = req.Unit.Trim() });
            else { product.DeletedAt = null; product.Unit = req.Unit.Trim(); } // adding a deleted product again restores it
            await db.SaveChangesAsync();
            return new { product.Id };
        }).RequirePermission(Perm.ProductWrite);

        g.MapPut("/{id:int}", async (int id, SaveProductRequest req, AppDb db) =>
        {
            var product = await Find(db, id);
            product.Name = req.Name.Trim();
            product.Unit = req.Unit.Trim();
            await db.SaveChangesAsync(); // a name that exists, deleted ones included, becomes 409
            return Results.NoContent();
        }).RequirePermission(Perm.ProductWrite);

        g.MapDelete("/{id:int}", async (int id, AppDb db) =>
        {
            // Soft delete: the product leaves the list, bills that used it keep their text.
            (await Find(db, id)).DeletedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            return Results.NoContent();
        }).RequirePermission(Perm.ProductWrite);
    }

    static async Task<Product> Find(AppDb db, int id) =>
        await db.Products.SingleOrDefaultAsync(p => p.Id == id && p.DeletedAt == null)
        ?? throw new AppException(404, "NOT_FOUND", "产品不存在。");
}
