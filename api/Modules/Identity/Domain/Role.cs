namespace Erp.Api;

public class Role
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public string[] Permissions { get; set; } = []; // codes from Perm; a Postgres text[]
    public List<User> Users { get; set; } = [];
}
