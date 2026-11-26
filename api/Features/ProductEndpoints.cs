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
        g.MapGet("", async (AppDb db) => await db.Products.OrderBy(p => p.Name)
            .Select(p => new { p.Id, p.Name, p.Unit }).ToListAsync())
            .RequireActiveUser();

        g.MapPost("", async (SaveProductRequest req, AppDb db) =>
        {
            var product = new Product { Name = req.Name.Trim(), Unit = req.Unit.Trim() };
            db.Products.Add(product);
            await db.SaveChangesAsync(); // a duplicate name becomes 409 in AppExceptionHandler
            return new { product.Id };
        }).RequirePermission(Perm.ProductWrite);

        g.MapPut("/{id:int}", async (int id, SaveProductRequest req, AppDb db) =>
        {
            var product = await Find(db, id);
            product.Name = req.Name.Trim();
            product.Unit = req.Unit.Trim();
            await db.SaveChangesAsync();
            return Results.NoContent();
        }).RequirePermission(Perm.ProductWrite);

        g.MapDelete("/{id:int}", async (int id, AppDb db) =>
        {
            db.Products.Remove(await Find(db, id));
            await db.SaveChangesAsync();
            return Results.NoContent();
        }).RequirePermission(Perm.ProductWrite);
    }

    static async Task<Product> Find(AppDb db, int id) =>
        await db.Products.FindAsync(id) ?? throw new AppException(404, "NOT_FOUND", "产品不存在。");
}
