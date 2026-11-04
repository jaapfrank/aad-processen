using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ServiceProcesgids.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddIsoProcessConfigs : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "IsoProcessConfigs",
                columns: table => new
                {
                    ProcessId = table.Column<string>(type: "TEXT", maxLength: 160, nullable: false),
                    ConfigJson = table.Column<string>(type: "TEXT", nullable: false),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    UpdatedBy = table.Column<string>(type: "TEXT", maxLength: 220, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_IsoProcessConfigs", x => x.ProcessId);
                });

            migrationBuilder.CreateIndex(
                name: "IX_IsoProcessConfigs_UpdatedAtUtc",
                table: "IsoProcessConfigs",
                column: "UpdatedAtUtc");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "IsoProcessConfigs");
        }
    }
}
