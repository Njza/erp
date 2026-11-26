using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Erp.Api.Persistence.Migrations;

/// <inheritdoc />
public partial class _20261126121337_AddUserTokenVersion : Migration
{
    /// <inheritdoc />
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<int>(
            name: "TokenVersion",
            table: "Users",
            type: "integer",
            nullable: false,
            defaultValue: 0);
    }

    /// <inheritdoc />
    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn(
            name: "TokenVersion",
            table: "Users");
    }
}
