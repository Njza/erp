using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;

namespace Erp.Api;

// Rows are checked in Apply(): the built-in validation does not reach into array elements.
public record PartsBillRowRequest(string? Name, string? Unit, decimal? Qty, string? QtyUnit, decimal? Price);

public record SavePartsBillRequest(
    [Required(ErrorMessage = "请输入单据编号。"), MaxLength(30, ErrorMessage = "单据编号不能超过 30 个字符。")] string No,
    DateOnly Date,
    [MaxLength(100)] string? Handler,
    [MaxLength(100)] string? Customer,
    [MaxLength(100)] string? Picker,
    [MaxLength(100)] string? Installer,
    [MaxLength(100)] string? Receiver,
    bool Settle,
    bool Warranty,
    PartsBillRowRequest[]? Rows);

public static class PartsBillEndpoints
{
    const int PageSize = 20;

    public static void MapPartsBills(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/parts-bills");

        // Newest first. q matches the bill number or the customer.
        g.MapGet("", async (string? q, int? page, AppDb db) =>
        {
            var query = db.PartsBills.AsQueryable();
            if (!string.IsNullOrWhiteSpace(q))
            {
                var term = q.Trim();
                query = query.Where(b => b.No.Contains(term) || b.Customer.Contains(term));
            }
            var total = await query.CountAsync();
            var items = await query.OrderByDescending(b => b.Date).ThenByDescending(b => b.No)
                .Skip((Math.Max(page ?? 1, 1) - 1) * PageSize).Take(PageSize)
                .Select(b => new { b.Id, b.No, b.Date, b.Customer, b.Handler, b.Total })
                .ToListAsync();
            return new { items, total, pageSize = PageSize };
        }).RequirePermission(Perm.BillRead);

        // Suggests the next number of a day: yyyyMMdd + a two-digit sequence.
        // shortcut: compares numbers as text, so it is right up to 99 bills a day,
        // and two people may get the same suggestion (the unique index then rejects the second save).
        g.MapGet("/next-no", async (DateOnly date, AppDb db) =>
        {
            var prefix = date.ToString("yyyyMMdd");
            var last = await db.PartsBills.Where(b => b.No.StartsWith(prefix)).MaxAsync(b => (string?)b.No);
            var seq = last is not null && int.TryParse(last[prefix.Length..], out var n) ? n + 1 : 1;
            return new { no = prefix + seq.ToString("00") };
        }).RequirePermission(Perm.BillWrite);

        g.MapGet("/{id:int}", async (int id, AppDb db) => ToDto(await Find(db, id)))
            .RequirePermission(Perm.BillRead);

        g.MapPost("", async (SavePartsBillRequest req, ClaimsPrincipal principal, AppDb db) =>
        {
            var bill = new PartsBill { No = req.No.Trim(), CreatedById = principal.UserId() };
            Apply(bill, req);
            db.PartsBills.Add(bill);
            await db.SaveChangesAsync(); // a duplicate number becomes 409 in AppExceptionHandler
            return new { bill.Id };
        }).RequirePermission(Perm.BillWrite);

        g.MapPut("/{id:int}", async (int id, SavePartsBillRequest req, AppDb db) =>
        {
            var bill = await Find(db, id);
            Apply(bill, req);
            bill.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            return Results.NoContent();
        }).RequirePermission(Perm.BillWrite);
    }

    static async Task<PartsBill> Find(AppDb db, int id) =>
        await db.PartsBills.SingleOrDefaultAsync(b => b.Id == id)
        ?? throw new AppException(404, "NOT_FOUND", "单据不存在。");

    const int MaxRows = 26; // the largest paper holds 26 lines
    const decimal MaxNumber = 99_999_999;

    static void Apply(PartsBill bill, SavePartsBillRequest req)
    {
        var rows = req.Rows ?? [];
        if (rows.Length > MaxRows)
            throw new AppException(400, "INVALID_ROWS", $"一张单据最多 {MaxRows} 行。");
        if (rows.Any(r => r.Qty is < 0 or > MaxNumber || r.Price is < 0 or > MaxNumber))
            throw new AppException(400, "INVALID_ROWS", "数量和单价必须在 0 到 99999999 之间。");
        if (rows.Any(r => r.Name?.Length > 100 || r.Unit?.Length > 100 || r.QtyUnit?.Length > 10))
            throw new AppException(400, "INVALID_ROWS", "配件名称和单位（梯号）不能超过 100 个字符，数量单位不能超过 10 个字符。");

        bill.No = req.No.Trim();
        bill.Date = req.Date;
        bill.Handler = req.Handler?.Trim() ?? "";
        bill.Customer = req.Customer?.Trim() ?? "";
        bill.Picker = req.Picker?.Trim() ?? "";
        bill.Installer = req.Installer?.Trim() ?? "";
        bill.Receiver = req.Receiver?.Trim() ?? "";
        bill.Settle = req.Settle;
        bill.Warranty = req.Warranty;
        bill.Rows = [.. rows.Select(r => new PartsBillRow
        {
            Name = r.Name?.Trim() ?? "", Unit = r.Unit?.Trim() ?? "",
            Qty = r.Qty, QtyUnit = r.QtyUnit?.Trim() ?? "", Price = r.Price,
        })];
        // The total is never taken from the client.
        bill.Total = Math.Round(bill.Rows.Sum(r => r.Qty is { } q && r.Price is { } p ? q * p : 0), 2, MidpointRounding.AwayFromZero);
    }

    static object ToDto(PartsBill b) => new
    {
        b.Id, b.No, b.Date, b.Handler, b.Customer, b.Picker, b.Installer, b.Receiver,
        b.Settle, b.Warranty, b.Rows, b.Total,
    };
}
