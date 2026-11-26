namespace Erp.Api;

/// A name offered in a suggestion list of the bill page: a customer (使用单位), a handler (经手人)
/// or an installer (维修安装员). Bills copy the name as text, so renaming or deleting one
/// never changes an old bill. Deleting is soft: the row stays and comes back when the name is used again.
public class NameOption
{
    public int Id { get; set; }
    public required string Kind { get; set; } // one of NameKind
    public required string Name { get; set; } // unique within its kind, deleted rows included
    public DateTime? DeletedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public static class NameKind
{
    public const string Customer = "customer";
    public const string Handler = "handler";
    public const string Installer = "installer";
}
