using System.Data;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ServiceProcesgids.Api.Contract;
using ServiceProcesgids.Api.Data;
using ServiceProcesgids.Api.Data.Entities;
using ServiceProcesgids.Api.Models;

namespace ServiceProcesgids.Api.Services;

public sealed class AssuranceRunService(
    AppDbContext db,
    AssuranceFrameworkCatalogService catalog,
    AssuranceSettingsService settings,
    IsoService iso,
    AuditLogService audit,
    TimeProvider timeProvider)
{
    private static readonly TimeSpan RunningLease = TimeSpan.FromMinutes(30);

    public async Task<AssuranceRun> RunManualAsync(
        User actor,
        CancellationToken cancellationToken = default) =>
        await RunAsync("handmatig", null, actor, cancellationToken);

    public async Task<AssuranceRun?> RunDueAsync(
        CancellationToken cancellationToken = default)
    {
        var settingsEntity = await settings.GetEntityAsync(cancellationToken);
        var now = timeProvider.GetUtcNow();
        if (settingsEntity.NextRunAtUtc > now)
        {
            return null;
        }

        var system = new User(
            "system:continuous-assurance",
            "Continue assurancecontrole",
            null,
            "system",
            [],
            []);
        return await RunAsync(
            "gepland",
            settingsEntity.NextRunAtUtc,
            system,
            cancellationToken);
    }

    public async Task<IReadOnlyList<AssuranceRun>> ListAsync(
        int? limit,
        CancellationToken cancellationToken = default)
    {
        var max = Math.Clamp(limit ?? 50, 1, 100);
        var entities = await db.AssuranceRuns
            .AsNoTracking()
            .Include(item => item.Findings)
            .Where(item => item.TenantId == AssuranceSettingsService.TenantId)
            .OrderByDescending(item => item.Id)
            .Take(max)
            .ToListAsync(cancellationToken);
        return entities.Select(ToDocument).ToArray();
    }

    public async Task<AssuranceRun> GetAsync(
        string runId,
        CancellationToken cancellationToken = default)
    {
        var normalizedRunId = NormalizeRunId(runId);
        var entity = await db.AssuranceRuns
            .AsNoTracking()
            .Include(item => item.Findings)
            .SingleOrDefaultAsync(
                item =>
                    item.RunId == normalizedRunId &&
                    item.TenantId == AssuranceSettingsService.TenantId,
                cancellationToken)
            ?? throw new AssuranceException(
                "assurance-run-not-found",
                "De assurance-run is niet gevonden.",
                StatusCodes.Status404NotFound);
        return ToDocument(entity);
    }

    public async Task<AssuranceMonitoringStatus> GetMonitoringStatusAsync(
        CancellationToken cancellationToken = default)
    {
        var currentSettings = await settings.GetAsync(cancellationToken);
        var latest = (await ListAsync(1, cancellationToken)).SingleOrDefault();
        var now = timeProvider.GetUtcNow();
        return new AssuranceMonitoringStatus(
            true,
            DateTimeOffset.Parse(currentSettings.VolgendeRunOp) <= now,
            currentSettings.VolgendeRunOp,
            currentSettings.EffectiefIntervalUren,
            currentSettings.ActieveKaderIds,
            latest,
            now.ToString("O"));
    }

    private async Task<AssuranceRun> RunAsync(
        string trigger,
        DateTimeOffset? scheduledFor,
        User actor,
        CancellationToken cancellationToken)
    {
        var now = timeProvider.GetUtcNow();
        var runId = Guid.NewGuid().ToString("N");
        var scheduleKey = trigger == "gepland"
            ? $"scheduled:{AssuranceSettingsService.TenantId}:{scheduledFor!.Value.UtcDateTime.Ticks}"
            : $"manual:{runId}";
        var activeFrameworkIds = (await settings.GetActiveFrameworkIdsAsync(
                cancellationToken))
            .OrderBy(item => item, StringComparer.Ordinal)
            .ToArray();

        await using (var startTransaction =
                     await db.Database.BeginTransactionAsync(
                         IsolationLevel.Serializable,
                         cancellationToken))
        {
            var existing = await db.AssuranceRuns
                .AsNoTracking()
                .Include(item => item.Findings)
                .SingleOrDefaultAsync(
                    item => item.ScheduleKey == scheduleKey,
                    cancellationToken);
            if (existing is not null)
            {
                await startTransaction.CommitAsync(cancellationToken);
                return ToDocument(existing);
            }

            var running = await db.AssuranceRuns
                .Where(item =>
                    item.TenantId == AssuranceSettingsService.TenantId &&
                    item.Status == "running")
                .ToListAsync(cancellationToken);
            foreach (var stale in running.Where(item =>
                         item.StartedAtUtc < now.Subtract(RunningLease)))
            {
                stale.Status = "failed";
                stale.ErrorCode = "assurance-run-lease-expired";
                stale.CompletedAtUtc = now;
                stale.Revision++;
            }

            if (running.Any(item => item.Status == "running"))
            {
                throw new AssuranceException(
                    "assurance-run-active",
                    "Er draait al een assurancecontrole. Probeer het later opnieuw.",
                    StatusCodes.Status409Conflict);
            }

            var entity = new AssuranceRunEntity
            {
                RunId = runId,
                TenantId = AssuranceSettingsService.TenantId,
                Trigger = trigger,
                ScheduleKey = scheduleKey,
                Status = "running",
                CatalogVersion = catalog.CurrentVersion,
                FrameworkIdsJson = JsonSerializer.Serialize(
                    activeFrameworkIds,
                    ProcessJson.Options),
                StartedByActorId = actor.Id,
                StartedByActorName = actor.Naam,
                StartedAtUtc = now,
                Revision = 1
            };
            db.AssuranceRuns.Add(entity);
            await db.SaveChangesAsync(cancellationToken);
            await audit.WriteAsync(
                "assurance.run.start",
                "assurance-run",
                runId,
                actor,
                new
                {
                    trigger,
                    geplandePeildatum = scheduledFor?.ToString("O"),
                    kaderIds = activeFrameworkIds,
                    catalogVersion = entity.CatalogVersion,
                    betekenis = "Deterministische readinesscontrole; geen certificerings- of auditverklaring."
                },
                cancellationToken);
            await startTransaction.CommitAsync(cancellationToken);
        }

        try
        {
            var findings = await CreateFindingsAsync(
                runId,
                activeFrameworkIds,
                cancellationToken);
            var completedAt = timeProvider.GetUtcNow();
            await using var completeTransaction =
                await db.Database.BeginTransactionAsync(
                    IsolationLevel.Serializable,
                    cancellationToken);
            var entity = await db.AssuranceRuns
                .Include(item => item.Findings)
                .SingleAsync(item => item.RunId == runId, cancellationToken);
            entity.Findings.Clear();
            foreach (var finding in findings)
            {
                entity.Findings.Add(finding);
            }

            entity.Status = "completed";
            entity.CompletedAtUtc = completedAt;
            entity.FindingCount = findings.Count;
            entity.Revision++;
            await db.SaveChangesAsync(cancellationToken);
            await settings.MarkRunCompletedAsync(completedAt, cancellationToken);
            await audit.WriteAsync(
                "assurance.run.complete",
                "assurance-run",
                runId,
                actor,
                new
                {
                    trigger,
                    findingCount = findings.Count,
                    kaderIds = activeFrameworkIds,
                    catalogVersion = entity.CatalogVersion,
                    betekenis = "Readinessbevindingen; geen certificerings- of auditverklaring."
                },
                cancellationToken);
            await completeTransaction.CommitAsync(cancellationToken);
            return ToDocument(entity);
        }
        catch (Exception exception) when (
            exception is not OperationCanceledException)
        {
            await PersistFailureAsync(runId, actor, exception, cancellationToken);
            throw;
        }
    }

    private async Task<IReadOnlyList<AssuranceFindingEntity>> CreateFindingsAsync(
        string runId,
        IReadOnlyList<string> activeFrameworkIds,
        CancellationToken cancellationToken)
    {
        var findings = new List<AssuranceFindingEntity>();
        var sessions = await db.AssuranceQuestionnaireSessions
            .AsNoTracking()
            .Include(item => item.Answers)
            .Where(item =>
                item.TenantId == AssuranceSettingsService.TenantId &&
                activeFrameworkIds.Contains(item.FrameworkId))
            .ToListAsync(cancellationToken);
        foreach (var frameworkId in activeFrameworkIds)
        {
            var framework = catalog.Get(frameworkId);
            var latest = sessions
                .Where(item => item.FrameworkId == frameworkId)
                .OrderByDescending(item => item.StartedAtUtc)
                .ThenByDescending(item => item.SessionId, StringComparer.Ordinal)
                .FirstOrDefault();
            if (latest is null)
            {
                findings.Add(Finding(
                    runId,
                    frameworkId,
                    null,
                    null,
                    "assessment-ontbreekt",
                    "fout",
                    $"{framework.Naam}: readinessbeoordeling ontbreekt",
                    "Start de normcoach en beantwoord alle evidencevragen voor dit actieve kader."));
                continue;
            }

            if (latest.Status != "gereed" ||
                latest.Answers.Count < framework.Vragen.Count)
            {
                findings.Add(Finding(
                    runId,
                    frameworkId,
                    null,
                    null,
                    "assessment-onvolledig",
                    "waarschuwing",
                    $"{framework.Naam}: readinessbeoordeling onvolledig",
                    $"{latest.Answers.Count} van {framework.Vragen.Count} evidencevragen zijn beantwoord."));
                continue;
            }

            foreach (var answer in latest.Answers.Where(item =>
                         item.Outcome is "deels" or "nee" or "onbekend"))
            {
                var question = framework.Vragen.Single(item =>
                    item.Id == answer.QuestionId);
                findings.Add(Finding(
                    runId,
                    frameworkId,
                    null,
                    answer.QuestionId,
                    "assessment-gap",
                    answer.Outcome == "nee" ? "fout" : "waarschuwing",
                    $"{framework.Naam}: {question.Titel}",
                    $"Het meest recente readinessantwoord is '{answer.Outcome}'. Beoordeel de ontbrekende beheersing of het ontbrekende bewijs."));
            }
        }

        var processes = await db.Processes
            .AsNoTracking()
            .Where(item => item.Status != "gearchiveerd")
            .OrderBy(item => item.Id)
            .ToListAsync(cancellationToken);
        foreach (var process in processes)
        {
            var config = await iso.GetConfigAsync(
                process.Id,
                cancellationToken);
            if (string.IsNullOrWhiteSpace(config.Governance?.Eigenaar))
            {
                findings.Add(Finding(
                    runId,
                    null,
                    process.Id,
                    null,
                    "proces-eigenaar-ontbreekt",
                    "waarschuwing",
                    "Proceseigenaar ontbreekt",
                    $"Proces '{process.Detailproces}' heeft geen aantoonbaar toegewezen eigenaar."));
            }

            if (!DateOnly.TryParse(
                    config.Governance?.VolgendeReview,
                    out var nextReview))
            {
                findings.Add(Finding(
                    runId,
                    null,
                    process.Id,
                    null,
                    "proces-review-ontbreekt",
                    "waarschuwing",
                    "Procesreview ontbreekt",
                    $"Proces '{process.Detailproces}' heeft geen geldige volgende reviewdatum."));
            }
            else if (nextReview < DateOnly.FromDateTime(
                         timeProvider.GetUtcNow().UtcDateTime))
            {
                findings.Add(Finding(
                    runId,
                    null,
                    process.Id,
                    null,
                    "proces-review-verlopen",
                    "fout",
                    "Procesreview verlopen",
                    $"De reviewdatum {nextReview:yyyy-MM-dd} van proces '{process.Detailproces}' is verstreken."));
            }
        }

        return findings;
    }

    private static AssuranceFindingEntity Finding(
        string runId,
        string? frameworkId,
        string? processId,
        string? questionId,
        string type,
        string severity,
        string title,
        string message) =>
        new()
        {
            FindingId = Guid.NewGuid().ToString("N"),
            RunId = runId,
            FrameworkId = frameworkId,
            ProcessId = processId,
            QuestionId = questionId,
            Type = type,
            Severity = severity,
            Title = title,
            Message = message,
            CreatedAtUtc = DateTimeOffset.UtcNow
        };

    private async Task PersistFailureAsync(
        string runId,
        User actor,
        Exception exception,
        CancellationToken cancellationToken)
    {
        try
        {
            await using var transaction =
                await db.Database.BeginTransactionAsync(cancellationToken);
            var entity = await db.AssuranceRuns
                .SingleOrDefaultAsync(
                    item => item.RunId == runId,
                    cancellationToken);
            if (entity is null || entity.Status != "running")
            {
                return;
            }

            entity.Status = "failed";
            entity.ErrorCode = exception is AssuranceException assurance
                ? assurance.Code
                : "assurance-run-failed";
            entity.CompletedAtUtc = timeProvider.GetUtcNow();
            entity.Revision++;
            await db.SaveChangesAsync(cancellationToken);
            await audit.WriteAsync(
                "assurance.run.fail",
                "assurance-run",
                runId,
                actor,
                new
                {
                    errorCode = entity.ErrorCode,
                    errorType = exception.GetType().Name
                },
                cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (Exception failure) when (
            failure is not OperationCanceledException)
        {
            // De oorspronkelijke fout blijft leidend. Een volgende due-run
            // markeert een achtergebleven running-record na de lease als failed.
        }
    }

    private static AssuranceRun ToDocument(AssuranceRunEntity entity)
    {
        IReadOnlyList<string> frameworkIds;
        try
        {
            frameworkIds = JsonSerializer.Deserialize<string[]>(
                               entity.FrameworkIdsJson,
                               ProcessJson.Options) ?? [];
        }
        catch (JsonException)
        {
            frameworkIds = [];
        }

        return new AssuranceRun(
            entity.RunId,
            entity.Trigger,
            entity.Status,
            entity.CatalogVersion,
            frameworkIds,
            entity.StartedByActorName,
            entity.StartedAtUtc.ToString("O"),
            entity.CompletedAtUtc?.ToString("O"),
            entity.FindingCount,
            entity.ErrorCode,
            entity.Findings
                .OrderBy(item => item.Id)
                .Select(item => new AssuranceFinding(
                    item.FindingId,
                    item.FrameworkId,
                    item.ProcessId,
                    item.QuestionId,
                    item.Type,
                    item.Severity,
                    item.Title,
                    item.Message))
                .ToArray());
    }

    private static string NormalizeRunId(string? runId)
    {
        var normalized = runId?.Trim().ToLowerInvariant() ?? "";
        if (!Guid.TryParseExact(normalized, "N", out _))
        {
            throw new AssuranceException(
                "assurance-run-id-invalid",
                "De assurance-run heeft geen geldig id.");
        }

        return normalized;
    }
}
