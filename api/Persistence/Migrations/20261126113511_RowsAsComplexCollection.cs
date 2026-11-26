using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Erp.Api.Persistence.Migrations;

/// <inheritdoc />
public partial class _20261126113511_RowsAsComplexCollection : Migration
{
    /// <inheritdoc />
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        // The column becomes NOT NULL: give a bill without lines an empty list first.
        migrationBuilder.Sql("""UPDATE "PartsBills" SET "Rows" = '[]' WHERE "Rows" IS NULL;""");

        migrationBuilder.AlterColumn<string>(
            name: "Rows",
            table: "PartsBills",
            type: "jsonb",
            nullable: false,
            defaultValue: "[]",
            oldClrType: typeof(string),
            oldType: "jsonb",
            oldNullable: true);
    }

    /// <inheritdoc />
    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AlterColumn<string>(
            name: "Rows",
            table: "PartsBills",
            type: "jsonb",
            nullable: true,
            oldClrType: typeof(string),
            oldType: "jsonb");
    }
}
