using System.Data.Common;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using ServiceProcesgids.Api.Contract;
using ServiceProcesgids.Api.Data;
using ServiceProcesgids.Api.Data.Entities;
using ServiceProcesgids.Api.Models;
using ServiceProcesgids.Api.Services;

var tests = new (string Name, Func<Task> Run)[]
{
    ("sessies vervallen bij deactiveren en blijven ongeldig na heractiveren", DeactivateAsync),
    ("rolwijziging trekt oude sessie in; nieuwe login heeft actuele rollen", ChangeRolesAsync),
    ("wachtwoordreset trekt bestaande sessies in en oude login werkt niet", ChangePasswordAsync),
    ("legacy, onbekende en verwijderde accounts krijgen geen geldige sessie", InvalidSessionsAsync),
    ("laatste actieve beheerder kan niet worden gedeactiveerd of gedegradeerd", LastAdministratorAsync),
    ("workflow vereist bekeken revisie en weigert herhaalde acties", RevisionAndReplayAsync),
    ("oude review kan gewijzigde opnieuw ingediende inhoud niet publiceren of afwijzen", StaleReviewAsync),
    ("publicatie bewaart exacte snapshot en audit in een transactie", PublishSnapshotAsync),
    ("wijziging tijdens goedkeuren geeft conflict zonder publicatie of audit", ConcurrentApprovalAsync),
    ("ongeldig proces kan niet naar review of publicatie", InvalidProcessAsync)
};
foreach (var test in tests)
{
    await test.Run();
    Console.WriteLine($"{test.Name}: OK");
}

static async Task DeactivateAsync()
{
    await using var h = await Harness.CreateAsync();
    var principal = await h.LoginAsync();
    Assert(await h.Accounts.IsSessionCurrentAsync(principal), "Nieuwe sessie is ongeldig.");
    await h.Accounts.UpdateUserAsync("user", new("Beheerder", null, RoleNames.All, false));
    Assert(!await h.Accounts.IsSessionCurrentAsync(principal), "Gedeactiveerde sessie bleef geldig.");
    await h.Accounts.UpdateUserAsync("user", new("Beheerder", null, RoleNames.All, true));
    Assert(!await h.Accounts.IsSessionCurrentAsync(principal), "Heractiveren maakte een oude sessie opnieuw geldig.");
    Assert(await h.Accounts.IsSessionCurrentAsync(await h.LoginAsync()), "Nieuwe login na heractiveren werkt niet.");
}

static async Task ChangeRolesAsync()
{
    await using var h = await Harness.CreateAsync();
    var principal = await h.LoginAsync();
    await h.Accounts.UpdateUserAsync("user", new("Lezer", null, [RoleNames.View], true));
    Assert(!await h.Accounts.IsSessionCurrentAsync(principal), "Oude beheerderssessie bleef geldig.");
    var current = await h.LoginAsync();
    Assert(current.IsInRole(RoleNames.View) && !current.IsInRole(RoleNames.Manage), "Nieuwe sessie heeft oude rechten.");
    Assert(await h.Accounts.IsSessionCurrentAsync(current), "Nieuwe lezersessie is ongeldig.");
}

static async Task ChangePasswordAsync()
{
    await using var h = await Harness.CreateAsync();
    var principal = await h.LoginAsync();
    await h.Accounts.SetPasswordAsync("user", "replacement-local-selftest");
    Assert(!await h.Accounts.IsSessionCurrentAsync(principal), "Wachtwoordreset trok sessie niet in.");
    Assert(await h.Accounts.ValidateCredentialsAsync("admin", Harness.Password) is null, "Oude login bleef mogelijk.");
    var user = await h.Accounts.ValidateCredentialsAsync("admin", "replacement-local-selftest");
    Assert(user is not null && await h.Accounts.IsSessionCurrentAsync(h.Accounts.CreatePrincipal(user)), "Nieuwe login werkt niet.");
}

static async Task InvalidSessionsAsync()
{
    await using var h = await Harness.CreateAsync();
    var principal = await h.LoginAsync();
    var legacy = new ClaimsPrincipal(new ClaimsIdentity(principal.Claims.Where(c => c.Type != LocalAccountService.SessionStampClaim), "local"));
    Assert(!await h.Accounts.IsSessionCurrentAsync(legacy), "Legacycookie zonder stempel werd vertrouwd.");
    Assert(!await h.Accounts.IsSessionCurrentAsync(new ClaimsPrincipal()), "Onbekende gebruiker werd vertrouwd.");
    h.Db.LocalUsers.Remove(await h.Db.LocalUsers.SingleAsync(user => user.Id == "user"));
    await h.Db.SaveChangesAsync();
    Assert(!await h.Accounts.IsSessionCurrentAsync(principal), "Verwijderde gebruiker bleef ingelogd.");
}

static async Task LastAdministratorAsync()
{
    await using var h = await Harness.CreateAsync();
    await h.Accounts.UpdateUserAsync("other-admin", new("Tweede beheerder", null, RoleNames.All, false));
    foreach (var update in new[] { new LocalUserUpdateRequest("Beheerder", null, RoleNames.All, false), new LocalUserUpdateRequest("Beheerder", null, [RoleNames.View], true) })
    {
        var rejected = false;
        try { await h.Accounts.UpdateUserAsync("user", update); }
        catch (LocalAccountException ex) when (ex.Code == "last-active-administrator") { rejected = true; }
        Assert(rejected, "Laatste beheerder kon worden verwijderd.");
    }
    var user = await h.Db.LocalUsers.AsNoTracking().SingleAsync(user => user.Id == "user");
    Assert(user.IsActive && LocalAccountService.ReadRoles(user.RolesJson).Contains(RoleNames.Manage), "Geweigerde wijziging is toch opgeslagen.");
}
static async Task RevisionAndReplayAsync()
{
    await using var h = await Harness.CreateAsync();
    foreach (var action in Enum.GetValues<ProcessWorkflowAction>())
    {
        await ExpectAsync(() => h.Workflow.TransitionAsync("process", action, null, null, h.Actor), "expected-revision-required", 400);
        await ExpectAsync(() => h.Workflow.TransitionAsync("process", action, 0, null, h.Actor), "expected-revision-required", 400);
        await ExpectAsync(() => h.Workflow.TransitionAsync("process", action, 999, null, h.Actor), "revision-conflict");
    }
    await h.TransitionAsync(ProcessWorkflowAction.Submit, 1);
    await ExpectAsync(() => h.TransitionAsync(ProcessWorkflowAction.Submit, 1), "revision-conflict");
    await ExpectAsync(() => h.TransitionAsync(ProcessWorkflowAction.Submit, 2), "workflow-invalid-status");
    await h.TransitionAsync(ProcessWorkflowAction.Reject, 2);
    Assert((await h.Db.Processes.SingleAsync()).Status == "concept", "Afwijzen herstelt geen concept.");
    Assert(await h.Db.AuditLogs.CountAsync() == 2 && await h.Db.ProcessVersions.CountAsync() == 2, "Geweigerde acties lieten audit/versies achter.");
}

static async Task StaleReviewAsync()
{
    await using var h = await Harness.CreateAsync();
    await h.TransitionAsync(ProcessWorkflowAction.Submit, 1);
    var entity = await h.Db.Processes.SingleAsync();
    ProcessMapper.UpdateEntity(entity, ProcessMapper.ToDocument(entity) with
    {
        Detailproces = "Gewijzigde inhoud", Status = "concept", Revision = 3
    }, 3);
    await h.Db.SaveChangesAsync();
    await h.TransitionAsync(ProcessWorkflowAction.Submit, 3);
    await ExpectAsync(() => h.TransitionAsync(ProcessWorkflowAction.Approve, 2), "revision-conflict");
    await ExpectAsync(() => h.TransitionAsync(ProcessWorkflowAction.Reject, 2), "revision-conflict");
    Assert(!await h.Db.ProcessVersions.AnyAsync(v => v.Status == "live"), "Ongeziene inhoud is gepubliceerd.");
    await h.TransitionAsync(ProcessWorkflowAction.Approve, 4);
    var live = await h.Db.ProcessVersions.SingleAsync(v => v.Status == "live");
    Assert(live.ProcessJson.Contains("Gewijzigde inhoud"), "Actuele review werd niet gepubliceerd.");
}

static async Task PublishSnapshotAsync()
{
    await using var h = await Harness.CreateAsync();
    await h.TransitionAsync(ProcessWorkflowAction.Submit, 1);
    await h.TransitionAsync(ProcessWorkflowAction.Approve, 2);
    var entity = await h.Db.Processes.SingleAsync();
    var live = await h.Db.ProcessVersions.SingleAsync(v => v.Status == "live");
    Assert(entity.Revision == 3 && live.ProcessRevision == 3 && live.ProcessJson == entity.DocumentJson, "Publicatie wijkt af van opgeslagen versie.");
    var audit = await h.Db.AuditLogs.SingleAsync(a => a.Action == "process.approve");
    using var details = JsonDocument.Parse(audit.DetailsJson!);
    Assert(details.RootElement.GetProperty("expectedRevision").GetInt32() == 2, "Audit mist bekeken revisie.");
    ProcessMapper.UpdateEntity(entity, ProcessMapper.ToDocument(entity) with { Detailproces = "Nieuw concept", Status = "concept", Revision = 4 }, 4);
    await h.Db.SaveChangesAsync();
    Assert(!live.ProcessJson.Contains("Nieuw concept"), "Conceptedit heeft publicatie veranderd.");
}

static async Task ConcurrentApprovalAsync()
{
    await using var h = await Harness.CreateAsync();
    await h.TransitionAsync(ProcessWorkflowAction.Submit, 1);
    h.Interceptor.BeforeTransaction = async () =>
    {
        await using var competing = h.CreateContext();
        var entity = await competing.Processes.SingleAsync();
        ProcessMapper.UpdateEntity(entity, ProcessMapper.ToDocument(entity) with { Revision = 3, Status = "concept" }, 3);
        await competing.SaveChangesAsync();
    };
    await ExpectAsync(() => h.TransitionAsync(ProcessWorkflowAction.Approve, 2), "revision-conflict");
    Assert(!await h.Db.ProcessVersions.AnyAsync(v => v.Status == "live"), "Race liet publicatie achter.");
    Assert(!await h.Db.AuditLogs.AnyAsync(a => a.Action == "process.approve"), "Race liet goedkeuring in audit achter.");
    Assert((await h.Db.Processes.SingleAsync()).Revision == 3, "Concurrerende wijziging is overschreven.");
}

static async Task InvalidProcessAsync()
{
    await using var h = await Harness.CreateAsync();
    var entity = await h.Db.Processes.SingleAsync();
    var document = ProcessMapper.ToDocument(entity);
    ProcessMapper.UpdateEntity(entity, document with { Stappen = [document.Stappen[0] with { LaneId = "missing" }] }, 1);
    await h.Db.SaveChangesAsync();
    await ExpectAsync(() => h.TransitionAsync(ProcessWorkflowAction.Submit, 1), "process-health-blocking");
    Assert(!await h.Db.ProcessVersions.AnyAsync(), "Ongeldig proces is in review gekomen.");
}

static async Task ExpectAsync(Func<Task> action, string code, int status = 409)
{
    try { await action(); }
    catch (ProcessWorkflowException ex) when (ex.Code == code && ex.StatusCode == status) { return; }
    throw new InvalidOperationException($"Verwacht {status}/{code}.");
}

static void Assert(bool condition, string message)
{
    if (!condition) throw new InvalidOperationException(message);
}

sealed class RaceInterceptor : DbTransactionInterceptor
{
    public Func<Task>? BeforeTransaction { get; set; }
    public override async ValueTask<InterceptionResult<DbTransaction>> TransactionStartingAsync(
        DbConnection connection, TransactionStartingEventData eventData, InterceptionResult<DbTransaction> result, CancellationToken cancellationToken = default)
    {
        var callback = BeforeTransaction;
        BeforeTransaction = null;
        if (callback is not null) await callback();
        return result;
    }
}

sealed class Harness : IAsyncDisposable
{
    public const string Password = "local-selftest-explicit-secret";
    private readonly string _directory;
    private readonly string _connection;
    public RaceInterceptor Interceptor { get; } = new();
    public AppDbContext Db { get; }
    public LocalAccountService Accounts { get; }
    public ProcessWorkflowService Workflow { get; }
    public User Actor { get; } = new("user", "Beheerder", null, "local", RoleNames.All, []);

    private Harness(string directory)
    {
        _directory = directory;
        _connection = $"Data Source={Path.Combine(directory, "test.db")};Pooling=False";
        Db = new(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(_connection).AddInterceptors(Interceptor).Options);
        Accounts = new(Db, new PasswordHashService());
        Workflow = new(Db, new ProcessVersionService(Db), new ProcessHealthService(), new AuditLogService(Db));
    }
    public static async Task<Harness> CreateAsync()
    {
        var directory = Path.Combine(Path.GetTempPath(), $"spg-auth-workflow-{Guid.NewGuid():N}");
        Directory.CreateDirectory(directory);
        var h = new Harness(directory);
        await h.Db.Database.EnsureCreatedAsync();
        h.Db.LocalUsers.Add(new()
        {
            Id = "user", UserName = "admin", NormalizedUserName = "ADMIN", DisplayName = "Beheerder",
            PasswordHash = new PasswordHashService().HashPassword(Password), RolesJson = JsonSerializer.Serialize(RoleNames.All)
        });
        h.Db.LocalUsers.Add(new()
        {
            Id = "other-admin", UserName = "other", NormalizedUserName = "OTHER", DisplayName = "Tweede beheerder",
            PasswordHash = new PasswordHashService().HashPassword(Password), RolesJson = JsonSerializer.Serialize(RoleNames.All)
        });
        var document = JsonSerializer.Deserialize<ProcessDocument>("""
            {"id":"process","hoofdproces":"Procesbeheer","detailproces":"Oorspronkelijke inhoud",
             "versie":"V1","status":"concept","laatsteWijziging":"2026-09-08","revision":1,
             "lanes":[{"id":"owner","naam":"Proceseigenaar","kleur":"#333333"}],"secties":[],
             "stappen":[{"id":"end","nummer":"1","laneId":"owner","type":"eind","activiteit":"Afgerond"}]}
            """, ProcessJson.Options)!;
        h.Db.Processes.Add(ProcessMapper.ToEntity(document, 1));
        await h.Db.SaveChangesAsync();
        return h;
    }
    public AppDbContext CreateContext() => new(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(_connection).Options);
    public async Task<ClaimsPrincipal> LoginAsync() => Accounts.CreatePrincipal(
        await Accounts.ValidateCredentialsAsync("admin", Password) ?? throw new InvalidOperationException("Testlogin mislukt."));
    public Task<VersionDocument> TransitionAsync(ProcessWorkflowAction action, int revision) =>
        Workflow.TransitionAsync("process", action, revision, null, Actor);
    public async ValueTask DisposeAsync()
    {
        await Db.DisposeAsync();
        Directory.Delete(_directory, recursive: true);
    }
}