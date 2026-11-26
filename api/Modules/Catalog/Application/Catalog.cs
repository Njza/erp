using Microsoft.EntityFrameworkCore;

namespace Erp.Api;

/// Keeps the suggestion lists up to date: a value typed on a bill that is not in its list is added,
/// and one that was deleted comes back. Only values that are new on this save are looked at,
/// so saving an old bill again does not bring back what the user deleted since.
public static class Catalog
{
    /// The catalogue values a bill uses: (kind, name, unit). Kind "product" has a unit, the others do not.
    public static HashSet<(string Kind, string Name, string Unit)> ValuesOf(PartsBill bill)
    {
        var values = new HashSet<(string, string, string)>
        {
            (NameKind.Customer, bill.Customer, ""),
            (NameKind.Handler, bill.Handler, ""),
            (NameKind.Installer, bill.Installer, ""),
        };
        foreach (var r in bill.Rows.Where(r => r.IsPart))
            values.Add((Product, r.Name, r.QtyUnit));
        values.RemoveWhere(v => v.Item2 == "");
        return values;
    }

    const string Product = "product";

    /// Adds to the change tracker; the caller saves, so the bill and its new values are stored together.
    // shortcut: two people saving the same new name at the same moment collide on the unique index,
    // and one of them gets "已存在相同的记录" for the bill; saving again works.
    public static async Task LearnAsync(AppDb db, PartsBill bill, HashSet<(string Kind, string Name, string Unit)> before)
    {
        var known = before.Select(v => (v.Kind, v.Name)).ToHashSet();
        var fresh = ValuesOf(bill).Where(v => !known.Contains((v.Kind, v.Name)))
            .GroupBy(v => (v.Kind, v.Name)).Select(g => g.First()); // the same new part on two lines is one product

        foreach (var (kind, name, unit) in fresh)
        {
            if (kind == Product)
            {
                var product = await db.Products.SingleOrDefaultAsync(p => p.Name == name);
                if (product is null) db.Products.Add(new Product { Name = name, Unit = unit });
                else if (product.DeletedAt is not null) { product.DeletedAt = null; product.Unit = unit; }
            }
            else
            {
                var option = await db.NameOptions.SingleOrDefaultAsync(n => n.Kind == kind && n.Name == name);
                if (option is null) db.NameOptions.Add(new NameOption { Kind = kind, Name = name });
                else option.DeletedAt = null;
            }
        }
    }
}
