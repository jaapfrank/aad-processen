using System;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using ServiceProcesgids.Api.Data;

#nullable disable

namespace ServiceProcesgids.Api.Data.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(AppDbContext))]
    [Migration("20260610233000_AddImportJobsAndFiles")]
    public partial class AddImportJobsAndFiles : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Files",
                columns: table => new
                {
                    Id = table.Column<string>(type: "TEXT", maxLength: 120, nullable: false),
                    FileName = table.Column<string>(type: "TEXT", maxLength: 260, nullable: false),
                    ContentType = table.Column<string>(type: "TEXT", maxLength: 120, nullable: false),
                    Length = table.Column<long>(type: "INTEGER", nullable: false),
                    Content = table.Column<byte[]>(type: "BLOB", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Files", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ImportJobs",
                columns: table => new
                {
                    Id = table.Column<string>(type: "TEXT", maxLength: 120, nullable: false),
                    FileName = table.Column<string>(type: "TEXT", maxLength: 260, nullable: false),
                    Status = table.Column<string>(type: "TEXT", maxLength: 40, nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    Progress = table.Column<double>(type: "REAL", nullable: false),
                    SourceFileId = table.Column<string>(type: "TEXT", maxLength: 120, nullable: true),
                    ConceptProcessJson = table.Column<string>(type: "TEXT", nullable: true),
                    ConfidenceJson = table.Column<string>(type: "TEXT", nullable: false),
                    PageImagesJson = table.Column<string>(type: "TEXT", nullable: false),
                    Error = table.Column<string>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ImportJobs", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Files_CreatedAtUtc",
                table: "Files",
                column: "CreatedAtUtc");

            migrationBuilder.CreateIndex(
                name: "IX_ImportJobs_CreatedAtUtc",
                table: "ImportJobs",
                column: "CreatedAtUtc");

            migrationBuilder.CreateIndex(
                name: "IX_ImportJobs_Status",
                table: "ImportJobs",
                column: "Status");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Files");

            migrationBuilder.DropTable(
                name: "ImportJobs");
        }
    }
}
