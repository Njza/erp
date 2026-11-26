namespace Erp.Api;

/// The permission catalog. Add a constant here, then use it in RequirePermission(...).
/// Convention: "<module>.<action>". The admin role receives every code at startup.
public static class Perm
{
    public const string UserRead = "user.read";
    public const string UserWrite = "user.write";
    public const string RoleRead = "role.read";
    public const string RoleWrite = "role.write";
    public const string BillRead = "bill.read";
    public const string BillWrite = "bill.write";
    public const string ProductWrite = "product.write";
    public const string CustomerWrite = "customer.write";
    public const string StaffWrite = "staff.write";
    public const string AuditRead = "audit.read";

    public static readonly string[] All =
        [.. typeof(Perm).GetFields().Where(f => f.IsLiteral).Select(f => (string)f.GetRawConstantValue()!)];
}
