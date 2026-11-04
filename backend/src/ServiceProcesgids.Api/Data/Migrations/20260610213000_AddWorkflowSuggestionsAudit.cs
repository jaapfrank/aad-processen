using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ServiceProcesgids.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddWorkflowSuggestionsAudit : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "AuditLogs",
                columns: table => new
                {
                    Id = table.Column<long>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    Action = table.Column<string>(type: "TEXT", maxLength: 120, nullable: false),
                    EntityType = table.Column<string>(type: "TEXT", maxLength: 80, nullable: false),
                    EntityId = table.Column<string>(type: "TEXT", maxLength: 180, nullable: false),
                    ActorId = table.Column<string>(type: "TEXT", maxLength: 180, nullable: false),
                    ActorName = table.Column<string>(type: "TEXT", maxLength: 220, nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    DetailsJson = table.Column<string>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AuditLogs", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ProcessVersions",
                columns: table => new
                {
                    ProcessId = table.Column<string>(type: "TEXT", maxLength: 160, nullable: false),
                    VersionNr = table.Column<int>(type: "INTEGER", nullable: false),
                    Status = table.Column<string>(type: "TEXT", maxLength: 40, nullable: false),
                    ChangedBy = table.Column<string>(type: "TEXT", maxLength: 220, nullable: false),
                    ChangedAtUtc = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    Comment = table.Column<string>(type: "TEXT", maxLength: 1000, nullable: true),
                    ProcessJson = table.Column<string>(type: "TEXT", nullable: false),
                    ProcessRevision = table.Column<int>(type: "INTEGER", nullable: false),
                    ProcessVersion = table.Column<string>(type: "TEXT", maxLength: 80, nullable: false),
                    ProcessedSuggestionsJson = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProcessVersions", x => new { x.ProcessId, x.VersionNr });
                });

            migrationBuilder.CreateTable(
                name: "Suggestions",
                columns: table => new
                {
                    Id = table.Column<string>(type: "TEXT", maxLength: 120, nullable: false),
                    ProcessId = table.Column<string>(type: "TEXT", maxLength: 160, nullable: false),
                    StepId = table.Column<string>(type: "TEXT", maxLength: 120, nullable: true),
                    Type = table.Column<string>(type: "TEXT", maxLength: 40, nullable: false),
                    Text = table.Column<string>(type: "TEXT", maxLength: 4000, nullable: false),
                    CreatedBy = table.Column<string>(type: "TEXT", maxLength: 220, nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    Status = table.Column<string>(type: "TEXT", maxLength: 40, nullable: false),
                    ResolvedBy = table.Column<string>(type: "TEXT", maxLength: 220, nullable: true),
                    ResolvedAtUtc = table.Column<DateTimeOffset>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Suggestions", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_AuditLogs_CreatedAtUtc",
                table: "AuditLogs",
                column: "CreatedAtUtc");

            migrationBuilder.CreateIndex(
                name: "IX_AuditLogs_EntityId",
                table: "AuditLogs",
                column: "EntityId");

            migrationBuilder.CreateIndex(
                name: "IX_ProcessVersions_ChangedAtUtc",
                table: "ProcessVersions",
                column: "ChangedAtUtc");

            migrationBuilder.CreateIndex(
                name: "IX_ProcessVersions_ProcessId",
                table: "ProcessVersions",
                column: "ProcessId");

            migrationBuilder.CreateIndex(
                name: "IX_Suggestions_ProcessId",
                table: "Suggestions",
                column: "ProcessId");

            migrationBuilder.CreateIndex(
                name: "IX_Suggestions_Status",
                table: "Suggestions",
                column: "Status");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AuditLogs");

            migrationBuilder.DropTable(
                name: "ProcessVersions");

            migrationBuilder.DropTable(
                name: "Suggestions");
        }
    }
}
