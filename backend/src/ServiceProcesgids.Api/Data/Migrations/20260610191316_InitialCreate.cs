using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ServiceProcesgids.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Processes",
                columns: table => new
                {
                    Id = table.Column<string>(type: "TEXT", maxLength: 160, nullable: false),
                    Hoofdproces = table.Column<string>(type: "TEXT", maxLength: 220, nullable: false),
                    Detailproces = table.Column<string>(type: "TEXT", maxLength: 320, nullable: false),
                    Versie = table.Column<string>(type: "TEXT", maxLength: 80, nullable: false),
                    Status = table.Column<string>(type: "TEXT", maxLength: 40, nullable: false),
                    LaatsteWijziging = table.Column<string>(type: "TEXT", maxLength: 40, nullable: false),
                    Revision = table.Column<int>(type: "INTEGER", nullable: false),
                    AantalStappen = table.Column<int>(type: "INTEGER", nullable: false),
                    KoppelingenJson = table.Column<string>(type: "TEXT", nullable: false),
                    DocumentJson = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Processes", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Processes_Hoofdproces",
                table: "Processes",
                column: "Hoofdproces");

            migrationBuilder.CreateIndex(
                name: "IX_Processes_Status",
                table: "Processes",
                column: "Status");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Processes");
        }
    }
}
