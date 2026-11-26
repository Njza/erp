using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Erp.Api.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddBillPrintTracking : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "LastPrintedAt",
                table: "PartsBills",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "PrintCount",
                table: "PartsBills",
                type: "integer",
                nullable: false,
                defaultValue: 0);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "LastPrintedAt",
                table: "PartsBills");

            migrationBuilder.DropColumn(
                name: "PrintCount",
                table: "PartsBills");
        }
    }
}
