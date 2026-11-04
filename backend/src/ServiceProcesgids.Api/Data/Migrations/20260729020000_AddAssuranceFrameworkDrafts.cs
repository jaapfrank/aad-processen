using System;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using ServiceProcesgids.Api.Data;

#nullable disable

namespace ServiceProcesgids.Api.Data.Migrations
{
    [DbContext(typeof(AppDbContext))]
    [Migration("20260729020000_AddAssuranceFrameworkDrafts")]
    public partial class AddAssuranceFrameworkDrafts : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "AssuranceFrameworkDrafts",
                columns: table => new
                {
                    Id = table.Column<long>(nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1")
                        .Annotation("Sqlite:Autoincrement", true),
                    DraftId = table.Column<string>(maxLength: 32, nullable: false),
                    TenantId = table.Column<string>(maxLength: 120, nullable: false),
                    Status = table.Column<string>(maxLength: 30, nullable: false),
                    FrameworkId = table.Column<string>(maxLength: 80, nullable: false),
                    Name = table.Column<string>(maxLength: 160, nullable: false),
                    Edition = table.Column<string>(maxLength: 160, nullable: false),
                    Domain = table.Column<string>(maxLength: 180, nullable: false),
                    SourceUrl = table.Column<string>(maxLength: 500, nullable: false),
                    SourceOrganization = table.Column<string>(maxLength: 160, nullable: false),
                    PublicSummary = table.Column<string>(maxLength: 4000, nullable: false),
                    QuestionsJson = table.Column<string>(nullable: false),
                    SchemaVersion = table.Column<string>(maxLength: 80, nullable: false),
                    Provider = table.Column<string>(maxLength: 80, nullable: false),
                    Model = table.Column<string>(maxLength: 180, nullable: false),
                    InputHash = table.Column<string>(maxLength: 80, nullable: false),
                    OutputHash = table.Column<string>(maxLength: 80, nullable: false),
                    CatalogUniquenessKey = table.Column<string>(maxLength: 260, nullable: false),
                    UsageRightsConfirmed = table.Column<bool>(nullable: false),
                    CreatedByActorId = table.Column<string>(maxLength: 180, nullable: false),
                    CreatedByActorName = table.Column<string>(maxLength: 220, nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(nullable: false),
                    PublishedByActorId = table.Column<string>(maxLength: 180, nullable: true),
                    PublishedByActorName = table.Column<string>(maxLength: 220, nullable: true),
                    PublishedAtUtc = table.Column<DateTimeOffset>(nullable: true),
                    SourceReviewedAtUtc = table.Column<DateTimeOffset>(nullable: true),
                    RightsReviewedAtUtc = table.Column<DateTimeOffset>(nullable: true),
                    RejectedByActorId = table.Column<string>(maxLength: 180, nullable: true),
                    RejectedByActorName = table.Column<string>(maxLength: 220, nullable: true),
                    RejectedAtUtc = table.Column<DateTimeOffset>(nullable: true),
                    RejectionReason = table.Column<string>(maxLength: 1000, nullable: true),
                    Revision = table.Column<int>(nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AssuranceFrameworkDrafts", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_AssuranceFrameworkDrafts_CatalogUniquenessKey",
                table: "AssuranceFrameworkDrafts",
                column: "CatalogUniquenessKey",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_AssuranceFrameworkDrafts_DraftId",
                table: "AssuranceFrameworkDrafts",
                column: "DraftId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_AssuranceFrameworkDrafts_TenantId_FrameworkId",
                table: "AssuranceFrameworkDrafts",
                columns: new[] { "TenantId", "FrameworkId" });

            migrationBuilder.CreateIndex(
                name: "IX_AssuranceFrameworkDrafts_TenantId_Status_Id",
                table: "AssuranceFrameworkDrafts",
                columns: new[] { "TenantId", "Status", "Id" });
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "AssuranceFrameworkDrafts");
        }
    }
}
