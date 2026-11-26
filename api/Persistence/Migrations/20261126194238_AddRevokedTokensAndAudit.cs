using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Erp.Api.Persistence.Migrations;

/// <inheritdoc />
public partial class _20261126194238_AddRevokedTokensAndAudit : Migration
{
    /// <inheritdoc />
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "AuditEntries",
            columns: table => new
            {
                Id = table.Column<long>(type: "bigint", nullable: false)
                    .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                At = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                UserId = table.Column<int>(type: "integer", nullable: true),
                Action = table.Column<string>(type: "text", nullable: false),
                Entity = table.Column<string>(type: "text", nullable: false),
                EntityId = table.Column<string>(type: "text", nullable: false),
                Changes = table.Column<string>(type: "jsonb", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_AuditEntries", x => x.Id);
            });

        migrationBuilder.CreateTable(
            name: "RevokedTokens",
            columns: table => new
            {
                Id = table.Column<string>(type: "text", nullable: false),
                ExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_RevokedTokens", x => x.Id);
            });

        migrationBuilder.CreateIndex(
            name: "IX_AuditEntries_At",
            table: "AuditEntries",
            column: "At");

        migrationBuilder.CreateIndex(
            name: "IX_AuditEntries_Entity_EntityId",
            table: "AuditEntries",
            columns: new[] { "Entity", "EntityId" });
    }

    /// <inheritdoc />
    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(
            name: "AuditEntries");

        migrationBuilder.DropTable(
            name: "RevokedTokens");
    }
}
