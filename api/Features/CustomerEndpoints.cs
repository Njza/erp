using System.ComponentModel.DataAnnotations;
using Microsoft.EntityFrameworkCore;

namespace Erp.Api;

public record SaveCustomerRequest(
    [Required(ErrorMessage = "请输入客户名称。"), MaxLength(100, ErrorMessage = "客户名称不能超过 100 个字符。")] string Name);

public static class CustomerEndpoints
{
    public static void MapCustomers(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/customers");

        // Every signed-in user may read customers: the bill page uses them for suggestions.
        // shortcut: returns every customer in one response and the pages filter in the browser;
        // add server-side search and paging when the list passes a few thousand.
        g.MapGet("", async (AppDb db) => await db.Customers.OrderBy(c => c.Name)
            .Select(c => new { c.Id, c.Name }).ToListAsync())
            .RequireActiveUser();

        g.MapPost("", async (SaveCustomerRequest req, AppDb db) =>
        {
            var customer = new Customer { Name = req.Name.Trim() };
            db.Customers.Add(customer);
            await db.SaveChangesAsync(); // a duplicate name becomes 409 in AppExceptionHandler
            return new { customer.Id };
        }).RequirePermission(Perm.CustomerWrite);

        g.MapPut("/{id:int}", async (int id, SaveCustomerRequest req, AppDb db) =>
        {
            var customer = await Find(db, id);
            customer.Name = req.Name.Trim();
            await db.SaveChangesAsync();
            return Results.NoContent();
        }).RequirePermission(Perm.CustomerWrite);

        g.MapDelete("/{id:int}", async (int id, AppDb db) =>
        {
            db.Customers.Remove(await Find(db, id));
            await db.SaveChangesAsync();
            return Results.NoContent();
        }).RequirePermission(Perm.CustomerWrite);
    }

    static async Task<Customer> Find(AppDb db, int id) =>
        await db.Customers.FindAsync(id) ?? throw new AppException(404, "NOT_FOUND", "客户不存在。");
}
