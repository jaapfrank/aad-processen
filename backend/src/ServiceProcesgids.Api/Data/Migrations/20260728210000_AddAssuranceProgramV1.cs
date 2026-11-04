using System;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using ServiceProcesgids.Api.Data;

#nullable disable

namespace ServiceProcesgids.Api.Data.Migrations
{
    [DbContext(typeof(AppDbContext))]
    [Migration("20260728210000_AddAssuranceProgramV1")]
    public partial class AddAssuranceProgramV1 : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "AssuranceQuestionnaireSessions",
                columns: table => new
                {
                    SessionId = table.Column<string>(maxLength: 32, nullable: false),
                    TenantId = table.Column<string>(maxLength: 120, nullable: false),
                    FrameworkId = table.Column<string>(maxLength: 80, nullable: false),
                    CatalogVersion = table.Column<string>(maxLength: 120, nullable: false),
                    Status = table.Column<string>(maxLength: 30, nullable: false),
                    StartedByActorId = table.Column<string>(maxLength: 180, nullable: false),
                    StartedByActorName = table.Column<string>(maxLength: 220, nullable: false),
                    StartedAtUtc = table.Column<DateTimeOffset>(nullable: false),
                    CompletedAtUtc = table.Column<DateTimeOffset>(nullable: true),
                    Revision = table.Column<int>(nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AssuranceQuestionnaireSessions", x => x.SessionId);
                });

            migrationBuilder.CreateTable(
                name: "AssuranceRuns",
                columns: table => new
                {
                    Id = table.Column<long>(nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1")
                        .Annotation("Sqlite:Autoincrement", true),
                    RunId = table.Column<string>(maxLength: 32, nullable: false),
                    TenantId = table.Column<string>(maxLength: 120, nullable: false),
                    Trigger = table.Column<string>(maxLength: 30, nullable: false),
                    ScheduleKey = table.Column<string>(maxLength: 180, nullable: true),
                    Status = table.Column<string>(maxLength: 30, nullable: false),
                    CatalogVersion = table.Column<string>(maxLength: 120, nullable: false),
                    FrameworkIdsJson = table.Column<string>(nullable: false),
                    StartedByActorId = table.Column<string>(maxLength: 180, nullable: false),
                    StartedByActorName = table.Column<string>(maxLength: 220, nullable: false),
                    StartedAtUtc = table.Column<DateTimeOffset>(nullable: false),
                    CompletedAtUtc = table.Column<DateTimeOffset>(nullable: true),
                    FindingCount = table.Column<int>(nullable: false),
                    ErrorCode = table.Column<string>(maxLength: 120, nullable: true),
                    Revision = table.Column<int>(nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AssuranceRuns", x => x.Id);
                    table.UniqueConstraint("AK_AssuranceRuns_RunId", x => x.RunId);
                });

            migrationBuilder.CreateTable(
                name: "AssuranceSettings",
                columns: table => new
                {
                    TenantId = table.Column<string>(maxLength: 120, nullable: false),
                    ActiveFrameworkIdsJson = table.Column<string>(nullable: false),
                    RequestedIntervalHours = table.Column<int>(nullable: false),
                    NextRunAtUtc = table.Column<DateTimeOffset>(nullable: false),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(nullable: false),
                    UpdatedBy = table.Column<string>(maxLength: 220, nullable: false),
                    Revision = table.Column<int>(nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AssuranceSettings", x => x.TenantId);
                });

            migrationBuilder.CreateTable(
                name: "AssuranceQuestionnaireAnswers",
                columns: table => new
                {
                    Id = table.Column<long>(nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1")
                        .Annotation("Sqlite:Autoincrement", true),
                    SessionId = table.Column<string>(maxLength: 32, nullable: false),
                    QuestionId = table.Column<string>(maxLength: 80, nullable: false),
                    Outcome = table.Column<string>(maxLength: 20, nullable: false),
                    EvidenceReference = table.Column<string>(maxLength: 500, nullable: true),
                    Motivation = table.Column<string>(maxLength: 2000, nullable: true),
                    AnsweredByActorId = table.Column<string>(maxLength: 180, nullable: false),
                    AnsweredByActorName = table.Column<string>(maxLength: 220, nullable: false),
                    AnsweredAtUtc = table.Column<DateTimeOffset>(nullable: false),
                    Revision = table.Column<int>(nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AssuranceQuestionnaireAnswers", x => x.Id);
                    table.ForeignKey(
                        name: "FK_AssuranceQuestionnaireAnswers_AssuranceQuestionnaireSessions_SessionId",
                        column: x => x.SessionId,
                        principalTable: "AssuranceQuestionnaireSessions",
                        principalColumn: "SessionId",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "AssuranceFindings",
                columns: table => new
                {
                    Id = table.Column<long>(nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1")
                        .Annotation("Sqlite:Autoincrement", true),
                    FindingId = table.Column<string>(maxLength: 80, nullable: false),
                    RunId = table.Column<string>(maxLength: 32, nullable: false),
                    FrameworkId = table.Column<string>(maxLength: 80, nullable: true),
                    ProcessId = table.Column<string>(maxLength: 160, nullable: true),
                    QuestionId = table.Column<string>(maxLength: 80, nullable: true),
                    Type = table.Column<string>(maxLength: 80, nullable: false),
                    Severity = table.Column<string>(maxLength: 20, nullable: false),
                    Title = table.Column<string>(maxLength: 240, nullable: false),
                    Message = table.Column<string>(maxLength: 2000, nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AssuranceFindings", x => x.Id);
                    table.ForeignKey(
                        name: "FK_AssuranceFindings_AssuranceRuns_RunId",
                        column: x => x.RunId,
                        principalTable: "AssuranceRuns",
                        principalColumn: "RunId",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_AssuranceFindings_FindingId",
                table: "AssuranceFindings",
                column: "FindingId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_AssuranceFindings_RunId",
                table: "AssuranceFindings",
                column: "RunId");

            migrationBuilder.CreateIndex(
                name: "IX_AssuranceQuestionnaireAnswers_SessionId_QuestionId",
                table: "AssuranceQuestionnaireAnswers",
                columns: new[] { "SessionId", "QuestionId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_AssuranceQuestionnaireSessions_Status",
                table: "AssuranceQuestionnaireSessions",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_AssuranceQuestionnaireSessions_TenantId_FrameworkId_StartedAtUtc",
                table: "AssuranceQuestionnaireSessions",
                columns: new[] { "TenantId", "FrameworkId", "StartedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_AssuranceRuns_ScheduleKey",
                table: "AssuranceRuns",
                column: "ScheduleKey",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_AssuranceRuns_Status",
                table: "AssuranceRuns",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_AssuranceRuns_TenantId_Id",
                table: "AssuranceRuns",
                columns: new[] { "TenantId", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_AssuranceSettings_NextRunAtUtc",
                table: "AssuranceSettings",
                column: "NextRunAtUtc");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "AssuranceFindings");
            migrationBuilder.DropTable(name: "AssuranceQuestionnaireAnswers");
            migrationBuilder.DropTable(name: "AssuranceSettings");
            migrationBuilder.DropTable(name: "AssuranceRuns");
            migrationBuilder.DropTable(name: "AssuranceQuestionnaireSessions");
        }
    }
}
