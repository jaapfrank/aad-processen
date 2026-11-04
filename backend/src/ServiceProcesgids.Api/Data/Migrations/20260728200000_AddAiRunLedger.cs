using System;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using ServiceProcesgids.Api.Data;

#nullable disable

namespace ServiceProcesgids.Api.Data.Migrations
{
    [DbContext(typeof(AppDbContext))]
    [Migration("20260728200000_AddAiRunLedger")]
    public partial class AddAiRunLedger : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "AiRuns",
                columns: table => new
                {
                    // Laat de actieve provider het opslagtype kiezen. Beide
                    // identity-annotaties zijn bewust aanwezig: elke provider
                    // negeert de annotatie van de andere provider.
                    Id = table.Column<long>(nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1")
                        .Annotation("Sqlite:Autoincrement", true),
                    RunId = table.Column<string>(maxLength: 32, nullable: false),
                    TenantId = table.Column<string>(maxLength: 120, nullable: false),
                    Capability = table.Column<string>(maxLength: 80, nullable: false),
                    ProcessId = table.Column<string>(maxLength: 160, nullable: false),
                    ProcessRevision = table.Column<int>(nullable: false),
                    ActorId = table.Column<string>(maxLength: 180, nullable: false),
                    ActorName = table.Column<string>(maxLength: 220, nullable: false),
                    Provider = table.Column<string>(maxLength: 80, nullable: true),
                    Model = table.Column<string>(maxLength: 180, nullable: true),
                    Status = table.Column<string>(maxLength: 40, nullable: false),
                    ResultStatus = table.Column<string>(maxLength: 40, nullable: true),
                    InputHash = table.Column<string>(maxLength: 80, nullable: true),
                    OutputHash = table.Column<string>(maxLength: 80, nullable: true),
                    StartedAtUtc = table.Column<DateTimeOffset>(nullable: false),
                    CompletedAtUtc = table.Column<DateTimeOffset>(nullable: true),
                    DurationMs = table.Column<long>(nullable: true),
                    QuestionCount = table.Column<int>(nullable: false),
                    IssueCount = table.Column<int>(nullable: false),
                    ChangeCount = table.Column<int>(nullable: false),
                    ErrorCode = table.Column<string>(maxLength: 120, nullable: true),
                    FeedbackDecision = table.Column<string>(maxLength: 20, nullable: true),
                    FeedbackReason = table.Column<string>(maxLength: 500, nullable: true),
                    ProposedChangeIdsJson = table.Column<string>(nullable: false),
                    AcceptedChangeIdsJson = table.Column<string>(nullable: false),
                    FeedbackByActorId = table.Column<string>(maxLength: 180, nullable: true),
                    FeedbackByActorName = table.Column<string>(maxLength: 220, nullable: true),
                    FeedbackAtUtc = table.Column<DateTimeOffset>(nullable: true),
                    Revision = table.Column<int>(nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AiRuns", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_AiRuns_RunId",
                table: "AiRuns",
                column: "RunId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_AiRuns_Status",
                table: "AiRuns",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_AiRuns_TenantId_ProcessId_Id",
                table: "AiRuns",
                columns: new[] { "TenantId", "ProcessId", "Id" });
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "AiRuns");
        }
    }
}
