using System.Text.Json.Serialization;

namespace Erp.Api;

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
    public List<PartsBillRow> Rows { get; private set; } = []; // stored as one JSON column, in print order; change with SetRows
    public decimal Total { get; private set; }  // always computed from Rows, never taken from the client
    public int PrintCount { get; set; }         // how many times the print dialog was opened for this bill
    public DateTime? LastPrintedAt { get; set; }
    public int CreatedById { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public const int MaxRows = 26; // the largest paper holds 26 lines
    const decimal MaxNumber = 99_999_999;

    /// Replaces the lines and computes the total. Throws when the lines break a rule of the bill.
    public void SetRows(IReadOnlyCollection<PartsBillRow> rows)
    {
        if (rows.Count > MaxRows)
            throw new AppException(400, "INVALID_ROWS", $"一张单据最多 {MaxRows} 行。");
        if (rows.Any(r => r.Qty is < 0 or > MaxNumber || r.Price is < 0 or > MaxNumber))
            throw new AppException(400, "INVALID_ROWS", "数量和单价必须在 0 到 99999999 之间。");
        if (rows.Any(r => r.Name.Length > 100 || r.Unit.Length > 100 || r.QtyUnit.Length > 10))
            throw new AppException(400, "INVALID_ROWS", "配件名称和单位（梯号）不能超过 100 个字符，数量单位不能超过 10 个字符。");

        Rows = [.. rows];
        Total = Math.Round(Rows.Sum(r => r.Amount), 2, MidpointRounding.AwayFromZero);
    }
}

/// One printed line. A line with only a name is a note (for example a part serial number).
public class PartsBillRow
{
    public string Name { get; set; } = "";
    public string Unit { get; set; } = "";    // 单位（梯号）
    public decimal? Qty { get; set; }
    public string QtyUnit { get; set; } = ""; // 台, 个, ...
    public decimal? Price { get; set; }

    /// A line with a quantity or a price is a part. A line with only a name is a note: not a product.
    [JsonIgnore] public bool IsPart => Qty is not null || Price is not null;
    [JsonIgnore] public decimal Amount => Qty is { } q && Price is { } p ? q * p : 0;
}
