using System.ComponentModel.DataAnnotations;
using Microsoft.EntityFrameworkCore;

namespace Erp.Api;

public record SaveRoleRequest([Required(ErrorMessage = "请输入角色名称。"), MaxLength(50, ErrorMessage = "角色名称不能超过 50 个字符。")] string Name, string[] Permissions);

public static class RoleEndpoints
{
    public static void MapRoles(this RouteGroupBuilder api)
    {
        api.MapGet("/permissions", () => Perm.All).RequirePermission(Perm.RoleRead);

        var g = api.MapGroup("/roles");

        g.MapGet("", async (AppDb db) => await db.Roles.OrderBy(r => r.Name)
            .Select(r => new { r.Id, r.Name, r.Permissions }).ToListAsync())
            .RequirePermission(Perm.RoleRead);

        g.MapPost("", async (SaveRoleRequest req, AppDb db) =>
        {
            var role = new Role { Name = req.Name.Trim(), Permissions = Validated(req.Permissions) };
            db.Roles.Add(role);
            await db.SaveChangesAsync();
            return new { role.Id };
        }).RequirePermission(Perm.RoleWrite);

        g.MapPut("/{id:int}", async (int id, SaveRoleRequest req, AppDb db) =>
        {
            var role = await FindEditable(db, id);
            role.Name = req.Name.Trim();
            role.Permissions = Validated(req.Permissions);
            await db.SaveChangesAsync();
            return Results.NoContent();
        }).RequirePermission(Perm.RoleWrite);

        g.MapDelete("/{id:int}", async (int id, AppDb db) =>
        {
            var role = await FindEditable(db, id);
            if (await db.Users.AnyAsync(u => u.Roles.Any(r => r.Id == id)))
                throw new AppException(409, "IN_USE", "请先从所有用户中移除该角色，再删除。");
            db.Roles.Remove(role);
            await db.SaveChangesAsync();
            return Results.NoContent();
        }).RequirePermission(Perm.RoleWrite);
    }

    static async Task<Role> FindEditable(AppDb db, int id)
    {
        var role = await db.Roles.FindAsync(id) ?? throw new AppException(404, "NOT_FOUND", "角色不存在。");
        if (role.Name == DbInit.AdminRole)
            throw new AppException(400, "BUILT_IN_ROLE", "内置的管理员角色不能修改。");
        return role;
    }

    static string[] Validated(string[] permissions)
    {
        var unknown = permissions.Except(Perm.All).ToArray();
        if (unknown.Length > 0)
            throw new AppException(400, "UNKNOWN_PERMISSION", $"未知的权限：{string.Join("、", unknown)}");
        return [.. permissions.Distinct()];
    }
}
