using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Erp.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddNameOptionsAndSoftDelete : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "DeletedAt",
                table: "Products",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "NameOptions",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Kind = table.Column<string>(type: "text", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    DeletedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NameOptions", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_NameOptions_Kind_Name",
                table: "NameOptions",
                columns: new[] { "Kind", "Name" },
                unique: true);

            // Carry the existing data over before the old table goes: the customers, then every
            // customer, handler, installer and part that a saved bill already uses.
            migrationBuilder.Sql("""
                INSERT INTO "NameOptions" ("Kind", "Name", "CreatedAt")
                SELECT 'customer', "Name", "CreatedAt" FROM "Customers";

                INSERT INTO "NameOptions" ("Kind", "Name", "CreatedAt")
                SELECT DISTINCT 'customer', "Customer", now() FROM "PartsBills" WHERE "Customer" <> ''
                ON CONFLICT ("Kind", "Name") DO NOTHING;

                INSERT INTO "NameOptions" ("Kind", "Name", "CreatedAt")
                SELECT DISTINCT 'handler', "Handler", now() FROM "PartsBills" WHERE "Handler" <> ''
                ON CONFLICT ("Kind", "Name") DO NOTHING;

                INSERT INTO "NameOptions" ("Kind", "Name", "CreatedAt")
                SELECT DISTINCT 'installer', "Installer", now() FROM "PartsBills" WHERE "Installer" <> ''
                ON CONFLICT ("Kind", "Name") DO NOTHING;

                -- A line with a quantity or a price is a part; a line with only a name is a note.
                INSERT INTO "Products" ("Name", "Unit", "CreatedAt")
                SELECT DISTINCT ON (r->>'Name') r->>'Name', coalesce(r->>'QtyUnit', ''), now()
                FROM "PartsBills" b, jsonb_array_elements(b."Rows") r
                WHERE coalesce(r->>'Name', '') <> '' AND (r->>'Qty' IS NOT NULL OR r->>'Price' IS NOT NULL)
                ON CONFLICT ("Name") DO NOTHING;
                """);

            migrationBuilder.DropTable(
                name: "Customers");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "NameOptions");

            migrationBuilder.DropColumn(
                name: "DeletedAt",
                table: "Products");

            migrationBuilder.CreateTable(
                name: "Customers",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Customers", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Customers_Name",
                table: "Customers",
                column: "Name",
                unique: true);
        }
    }
}
