using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using ServiceProcesgids.Api.Contract;
using ServiceProcesgids.Api.Data;
using ServiceProcesgids.Api.Models;
using ServiceProcesgids.Api.Services;

await using var connection = new SqliteConnection("Data Source=:memory:");
await connection.OpenAsync();
var options = new DbContextOptionsBuilder<AppDbContext>()
    .UseSqlite(connection)
    .Options;
await using var db = new AppDbContext(options);
await db.Database.EnsureCreatedAsync();

var actor = new User(
    "beheerder-1",
    "Testbeheerder",
    "beheerder@example.test",
    "test",
    ["beheren"],
    []);
var validOutput =
    """
    {
      "schemaVersion": "assurance-framework-draft.v1",
      "vragen": [
        {
          "id": "governance-eigenaarschap",
          "titel": "Eigenaarschap",
          "vraag": "Is aantoonbaar wie voor dit onderwerp verantwoordelijk is?",
          "bewijsHint": "Verwijs naar een actuele roltoewijzing en beoordeling."
        },
        {
          "id": "uitvoering-bewijs",
          "titel": "Uitvoering",
          "vraag": "Bestaat actueel bewijs dat de afgesproken beheersing wordt uitgevoerd?",
          "bewijsHint": "Verwijs naar gedateerde registraties, controles of testresultaten."
        },
        {
          "id": "evaluatie-verbetering",
          "titel": "Evaluatie en verbetering",
          "vraag": "Worden afwijkingen aantoonbaar geëvalueerd en opgevolgd?",
          "bewijsHint": "Verwijs naar bevindingen, besluiten, acties en hertoetsing."
        }
      ]
    }
    """;
var fakeAi = new FakeStructuredClient(validOutput);
var service = CreateService(db, fakeAi);
var request = ValidRequest();

await ExpectAsync(
    "rechten verplicht vóór AI",
    "assurance-framework-usage-rights-required",
    () => service.CreateWithAiAsync(
        actor,
        request with { GebruiksrechtenBevestigd = false }));
Equal(0, fakeAi.CallCount, "AI mag niet worden aangeroepen vóór rechtenbevestiging");

var draft = await service.CreateWithAiAsync(actor, request);
Equal("concept", draft.Status, "nieuw AI-resultaat blijft concept");
Equal(1, draft.Revision, "concept start op revisie 1");
Equal("test-provider", draft.Provider, "provider wordt herleidbaar vastgelegd");
Equal("test-model", draft.Model, "model wordt herleidbaar vastgelegd");
True(draft.OutputHash.Length == 64, "exacte vragen krijgen een inhoudshash");
Equal(3, draft.Vragen.Count, "begrensde vragen worden opgeslagen");
Equal(
    AssuranceFrameworkDraftService.Capability,
    fakeAi.LastCapability,
    "capability is begrensd");
True(
    fakeAi.LastInputJson?.Contains(request.PubliekeSamenvatting, StringComparison.Ordinal) == true,
    "alleen de zelf ingevoerde samenvatting gaat naar de fake-provider");
Equal(
    0,
    service.GetPublishedCatalogEntries().Count,
    "concept staat niet in catalogus");

await ExpectAsync(
    "publicatie vereist twee controles",
    "assurance-framework-draft-review-required",
    () => service.PublishAsync(
        draft.DraftId,
        actor,
        new AssuranceFrameworkDraftPublishRequest(
            draft.Revision,
            true,
            false,
            true)));

var published = await service.PublishAsync(
    draft.DraftId,
    actor,
    new AssuranceFrameworkDraftPublishRequest(draft.Revision, true, true, true));
Equal("published", published.Status, "expliciet besluit publiceert");
Equal(2, published.Revision, "publicatie verhoogt revisie");
var catalogEntries = service.GetPublishedCatalogEntries();
Equal(1, catalogEntries.Count, "gepubliceerd kader staat in catalogus");
False(catalogEntries[0].Actief, "publicatie activeert kader niet");
var dynamicCatalog = new AssuranceFrameworkCatalogService(service);
True(
    dynamicCatalog.CurrentVersion.StartsWith(
        $"{AssuranceFrameworkCatalogService.Version}+custom.",
        StringComparison.Ordinal),
    "publicatie verandert catalogusversie deterministisch");
True(
    dynamicCatalog.IsKnown(published.KaderId),
    "gepubliceerd custom kader is beschikbaar voor settings en Normcoach");

await ExpectAsync(
    "stale revisie wordt geweigerd",
    "assurance-framework-draft-revision-conflict",
    () => service.PublishAsync(
        draft.DraftId,
        actor,
        new AssuranceFrameworkDraftPublishRequest(1, true, true, true)));

var rejectable = await service.CreateWithAiAsync(
    actor,
    request with { Naam = "Afwijsbaar kader" });
var rejected = await service.RejectAsync(
    rejectable.DraftId,
    actor,
    new AssuranceFrameworkDraftRejectRequest(
        rejectable.Revision,
        "De tweede toetsvraag is voor deze publieke bron niet controleerbaar."));
Equal("rejected", rejected.Status, "concept kan auditbaar worden afgewezen");
Equal(2, rejected.Revision, "afwijzing verhoogt revisie");
Equal(
    1,
    service.GetPublishedCatalogEntries().Count,
    "afgewezen concept komt niet in catalogus");

var invalidAi = new FakeStructuredClient(
    """
    {"schemaVersion":"assurance-framework-draft.v1","vragen":[{"id":"te-weinig","titel":"Titel","vraag":"Is dit genoeg?","bewijsHint":"Bewijs."}]}
    """);
await ExpectAsync(
    "ongeldig AI-contract wordt niet opgeslagen",
    "assurance-framework-ai-output-invalid",
    () => CreateService(db, invalidAi).CreateWithAiAsync(
        actor,
        request with { Naam = "Ongeldig kader" }));

var unavailableAi = new ThrowingStructuredClient();
try
{
    await CreateService(db, unavailableAi).CreateWithAiAsync(
        actor,
        request with { Naam = "Niet geconfigureerd" });
    throw new InvalidOperationException("Niet-geconfigureerde AI had moeten falen.");
}
catch (AiConfigurationException exception)
{
    Equal("ai-not-active", exception.Code, "AI-configuratiefout blijft fail-closed");
}

var auditActions = await db.AuditLogs
    .AsNoTracking()
    .Select(item => item.Action)
    .ToListAsync();
True(
    auditActions.Contains("assurance.framework-draft.create-ai"),
    "conceptcreatie is geaudit");
True(
    auditActions.Contains("assurance.framework-draft.ai-attempt"),
    "AI-poging is vóór provideruitvoering geaudit");
True(
    auditActions.Contains("assurance.framework-draft.ai-result"),
    "mislukte AI-uitkomst is privacyarm geaudit");
True(
    auditActions.Contains("assurance.framework-draft.publish"),
    "publicatie is geaudit");
True(
    auditActions.Contains("assurance.framework-draft.reject"),
    "afwijzing is geaudit");

await using var migrationConnection = new SqliteConnection("Data Source=:memory:");
await migrationConnection.OpenAsync();
await using (var migrationDb = new AppDbContext(
                 new DbContextOptionsBuilder<AppDbContext>()
                     .UseSqlite(migrationConnection)
                     .Options))
{
    await migrationDb.Database.MigrateAsync();
}
await using (var tableCheck = migrationConnection.CreateCommand())
{
    tableCheck.CommandText =
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'AssuranceFrameworkDrafts'";
    Equal(
        1L,
        Convert.ToInt64(await tableCheck.ExecuteScalarAsync()),
        "provider-portable migratie maakt drafttabel");
}

Console.WriteLine("AssuranceFrameworkDrafts.SelfTest: OK");

static AssuranceFrameworkDraftService CreateService(
    AppDbContext db,
    IAiStructuredClient ai) =>
    new(
        db,
        ai,
        new AuditLogService(db),
        NullLogger<AssuranceFrameworkDraftService>.Instance);

static AssuranceFrameworkDraftCreateRequest ValidRequest() =>
    new(
        "https://example.test/official/framework",
        "Voorbeeldautoriteit",
        "Voorbeeldkader",
        "2026",
        "Governance en beheersing",
        "Deze zelfgeschreven openbare samenvatting beschrijft op hoog niveau dat eigenaarschap, aantoonbare uitvoering, periodieke evaluatie en opvolging van afwijkingen binnen de gekozen organisatorische scope worden beheerst.",
        true);

static async Task ExpectAsync(
    string name,
    string expectedCode,
    Func<Task> action)
{
    try
    {
        await action();
        throw new InvalidOperationException($"{name}: verwachte fout bleef uit.");
    }
    catch (AssuranceFrameworkDraftException exception)
    {
        Equal(expectedCode, exception.Code, name);
    }
}

static void Equal<T>(T expected, T actual, string name)
{
    if (!EqualityComparer<T>.Default.Equals(expected, actual))
    {
        throw new InvalidOperationException(
            $"{name}: verwacht '{expected}', kreeg '{actual}'.");
    }
}

static void True(bool value, string name)
{
    if (!value)
    {
        throw new InvalidOperationException($"{name}: verwacht true.");
    }
}

static void False(bool value, string name) => True(!value, name);

sealed class FakeStructuredClient(string output) : IAiStructuredClient
{
    public int CallCount { get; private set; }
    public string? LastCapability { get; private set; }
    public string? LastInputJson { get; private set; }

    public Task<AiStructuredTextResult> CompleteStructuredAsync(
        string capability,
        string systemInstructions,
        string inputJson,
        int maxOutputTokens,
        CancellationToken cancellationToken)
    {
        CallCount++;
        LastCapability = capability;
        LastInputJson = inputJson;
        return Task.FromResult(
            new AiStructuredTextResult(output, "test-provider", "test-model"));
    }
}

sealed class ThrowingStructuredClient : IAiStructuredClient
{
    public Task<AiStructuredTextResult> CompleteStructuredAsync(
        string capability,
        string systemInstructions,
        string inputJson,
        int maxOutputTokens,
        CancellationToken cancellationToken) =>
        throw new AiConfigurationException(
            "ai-not-active",
            "AI is niet geconfigureerd.");
}
