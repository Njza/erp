namespace Erp.Api;

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
