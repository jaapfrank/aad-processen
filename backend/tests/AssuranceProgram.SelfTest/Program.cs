using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using ServiceProcesgids.Api.Contract;
using ServiceProcesgids.Api.Data;
using ServiceProcesgids.Api.Data.Entities;
using ServiceProcesgids.Api.Models;
using ServiceProcesgids.Api.Services;

const string PreviousMigration = "20260728200000_AddAiRunLedger";
const string TargetMigration = "20260728210000_AddAssuranceProgramV1";

var checks = new (string Name, Func<Task> Execute)[]
{
    ("catalogus bevat acht openbare kaders zonder normtekst", TestCatalog),
    ("instellingen dwingen actieve monitoring en intervalvloer af", TestSettings),
    ("normcoach valideert bewijs, nvt-motivatie en revisies", TestQuestionnaire),
    ("assurancerun vindt ontbrekende assessments en procesgovernance", TestRun),
    ("migratie is portable voor SQLite en SQL Server", TestMigration)
};

foreach (var check in checks)
{
    await check.Execute();
    Console.WriteLine($"{check.Name}: OK");
}

static Task TestCatalog()
{
    var catalog = new AssuranceFrameworkCatalogService();
    var document = catalog.CreateCatalog(
        new HashSet<string>(["iso9001"], StringComparer.OrdinalIgnoreCase));
    Assert(document.Kaders.Count == 8, "De catalogus moet acht kaders bevatten.");
    Assert(
        document.Kaders.Select(item => item.Id).ToHashSet().SetEquals(
            ["iso9001", "iso27001", "iso14001", "iso45001", "iso22301", "bpmn20", "nis2", "avg"]),
        "De vaste kader-id's zijn onvolledig.");
    Assert(
        document.Kaders.All(item =>
            item.Vragen.Count >= 2 &&
            item.BronUrl.StartsWith("https://", StringComparison.Ordinal) &&
            item.Vragen.All(question =>
                !question.Vraag.Contains("§", StringComparison.Ordinal) &&
                !question.Vraag.Contains("shall", StringComparison.OrdinalIgnoreCase))),
        "De catalogus moet eigen hoog-over evidencevragen en openbare bronmetadata bevatten.");
    Assert(
        document.Kaders.Single(item => item.Id == "iso9001").Actief &&
        document.Kaders.Count(item => item.Actief) == 1,
        "Actieve kaders worden niet correct geprojecteerd.");
    return Task.CompletedTask;
}

static async Task TestSettings()
{
    await using var fixture = await Fixture.Create();
    var initial = await fixture.Settings.GetAsync();
    Assert(
        initial.MonitoringActief &&
        initial.MaximaalIntervalUren == 720 &&
        initial.AangevraagdIntervalUren == 720 &&
        initial.ActieveKaderIds.SequenceEqual(["iso9001"]),
        "De veilige standaardinstellingen zijn onjuist.");

    var updated = await fixture.Settings.SaveAsync(
        new AssuranceSettingsUpdateRequest(
            initial.Revision,
            ["avg", "iso27001"],
            24),
        fixture.Actor);
    Assert(
        updated.EffectiefIntervalUren == 24 &&
        updated.ActieveKaderIds.SequenceEqual(["avg", "iso27001"]) &&
        updated.Revision == initial.Revision + 1,
        "Een strengere instelling is niet opgeslagen.");

    await ExpectCode(
        () => fixture.Settings.SaveAsync(
            new AssuranceSettingsUpdateRequest(
                updated.Revision,
                ["iso9001"],
                721),
            fixture.Actor),
        "assurance-interval-invalid");
    await ExpectCode(
        () => fixture.Settings.SaveAsync(
            new AssuranceSettingsUpdateRequest(
                updated.Revision,
                [],
                720),
            fixture.Actor),
        "assurance-framework-required");
    await ExpectCode(
        () => fixture.Settings.SaveAsync(
            new AssuranceSettingsUpdateRequest(
                initial.Revision,
                ["iso9001"],
                720),
            fixture.Actor),
        "assurance-settings-revision-changed");
    Assert(
        await fixture.Db.AuditLogs.AnyAsync(item =>
            item.Action == "assurance.settings.update"),
        "De instellingenwijziging is niet geaudit.");
}

static async Task TestQuestionnaire()
{
    await using var fixture = await Fixture.Create();
    var initial = await fixture.Settings.GetAsync();
    await fixture.Settings.SaveAsync(
        new AssuranceSettingsUpdateRequest(
            initial.Revision,
            ["iso27001"],
            720),
        fixture.Actor);
    var session = await fixture.Questionnaires.StartAsync(
        "iso27001",
        fixture.Actor);
    var firstQuestion = session.Vragen[0];
    var secondQuestion = session.Vragen[1];

    await ExpectCode(
        () => fixture.Questionnaires.AnswerAsync(
            session.SessionId,
            new AssuranceQuestionnaireAnswerRequest(
                session.Revision,
                firstQuestion.Id,
                "ja",
                null,
                null),
            fixture.Actor),
        "assurance-evidence-required");

    var afterFirst = await fixture.Questionnaires.AnswerAsync(
        session.SessionId,
        new AssuranceQuestionnaireAnswerRequest(
            session.Revision,
            firstQuestion.Id,
            "ja",
            "evidence://risk-register/2026-Q2",
            null),
        fixture.Actor);
    Assert(
        afterFirst.Status == "open" &&
        afterFirst.Readiness.Beantwoord == 1 &&
        afterFirst.Readiness.BewijsGereed == 1,
        "Het eerste evidenceantwoord is niet correct verwerkt.");

    await ExpectCode(
        () => fixture.Questionnaires.AnswerAsync(
            session.SessionId,
            new AssuranceQuestionnaireAnswerRequest(
                session.Revision,
                secondQuestion.Id,
                "nee",
                null,
                null),
            fixture.Actor),
        "assurance-questionnaire-revision-changed");
    await ExpectCode(
        () => fixture.Questionnaires.AnswerAsync(
            session.SessionId,
            new AssuranceQuestionnaireAnswerRequest(
                afterFirst.Revision,
                secondQuestion.Id,
                "nvt",
                null,
                "te kort"),
            fixture.Actor),
        "assurance-na-motivation-required");

    var completed = await fixture.Questionnaires.AnswerAsync(
        session.SessionId,
        new AssuranceQuestionnaireAnswerRequest(
            afterFirst.Revision,
            secondQuestion.Id,
            "nvt",
            null,
            "Deze maatregel valt aantoonbaar buiten de vastgelegde scope."),
        fixture.Actor);
    Assert(
        completed.Status == "gereed" &&
        completed.Readiness.Open == 0 &&
        completed.Readiness.Nvt == 1 &&
        completed.Readiness.Disclaimer.Contains(
            "geen conformiteits",
            StringComparison.OrdinalIgnoreCase),
        "Een voltooide vragenlijst mag alleen readiness rapporteren.");
}

static async Task TestRun()
{
    await using var fixture = await Fixture.Create();
    fixture.Db.Processes.Add(new ProcessEntity
    {
        Id = "proces-zonder-governance",
        Hoofdproces = "Test",
        Detailproces = "Zonder governance",
        Versie = "V1",
        Status = "live",
        LaatsteWijziging = "2026-07-28",
        Revision = 1,
        DocumentJson = "{}"
    });
    await fixture.Db.SaveChangesAsync();

    var initial = await fixture.Settings.GetAsync();
    await fixture.Settings.SaveAsync(
        new AssuranceSettingsUpdateRequest(
            initial.Revision,
            ["avg", "iso27001"],
            168),
        fixture.Actor);
    var isoSession = await fixture.Questionnaires.StartAsync(
        "iso27001",
        fixture.Actor);
    _ = await fixture.Questionnaires.AnswerAsync(
        isoSession.SessionId,
        new AssuranceQuestionnaireAnswerRequest(
            isoSession.Revision,
            isoSession.Vragen[0].Id,
            "onbekend",
            null,
            null),
        fixture.Actor);

    var run = await fixture.Runs.RunManualAsync(fixture.Actor);
    Assert(
        run.Status == "completed" &&
        run.FindingCount == run.Bevindingen.Count &&
        run.Bevindingen.Any(item =>
            item.KaderId == "avg" &&
            item.Type == "assessment-ontbreekt") &&
        run.Bevindingen.Any(item =>
            item.KaderId == "iso27001" &&
            item.Type == "assessment-onvolledig") &&
        run.Bevindingen.Any(item =>
            item.ProcesId == "proces-zonder-governance" &&
            item.Type == "proces-eigenaar-ontbreekt") &&
        run.Bevindingen.Any(item =>
            item.ProcesId == "proces-zonder-governance" &&
            item.Type == "proces-review-ontbreekt"),
        "De deterministische run mist verwachte readiness- of governancebevindingen.");
    var status = await fixture.Runs.GetMonitoringStatusAsync();
    Assert(
        status.MonitoringActief &&
        status.LaatsteRun?.RunId == run.RunId &&
        !status.Achterstallig,
        "De due-status is na een geslaagde run niet bijgewerkt.");
    Assert(
        await fixture.Db.AuditLogs.AnyAsync(item =>
            item.Action == "assurance.run.complete" &&
            item.EntityId == run.RunId),
        "De voltooide assurance-run is niet geaudit.");
}

static Task TestMigration()
{
    using var sqlite = CreateSqliteContext("Data Source=:memory:");
    var sqliteScript = sqlite.GetService<IMigrator>().GenerateScript(
        PreviousMigration,
        TargetMigration);
    AssertContains(sqliteScript, "CREATE TABLE \"AssuranceSettings\"");
    AssertContains(sqliteScript, "CREATE TABLE \"AssuranceRuns\"");
    AssertContains(sqliteScript, "\"Id\" INTEGER NOT NULL");
    AssertContains(sqliteScript, "PRIMARY KEY AUTOINCREMENT");
    AssertContains(sqliteScript, "CREATE UNIQUE INDEX \"IX_AssuranceQuestionnaireAnswers_SessionId_QuestionId\"");

    using var sqlServer = CreateSqlServerContext();
    var sqlServerScript = sqlServer.GetService<IMigrator>().GenerateScript(
        PreviousMigration,
        TargetMigration);
    AssertContains(sqlServerScript, "CREATE TABLE [AssuranceSettings]");
    AssertContains(sqlServerScript, "CREATE TABLE [AssuranceRuns]");
    AssertContains(sqlServerScript, "[Id] bigint NOT NULL IDENTITY");
    AssertContains(sqlServerScript, "[SessionId] nvarchar(32) NOT NULL");
    Assert(
        !sqlServerScript.Contains("[SessionId] nvarchar(max)", StringComparison.Ordinal) &&
        !sqlServerScript.Contains("[RunId] nvarchar(max)", StringComparison.Ordinal),
        "Geïndexeerde assurance-id's mogen in SQL Server geen nvarchar(max) zijn.");
    return Task.CompletedTask;
}

static async Task ExpectCode(
    Func<Task> action,
    string expectedCode)
{
    try
    {
        await action();
        throw new InvalidOperationException(
            $"Verwachte foutcode '{expectedCode}' is niet opgetreden.");
    }
    catch (AssuranceException ex)
    {
        Assert(
            ex.Code == expectedCode,
            $"Verwachte foutcode '{expectedCode}', ontvangen '{ex.Code}'.");
    }
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
            "Server=(localdb)\\MSSQLLocalDB;Database=SpgAssuranceScriptOnly;" +
            "Trusted_Connection=True;TrustServerCertificate=True")
        .Options;
    return new AppDbContext(options);
}

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

sealed class FrozenTimeProvider(DateTimeOffset now) : TimeProvider
{
    public override DateTimeOffset GetUtcNow() => now;
}

sealed class Fixture : IAsyncDisposable
{
    private readonly SqliteConnection _connection;

    private Fixture(
        SqliteConnection connection,
        AppDbContext db,
        AssuranceSettingsService settings,
        AssuranceQuestionnaireService questionnaires,
        AssuranceRunService runs)
    {
        _connection = connection;
        Db = db;
        Settings = settings;
        Questionnaires = questionnaires;
        Runs = runs;
    }

    public AppDbContext Db { get; }
    public AssuranceSettingsService Settings { get; }
    public AssuranceQuestionnaireService Questionnaires { get; }
    public AssuranceRunService Runs { get; }
    public User Actor { get; } = new(
        "selftest",
        "Assurance selftest",
        null,
        "test",
        RoleNames.All,
        []);

    public static async Task<Fixture> Create()
    {
        var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite(connection)
            .Options;
        var db = new AppDbContext(options);
        await db.Database.EnsureCreatedAsync();
        var time = new FrozenTimeProvider(
            new DateTimeOffset(2026, 7, 28, 12, 0, 0, TimeSpan.Zero));
        var catalog = new AssuranceFrameworkCatalogService();
        var audit = new AuditLogService(db);
        var settings = new AssuranceSettingsService(
            db,
            catalog,
            audit,
            time);
        var questionnaires = new AssuranceQuestionnaireService(
            db,
            catalog,
            settings,
            audit,
            time);
        var iso = new IsoService(db);
        var runs = new AssuranceRunService(
            db,
            catalog,
            settings,
            iso,
            audit,
            time);
        return new Fixture(
            connection,
            db,
            settings,
            questionnaires,
            runs);
    }

    public async ValueTask DisposeAsync()
    {
        await Db.DisposeAsync();
        await _connection.DisposeAsync();
    }
}
