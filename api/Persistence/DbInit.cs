using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Erp.Api;

public static class DbInit
{
    public const string AdminRole = "admin";

    /// Runs at every startup: apply pending migrations, then make sure the admin role and first user exist.
    public static async Task RunAsync(IServiceProvider services, IConfiguration cfg)
    {
        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDb>();
        await db.Database.MigrateAsync();

        var admin = await db.Roles.SingleOrDefaultAsync(r => r.Name == AdminRole);
        if (admin is null) db.Roles.Add(admin = new Role { Name = AdminRole });
        admin.Permissions = Perm.All; // re-synced so a new permission reaches admins on deploy

        if (!await db.Users.AnyAsync())
        {
            var password = cfg["Seed:AdminPassword"];
            if (password is not { Length: >= 12 })
                throw new InvalidOperationException("Set Seed:AdminPassword (12+ characters) to create the first admin user.");
            var user = new User { Username = "admin", DisplayName = "Administrator", Roles = [admin] };
            user.PasswordHash = new PasswordHasher<User>().HashPassword(user, password);
            db.Users.Add(user);
        }
        await db.SaveChangesAsync();
    }
}
