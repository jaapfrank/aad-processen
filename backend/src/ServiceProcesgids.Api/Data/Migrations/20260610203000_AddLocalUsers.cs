using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ServiceProcesgids.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddLocalUsers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "LocalUsers",
                columns: table => new
                {
                    Id = table.Column<string>(type: "TEXT", maxLength: 120, nullable: false),
                    UserName = table.Column<string>(type: "TEXT", maxLength: 120, nullable: false),
                    NormalizedUserName = table.Column<string>(type: "TEXT", maxLength: 120, nullable: false),
                    DisplayName = table.Column<string>(type: "TEXT", maxLength: 180, nullable: false),
                    Email = table.Column<string>(type: "TEXT", maxLength: 260, nullable: true),
                    PasswordHash = table.Column<string>(type: "TEXT", maxLength: 260, nullable: false),
                    RolesJson = table.Column<string>(type: "TEXT", nullable: false),
                    IsActive = table.Column<bool>(type: "INTEGER", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LocalUsers", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_LocalUsers_NormalizedUserName",
                table: "LocalUsers",
                column: "NormalizedUserName",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "LocalUsers");
        }
    }
}
