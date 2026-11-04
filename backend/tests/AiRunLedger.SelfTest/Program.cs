using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using ServiceProcesgids.Api.Contract;
using ServiceProcesgids.Api.Data;
using ServiceProcesgids.Api.Data.Entities;
using ServiceProcesgids.Api.Models;
using ServiceProcesgids.Api.Services;

const string ProcessId = "ai-ledger-selftest";
const string RawChangeId = "change.customer-email";
var actor = new User("editor-1", "Editor Een", null, "selftest", ["bewerken"], []);

var checks = new (string Name, Func<Task> Execute)[]
{
    ("lifecycle-audit en opaque wijziging-id zijn atomair voorbereid", LifecycleAndPrivacyAsync),
    ("completion wordt stale na een revisiewijziging", CompletionRevisionRaceAsync),
    ("gearchiveerde historie blijft leesbaar maar feedback is geblokkeerd", ArchivedHistoryAsync),
    ("identieke feedback is actorgebonden idempotent", ConcurrentFeedbackAsync),
    ("oude running-runs worden naar stale genormaliseerd", RunningTimeoutAsync),
    ("feedbackreden is kort, enkelregelig en privacybegrensd", SafeFeedbackReasonAsync)
};

foreach (var check in checks)
{
    await check.Execute();
    Console.WriteLine($"{check.Name}: OK");
}

static async Task LifecycleAndPrivacyAsync()
{
    await using var harness = await LedgerHarness.CreateAsync();
    var runId = await harness.StartAsync();

    Assert(
        await harness.Db.AuditLogs.CountAsync(log =>
            log.Action == "ai.process-maintenance.requested" &&
            log.EntityId == ProcessId) == 1,
        "StartAsync schreef geen requested-audit naast de run.");

    await harness.CompleteProposalAsync(runId);
    harness.Db.ChangeTracker.Clear();
    var run = await harness.Db.AiRuns.AsNoTracking().SingleAsync(item => item.RunId == runId);
    var proposedIds = JsonSerializer.Deserialize<string[]>(run.ProposedChangeIdsJson) ?? [];

    Assert(run.Status == "completed", "De run is niet voltooid.");
    Assert(
        proposedIds.Length == 1 &&
        proposedIds[0].StartsWith("chg:v1:", StringComparison.Ordinal) &&
        proposedIds[0].Length == 71 &&
        !run.ProposedChangeIdsJson.Contains(RawChangeId, StringComparison.Ordinal),
        "Ruwe model-id is in de ledger opgeslagen.");
    Assert(
        await harness.Db.AuditLogs.CountAsync(log =>
            log.Action == "ai.process-maintenance.completed" &&
            log.EntityId == ProcessId) == 1,
        "CompleteAsync schreef geen completed-audit naast de run.");
}

static async Task CompletionRevisionRaceAsync()
{
    await using var harness = await LedgerHarness.CreateAsync();
    var runId = await harness.StartAsync();
    var process = await harness.Db.Processes.SingleAsync(item => item.Id == ProcessId);
    process.Revision = 2;
    await harness.Db.SaveChangesAsync();

    var exception = await ExpectLedgerExceptionAsync(() =>
        harness.CompleteProposalAsync(runId));

    Assert(
        exception.Code == "process-revision-changed" &&
        exception.StatusCode == StatusCodes.Status409Conflict,
        "Completion faalde niet gesloten op de gewijzigde procesrevisie.");
    harness.Db.ChangeTracker.Clear();
    var run = await harness.Db.AiRuns.AsNoTracking().SingleAsync(item => item.RunId == runId);
    Assert(
        run.Status == "stale" &&
        run.ErrorCode == "process-revision-changed",
        "De revision-race is niet als stale vastgelegd.");
    Assert(
        await harness.Db.AuditLogs.CountAsync(log =>
            log.Action == "ai.process-maintenance.failed" &&
            log.EntityId == ProcessId) == 1,
        "De stale completion mist haar atomaire failure-audit.");
}

static async Task ArchivedHistoryAsync()
{
    await using var harness = await LedgerHarness.CreateAsync();
    var runId = await harness.StartAsync();
    await harness.CompleteProposalAsync(runId);

    var process = await harness.Db.Processes.SingleAsync(item => item.Id == ProcessId);
    process.Status = "gearchiveerd";
    process.Revision = 2;
    await harness.Db.SaveChangesAsync();

    var history = await harness.Service.ListAsync(ProcessId, 50);
    Assert(
        history.Count == 1 && history[0].RunId == runId,
        "Gearchiveerde runhistorie is niet read-only bereikbaar.");

    var exception = await ExpectLedgerExceptionAsync(() =>
        harness.Service.RecordFeedbackAsync(
            ProcessId,
            runId,
            new AiRunFeedbackRequest("accepted", null, [RawChangeId]),
            harness.Actor));
    Assert(
        exception.Code == "process-revision-changed" &&
        exception.StatusCode == StatusCodes.Status409Conflict,
        "Feedback op een gearchiveerd of gereviseerd proces werd niet geblokkeerd.");
}

static async Task ConcurrentFeedbackAsync()
{
    await using var harness = await LedgerHarness.CreateAsync();
    var runId = await harness.StartAsync();
    await harness.CompleteProposalAsync(runId);
    harness.Db.ChangeTracker.Clear();

    await using var firstDb = harness.CreateContext();
    await using var secondDb = harness.CreateContext();
    var firstService = LedgerHarness.CreateService(firstDb);
    var secondService = LedgerHarness.CreateService(secondDb);
    var request = new AiRunFeedbackRequest("accepted", null, [RawChangeId]);

    var writes = await Task.WhenAll(
        firstService.RecordFeedbackAsync(ProcessId, runId, request, harness.Actor),
        secondService.RecordFeedbackAsync(ProcessId, runId, request, harness.Actor));
    Assert(
        writes.Count(write => write.Created) == 1 &&
        writes.Count(write => !write.Created) == 1,
        "Gelijktijdig identieke feedback was niet idempotent.");

    await using var otherDb = harness.CreateContext();
    var otherActor = new User(
        "editor-2",
        "Editor Twee",
        null,
        "selftest",
        ["bewerken"],
        []);
    var exception = await ExpectLedgerExceptionAsync(() =>
        LedgerHarness.CreateService(otherDb).RecordFeedbackAsync(
            ProcessId,
            runId,
            request,
            otherActor));
    Assert(
        exception.Code == "ai-run-feedback-already-recorded" &&
        exception.StatusCode == StatusCodes.Status409Conflict,
        "Een andere actor werd ten onrechte als idempotente retry behandeld.");
}

static async Task RunningTimeoutAsync()
{
    await using var harness = await LedgerHarness.CreateAsync();
    var runId = await harness.StartAsync(DateTimeOffset.UtcNow.AddMinutes(-20));

    var history = await harness.Service.ListAsync(ProcessId, 50);
    var run = history.Single(item => item.RunId == runId);
    Assert(
        run.Status == "stale" &&
        run.Foutcode == "ai-run-timeout" &&
        run.AfgerondOp is not null,
        "Een verlopen running-run is niet naar stale genormaliseerd.");
    Assert(
        await harness.Db.AuditLogs.CountAsync(log =>
            log.Action == "ai.process-maintenance.failed" &&
            log.ActorId == "system") == 1,
        "Timeoutnormalisatie mist een systeemaudit.");
}

static async Task SafeFeedbackReasonAsync()
{
    await using var harness = await LedgerHarness.CreateAsync();
    var runId = await harness.StartAsync();
    await harness.CompleteProposalAsync(runId);

    var unsafeException = await ExpectLedgerExceptionAsync(() =>
        harness.Service.RecordFeedbackAsync(
            ProcessId,
            runId,
            new AiRunFeedbackRequest(
                "rejected",
                "Mail naar auditor@example.com voor details.",
                []),
            harness.Actor));
    Assert(
        unsafeException.Code == "ai-run-feedback-reason-unsafe" &&
        unsafeException.StatusCode == StatusCodes.Status400BadRequest,
        "Contactgegevens werden in de feedbackreden toegelaten.");

    var write = await harness.Service.RecordFeedbackAsync(
        ProcessId,
        runId,
        new AiRunFeedbackRequest(
            "rejected",
            "  Onderbouwing voor ISO 27001 is nog onvoldoende.  ",
            []),
        harness.Actor);
    Assert(
        write.Created &&
        write.Run.Feedback?.Reden == "Onderbouwing voor ISO 27001 is nog onvoldoende.",
        "Veilige compacte feedbackreden werd niet genormaliseerd en opgeslagen.");
}

static async Task<AiRunLedgerException> ExpectLedgerExceptionAsync(Func<Task> action)
{
    try
    {
        await action();
    }
    catch (AiRunLedgerException exception)
    {
        return exception;
    }

    throw new InvalidOperationException("Verwachte AiRunLedgerException werd niet gegooid.");
}

static void Assert(bool condition, string message)
{
    if (!condition)
    {
        throw new InvalidOperationException(message);
    }
}

sealed class LedgerHarness : IAsyncDisposable
{
    private const string ProcessId = "ai-ledger-selftest";
    private const string RawChangeId = "change.customer-email";
    private readonly string _databasePath;
    private readonly DbContextOptions<AppDbContext> _options;

    private LedgerHarness(
        string databasePath,
        DbContextOptions<AppDbContext> options,
        AppDbContext db,
        User actor)
    {
        _databasePath = databasePath;
        _options = options;
        Db = db;
        Actor = actor;
        Service = CreateService(db);
    }

    public AppDbContext Db { get; }
    public User Actor { get; }
    public AiRunLedgerService Service { get; }

    public static async Task<LedgerHarness> CreateAsync()
    {
        var databasePath = Path.Combine(
            Path.GetTempPath(),
            $"spg-ai-run-ledger-{Guid.NewGuid():N}.db");
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite($"Data Source={databasePath};Pooling=False;Default Timeout=30")
            .Options;
        var db = new AppDbContext(options);
        await db.Database.EnsureCreatedAsync();
        db.Processes.Add(new ProcessEntity
        {
            Id = ProcessId,
            Hoofdproces = "Selftest",
            Detailproces = "AI-runledger",
            Versie = "V1",
            Status = "concept",
            LaatsteWijziging = "2026-07-28",
            Revision = 1,
            KoppelingenJson = "[]",
            DocumentJson = "{}"
        });
        await db.SaveChangesAsync();
        var actor = new User(
            "editor-1",
            "Editor Een",
            null,
            "selftest",
            ["bewerken"],
            []);
        return new LedgerHarness(databasePath, options, db, actor);
    }

    public AppDbContext CreateContext() => new(_options);

    public static AiRunLedgerService CreateService(AppDbContext db) =>
        new(db, NullLogger<AiRunLedgerService>.Instance);

    public async Task<string> StartAsync(DateTimeOffset? startedAtUtc = null)
    {
        var runId = Guid.NewGuid().ToString("N");
        await Service.StartAsync(
            runId,
            ProcessMaintenanceService.Capability,
            ProcessId,
            1,
            Actor,
            $"sha256:{new string('a', 64)}",
            startedAtUtc ?? DateTimeOffset.UtcNow,
            new AiRunRequestAuditMetadata(
                ProcessMaintenanceService.SchemaVersion,
                1,
                1,
                true,
                0,
                "handmatig"));
        return runId;
    }

    public async Task CompleteProposalAsync(string runId)
    {
        await Service.CompleteAsync(
            runId,
            "OpenAI",
            "selftest-model",
            "voorstel",
            $"sha256:{new string('b', 64)}",
            0,
            1,
            1,
            [RawChangeId],
            DateTimeOffset.UtcNow,
            100);
    }

    public async ValueTask DisposeAsync()
    {
        await Db.DisposeAsync();
        if (File.Exists(_databasePath))
        {
            File.Delete(_databasePath);
        }
    }
}
