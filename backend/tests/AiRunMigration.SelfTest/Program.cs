using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Migrations;
using ServiceProcesgids.Api.Data;
using ServiceProcesgids.Api.Data.Entities;

const string PreviousMigration = "20260610233000_AddImportJobsAndFiles";
const string TargetMigration = "20260728200000_AddAiRunLedger";

var checks = new (string Name, Func<Task> Execute)[]
{
    ("migratie-id en catalogus blijven stabiel", TestMigrationCatalogAsync),
    ("SQLite-script gebruikt INTEGER identity en geldige indexen", TestSqliteScriptAsync),
    ("SQL Server-script gebruikt bigint IDENTITY en begrensde indexstrings", TestSqlServerScriptAsync),
    ("DbContext-model is providercorrect en indexeerbaar", TestProviderModelsAsync),
    ("bestaande SQLite-data overleeft gerichte upgrade", TestSqliteUpgradeAsync)
};

foreach (var check in checks)
{
    await check.Execute();
    Console.WriteLine($"{check.Name}: OK");
}

static Task TestMigrationCatalogAsync()
{
    using var db = CreateSqliteContext("Data Source=:memory:");
    var migrations = db.Database.GetMigrations().ToArray();
    Assert(
        migrations.Count(id => id == TargetMigration) == 1,
        "De bestaande AI-runmigratie-id moet exact één keer aanwezig blijven.");
    Assert(
        Array.IndexOf(migrations, TargetMigration) >
        Array.IndexOf(migrations, PreviousMigration),
        "De AI-runmigratie moet na de bestaande migratiegeschiedenis blijven staan.");
    return Task.CompletedTask;
}

static Task TestSqliteScriptAsync()
{
    using var db = CreateSqliteContext("Data Source=:memory:");
    var script = db.GetService<IMigrator>().GenerateScript(
        PreviousMigration,
        TargetMigration);

    AssertContains(script, "CREATE TABLE \"AiRuns\"");
    AssertContains(script, "\"Id\" INTEGER NOT NULL");
    AssertContains(script, "PRIMARY KEY AUTOINCREMENT");
    AssertContains(script, "CREATE UNIQUE INDEX \"IX_AiRuns_RunId\"");
    AssertContains(script, "CREATE INDEX \"IX_AiRuns_TenantId_ProcessId_Id\"");
    return Task.CompletedTask;
}

static Task TestSqlServerScriptAsync()
{
    using var db = CreateSqlServerContext();
    var script = db.GetService<IMigrator>().GenerateScript(
        PreviousMigration,
        TargetMigration);

    AssertContains(script, "CREATE TABLE [AiRuns]");
    AssertContains(script, "[Id] bigint NOT NULL IDENTITY");
    AssertContains(script, "[RunId] nvarchar(32) NOT NULL");
    AssertContains(script, "[TenantId] nvarchar(120) NOT NULL");
    AssertContains(script, "[ProcessId] nvarchar(160) NOT NULL");
    AssertContains(script, "CREATE UNIQUE INDEX [IX_AiRuns_RunId]");
    AssertContains(script, "CREATE INDEX [IX_AiRuns_TenantId_ProcessId_Id]");
    Assert(
        !script.Contains("[RunId] nvarchar(max)", StringComparison.Ordinal) &&
        !script.Contains("[TenantId] nvarchar(max)", StringComparison.Ordinal) &&
        !script.Contains("[ProcessId] nvarchar(max)", StringComparison.Ordinal),
        "Geen geïndexeerde AI-runstring mag nvarchar(max) zijn.");
    return Task.CompletedTask;
}

static Task TestProviderModelsAsync()
{
    using var sqlite = CreateSqliteContext("Data Source=:memory:");
    AssertAiRunModel(sqlite, "INTEGER", "TEXT");

    using var sqlServer = CreateSqlServerContext();
    AssertAiRunModel(sqlServer, "bigint", "nvarchar(32)");
    return Task.CompletedTask;
}

static async Task TestSqliteUpgradeAsync()
{
    var databasePath = Path.Combine(
        Path.GetTempPath(),
        $"spg-ai-run-migration-{Guid.NewGuid():N}.db");
    try
    {
        await using var db = CreateSqliteContext($"Data Source={databasePath};Pooling=False");
        var migrator = db.GetService<IMigrator>();
        await migrator.MigrateAsync(PreviousMigration);

        db.Processes.Add(new ProcessEntity
        {
            Id = "migration-portability-check",
            Hoofdproces = "Migratietest",
            Detailproces = "Bestaande data",
            Versie = "V1",
            Status = "concept",
            LaatsteWijziging = "2026-07-28",
            Revision = 1,
            KoppelingenJson = "[]",
            DocumentJson = "{}"
        });
        await db.SaveChangesAsync();
        Assert(
            !(await db.Database.GetAppliedMigrationsAsync()).Contains(TargetMigration),
            "De doelmigratie mag vóór de upgrade nog niet in de historie staan.");

        await migrator.MigrateAsync(TargetMigration);

        Assert(
            (await db.Database.GetAppliedMigrationsAsync()).Contains(TargetMigration),
            "De bestaande migratie-id moet na de upgrade in de historie staan.");
        Assert(
            await db.Processes.AnyAsync(item => item.Id == "migration-portability-check"),
            "Bestaande procesdata is tijdens de gerichte upgrade verloren gegaan.");

        db.AiRuns.AddRange(
            CreateRun("00000000000000000000000000000001"),
            CreateRun("00000000000000000000000000000002"));
        await db.SaveChangesAsync();
        var generatedIds = await db.AiRuns
            .OrderBy(item => item.Id)
            .Select(item => item.Id)
            .ToArrayAsync();
        Assert(
            generatedIds.Length == 2 &&
            generatedIds[0] > 0 &&
            generatedIds[1] == generatedIds[0] + 1,
            "SQLite heeft geen oplopende identitywaarden voor AiRuns gegenereerd.");
    }
    finally
    {
        if (File.Exists(databasePath))
        {
            File.Delete(databasePath);
        }
    }
}

static void AssertAiRunModel(
    AppDbContext db,
    string expectedIdColumnType,
    string expectedRunIdColumnType)
{
    var entity = db.Model.FindEntityType(typeof(AiRunEntity))
        ?? throw new InvalidOperationException("AiRunEntity ontbreekt in het DbContext-model.");
    var id = entity.FindProperty(nameof(AiRunEntity.Id))
        ?? throw new InvalidOperationException("AiRunEntity.Id ontbreekt.");
    var runId = entity.FindProperty(nameof(AiRunEntity.RunId))
        ?? throw new InvalidOperationException("AiRunEntity.RunId ontbreekt.");
    var tenantId = entity.FindProperty(nameof(AiRunEntity.TenantId))
        ?? throw new InvalidOperationException("AiRunEntity.TenantId ontbreekt.");
    var processId = entity.FindProperty(nameof(AiRunEntity.ProcessId))
        ?? throw new InvalidOperationException("AiRunEntity.ProcessId ontbreekt.");

    Assert(
        id.GetColumnType() == expectedIdColumnType &&
        id.ValueGenerated == ValueGenerated.OnAdd,
        $"Onjuist identitymodel: {id.GetColumnType()} / {id.ValueGenerated}.");
    Assert(
        runId.GetColumnType() == expectedRunIdColumnType &&
        runId.GetMaxLength() == 32 &&
        tenantId.GetMaxLength() == 120 &&
        processId.GetMaxLength() == 160,
        "De providerkolomtypen of lengtegrenzen van indexstrings zijn onjuist.");

    var indexes = entity.GetIndexes().ToArray();
    Assert(
        indexes.Any(index =>
            index.IsUnique &&
            index.Properties.Select(property => property.Name)
                .SequenceEqual([nameof(AiRunEntity.RunId)])),
        "De unieke RunId-index ontbreekt.");
    Assert(
        indexes.Any(index =>
            index.Properties.Select(property => property.Name)
                .SequenceEqual([
                    nameof(AiRunEntity.TenantId),
                    nameof(AiRunEntity.ProcessId),
                    nameof(AiRunEntity.Id)
                ])),
        "De tenant-/procesindex ontbreekt.");
}

static AppDbContext CreateSqliteContext(string connectionString)
{
    var options = new DbContextOptionsBuilder<AppDbContext>()
        .UseSqlite(connectionString)
        .Options;
    return new AppDbContext(options);
}

static AppDbContext CreateSqlServerContext()
{
    var options = new DbContextOptionsBuilder<AppDbContext>()
        .UseSqlServer(
            "Server=(localdb)\\MSSQLLocalDB;Database=SpgMigrationScriptOnly;" +
            "Trusted_Connection=True;TrustServerCertificate=True")
        .Options;
    return new AppDbContext(options);
}

static AiRunEntity CreateRun(string runId) =>
    new()
    {
        RunId = runId,
        TenantId = "single-tenant",
        Capability = "process-maintenance",
        ProcessId = "migration-portability-check",
        ProcessRevision = 1,
        ActorId = "selftest",
        ActorName = "Selftest",
        Status = "running",
        InputHash = $"sha256:{new string('a', 64)}",
        ProposedChangeIdsJson = "[]",
        AcceptedChangeIdsJson = "[]",
        Revision = 1
    };

static void AssertContains(string value, string expected) =>
    Assert(
        value.Contains(expected, StringComparison.Ordinal),
        $"Verwachte SQL-fragment ontbreekt: {expected}{Environment.NewLine}{value}");

static void Assert(bool condition, string message)
{
    if (!condition)
    {
        throw new InvalidOperationException(message);
    }
}
