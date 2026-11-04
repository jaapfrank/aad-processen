using System.Data;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using ServiceProcesgids.Api.Contract;
using ServiceProcesgids.Api.Data;
using ServiceProcesgids.Api.Data.Entities;
using ServiceProcesgids.Api.Models;

namespace ServiceProcesgids.Api.Services;

public sealed class AiRunLedgerException(
    string code,
    string message,
    int statusCode) : Exception(message)
{
    public string Code { get; } = code;
    public int StatusCode { get; } = statusCode;
}

public sealed record AiRunFeedbackWriteResult(
    AiRunDocument Run,
    bool Created);

public sealed record AiRunRequestAuditMetadata(
    string SchemaVersion,
    int ExpectedRevision,
    int StepCount,
    bool HasGoal,
    int AnswerCount,
    string? Trigger);

public sealed partial class AiRunLedgerService(
    AppDbContext db,
    ILogger<AiRunLedgerService> logger)
{
    public const string TenantId = "single-tenant";
    private const int MaxFeedbackReasonLength = 160;
    private const string ArchivedStatus = "gearchiveerd";
    private const string TimeoutErrorCode = "ai-run-timeout";
    private static readonly TimeSpan RunningTimeout = TimeSpan.FromMinutes(15);
    private static readonly HashSet<string> FeedbackDecisions =
        new(["accepted", "rejected"], StringComparer.Ordinal);
    private static readonly HashSet<string> ResultStatuses =
        new(["vragen", "voorstel", "geen-wijziging"], StringComparer.Ordinal);
    private static readonly HashSet<string> TriggerKinds =
        new(["handmatig", "health", "kader", "suggestie"], StringComparer.Ordinal);

    public async Task StartAsync(
        string runId,
        string capability,
        string processId,
        int processRevision,
        User actor,
        string inputHash,
        DateTimeOffset startedAtUtc,
        AiRunRequestAuditMetadata auditMetadata,
        CancellationToken cancellationToken = default)
    {
        ValidateRunId(runId);
        if (!capability.Equals(ProcessMaintenanceService.Capability, StringComparison.Ordinal))
        {
            throw Invalid(
                "ai-run-capability-invalid",
                "De AI-capability van de run is ongeldig.");
        }

        if (processRevision <= 0 ||
            string.IsNullOrWhiteSpace(processId) ||
            processId.Length > 160 ||
            !IsSha256(inputHash))
        {
            throw Invalid(
                "ai-run-metadata-invalid",
                "De AI-run bevat ongeldige of onvolledige metadata.");
        }
        ValidateActor(actor);
        ValidateRequestAuditMetadata(auditMetadata, processRevision);

        var processMatches = await db.Processes
            .AsNoTracking()
            .AnyAsync(
                process =>
                    process.Id == processId &&
                    process.Revision == processRevision &&
                    process.Status != ArchivedStatus,
                cancellationToken);
        if (!processMatches)
        {
            throw new AiRunLedgerException(
                "process-revision-changed",
                "Het proces bestaat niet meer of de revisie is gewijzigd.",
                StatusCodes.Status409Conflict);
        }

        var run = new AiRunEntity
        {
            RunId = runId,
            TenantId = TenantId,
            Capability = capability,
            ProcessId = processId,
            ProcessRevision = processRevision,
            ActorId = actor.Id,
            ActorName = actor.Naam,
            Status = "running",
            InputHash = inputHash,
            StartedAtUtc = startedAtUtc,
            ProposedChangeIdsJson = "[]",
            AcceptedChangeIdsJson = "[]",
            Revision = 1
        };
        db.AiRuns.Add(run);
        AddLifecycleAudit(
            "ai.process-maintenance.requested",
            run,
            startedAtUtc,
            new
            {
                runId,
                capability,
                schemaVersion = auditMetadata.SchemaVersion,
                auditMetadata.ExpectedRevision,
                auditMetadata.StepCount,
                auditMetadata.HasGoal,
                auditMetadata.AnswerCount,
                trigger = auditMetadata.Trigger
            });

        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException ex)
        {
            logger.LogWarning(
                "AI-run kon niet worden gestart. RunId={RunId}, ErrorType={ErrorType}",
                runId,
                ex.GetType().Name);
            throw new AiRunLedgerException(
                "ai-run-persist-failed",
                "De AI-run kon niet veilig worden geregistreerd.",
                StatusCodes.Status503ServiceUnavailable);
        }
    }

    public async Task CompleteAsync(
        string runId,
        string provider,
        string model,
        string resultStatus,
        string outputHash,
        int questionCount,
        int issueCount,
        int changeCount,
        IReadOnlyList<string> proposedChangeIds,
        DateTimeOffset completedAtUtc,
        long durationMs,
        CancellationToken cancellationToken = default)
    {
        ValidateProviderResult(
            provider,
            model,
            resultStatus,
            outputHash,
            questionCount,
            issueCount,
            changeCount,
            proposedChangeIds,
            durationMs);
        var opaqueChangeIds = proposedChangeIds
            .Select(HashModelChangeId)
            .ToArray();
        if (opaqueChangeIds.Distinct(StringComparer.Ordinal).Count() !=
            opaqueChangeIds.Length)
        {
            throw Invalid(
                "ai-run-result-change-ids-ambiguous",
                "De wijziging-id's van de AI-run zijn niet eenduidig.");
        }

        var stale = false;
        await using (var transaction = await db.Database.BeginTransactionAsync(
                         IsolationLevel.Serializable,
                         cancellationToken))
        {
            var run = await GetRunningAsync(runId, cancellationToken);
            var processMatches = await db.Processes
                .AsNoTracking()
                .AnyAsync(
                    process =>
                        process.Id == run.ProcessId &&
                        process.Revision == run.ProcessRevision &&
                        process.Status != ArchivedStatus,
                    cancellationToken);
            if (!processMatches)
            {
                run.Provider = provider.Trim();
                run.Model = model.Trim();
                run.Status = "stale";
                run.CompletedAtUtc = completedAtUtc;
                run.DurationMs = durationMs;
                run.ErrorCode = "process-revision-changed";
                run.Revision += 1;
                AddLifecycleAudit(
                    "ai.process-maintenance.failed",
                    run,
                    completedAtUtc,
                    new { runId, errorCode = run.ErrorCode });
                await SaveUpdateAsync(runId, cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                stale = true;
            }
            else
            {
                run.Provider = provider.Trim();
                run.Model = model.Trim();
                run.Status = "completed";
                run.ResultStatus = resultStatus;
                run.OutputHash = outputHash;
                run.CompletedAtUtc = completedAtUtc;
                run.DurationMs = durationMs;
                run.QuestionCount = questionCount;
                run.IssueCount = issueCount;
                run.ChangeCount = changeCount;
                run.ProposedChangeIdsJson = JsonSerializer.Serialize(
                    opaqueChangeIds,
                    ProcessJson.Options);
                run.ErrorCode = null;
                run.Revision += 1;
                AddLifecycleAudit(
                    "ai.process-maintenance.completed",
                    run,
                    completedAtUtc,
                    new
                    {
                        runId,
                        run.ProcessRevision,
                        status = resultStatus,
                        issueCount,
                        questionCount,
                        changeCount,
                        provider = run.Provider,
                        model = run.Model,
                        run.InputHash,
                        outputHash
                    });
                await SaveUpdateAsync(runId, cancellationToken);
                await transaction.CommitAsync(cancellationToken);
            }
        }

        if (stale)
        {
            throw new AiRunLedgerException(
                "process-revision-changed",
                "Het proces is tijdens de AI-analyse gewijzigd of gearchiveerd.",
                StatusCodes.Status409Conflict);
        }
    }

    public async Task FailAsync(
        string runId,
        string status,
        string errorCode,
        string? provider,
        string? model,
        DateTimeOffset completedAtUtc,
        long durationMs,
        CancellationToken cancellationToken = default)
    {
        if (status is not ("failed" or "stale" or "cancelled") ||
            string.IsNullOrWhiteSpace(errorCode) ||
            errorCode.Length > 120 ||
            durationMs < 0)
        {
            throw Invalid(
                "ai-run-failure-invalid",
                "De foutstatus van de AI-run is ongeldig.");
        }

        var run = await db.AiRuns.SingleOrDefaultAsync(
            item =>
                item.TenantId == TenantId &&
                item.RunId == runId,
            cancellationToken);
        if (run is null)
        {
            // Een fout vóór StartAsync (bijvoorbeeld ongeldige context) heeft
            // bewust geen persistente run en hoeft hier niet te worden gemaakt.
            return;
        }

        if (!run.Status.Equals("running", StringComparison.Ordinal))
        {
            return;
        }

        run.Provider = NormalizeProviderValue(provider, 80);
        run.Model = NormalizeProviderValue(model, 180);
        run.Status = status;
        run.CompletedAtUtc = completedAtUtc;
        run.DurationMs = durationMs;
        run.ErrorCode = errorCode.Trim();
        run.Revision += 1;
        AddLifecycleAudit(
            "ai.process-maintenance.failed",
            run,
            completedAtUtc,
            new { runId, errorCode = run.ErrorCode });
        await SaveUpdateAsync(runId, cancellationToken);
    }

    public async Task<IReadOnlyList<AiRunDocument>> ListAsync(
        string processId,
        int? limit,
        CancellationToken cancellationToken = default)
    {
        await EnsureProcessExistsAsync(
            processId,
            includeArchived: true,
            cancellationToken);
        await NormalizeTimedOutRunsAsync(processId, cancellationToken);
        var max = Math.Clamp(limit ?? 50, 1, 100);
        var runs = await db.AiRuns
            .AsNoTracking()
            .Where(run =>
                run.TenantId == TenantId &&
                run.ProcessId == processId)
            .OrderByDescending(run => run.Id)
            .Take(max)
            .ToListAsync(cancellationToken);
        return runs.Select(ToDocument).ToList();
    }

    public async Task<AiRunFeedbackWriteResult> RecordFeedbackAsync(
        string processId,
        string runId,
        AiRunFeedbackRequest request,
        User actor,
        CancellationToken cancellationToken = default)
    {
        ValidateRunId(runId);
        ValidateActor(actor);
        var normalized = NormalizeFeedback(request);
        var run = await db.AiRuns
            .AsNoTracking()
            .SingleOrDefaultAsync(
            item =>
                item.TenantId == TenantId &&
                item.ProcessId == processId &&
                item.RunId == runId,
            cancellationToken);
        if (run is null)
        {
            await EnsureProcessExistsAsync(
                processId,
                includeArchived: true,
                cancellationToken);
            throw new AiRunLedgerException(
                "ai-run-not-found",
                "De AI-run is niet gevonden voor dit proces.",
                StatusCodes.Status404NotFound);
        }

        if (!run.Status.Equals("completed", StringComparison.Ordinal) ||
            !string.Equals(run.ResultStatus, "voorstel", StringComparison.Ordinal) ||
            run.ChangeCount <= 0)
        {
            throw new AiRunLedgerException(
                "ai-run-feedback-not-allowed",
                "Alleen een afgerond wijzigingsvoorstel met concrete wijzigingen kan worden beoordeeld.",
                StatusCodes.Status409Conflict);
        }

        var proposedIds = DeserializeChangeIds(run.ProposedChangeIdsJson);
        if (normalized.Decision == "accepted" &&
            normalized.AcceptedChangeIds.Any(id =>
                !proposedIds.Contains(id, StringComparer.Ordinal)))
        {
            throw Invalid(
                "ai-run-feedback-change-ids-not-proposed",
                "Feedback verwijst naar een wijziging die niet door deze run is voorgesteld.");
        }

        var feedbackAtUtc = DateTimeOffset.UtcNow;
        var acceptedIdsJson = JsonSerializer.Serialize(
            normalized.AcceptedChangeIds,
            ProcessJson.Options);
        var normalizedProposedIdsJson = JsonSerializer.Serialize(
            proposedIds,
            ProcessJson.Options);

        int updated;
        try
        {
            updated = await db.AiRuns
                .Where(item =>
                    item.TenantId == TenantId &&
                    item.ProcessId == processId &&
                    item.RunId == runId &&
                    item.Revision == run.Revision &&
                    item.Status == "completed" &&
                    item.ResultStatus == "voorstel" &&
                    item.FeedbackDecision == null &&
                    db.Processes.Any(process =>
                        process.Id == item.ProcessId &&
                        process.Revision == item.ProcessRevision &&
                        process.Status != ArchivedStatus))
                .ExecuteUpdateAsync(
                    setters => setters
                        .SetProperty(
                            item => item.FeedbackDecision,
                            normalized.Decision)
                        .SetProperty(
                            item => item.FeedbackReason,
                            normalized.Reason)
                        .SetProperty(
                            item => item.AcceptedChangeIdsJson,
                            acceptedIdsJson)
                        .SetProperty(
                            item => item.ProposedChangeIdsJson,
                            normalizedProposedIdsJson)
                        .SetProperty(
                            item => item.FeedbackByActorId,
                            actor.Id)
                        .SetProperty(
                            item => item.FeedbackByActorName,
                            actor.Naam)
                        .SetProperty(
                            item => item.FeedbackAtUtc,
                            feedbackAtUtc)
                        .SetProperty(
                            item => item.Revision,
                            item => item.Revision + 1),
                    cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(
                "AI-runfeedback kon niet atomair worden bijgewerkt. RunId={RunId}, ErrorType={ErrorType}",
                runId,
                ex.GetType().Name);
            throw new AiRunLedgerException(
                "ai-run-persist-failed",
                "De AI-runfeedback kon niet veilig worden bijgewerkt.",
                StatusCodes.Status503ServiceUnavailable);
        }

        var current = await db.AiRuns
            .AsNoTracking()
            .SingleOrDefaultAsync(
                item =>
                    item.TenantId == TenantId &&
                    item.ProcessId == processId &&
                    item.RunId == runId,
                cancellationToken)
            ?? throw new AiRunLedgerException(
                "ai-run-not-found",
                "De AI-run is niet gevonden voor dit proces.",
                StatusCodes.Status404NotFound);
        if (updated == 1)
        {
            return new AiRunFeedbackWriteResult(ToDocument(current), true);
        }

        await EnsureRunProcessIsCurrentAsync(current, cancellationToken);
        if (current.FeedbackDecision is not null &&
            FeedbackEquals(current, normalized, actor))
        {
            return new AiRunFeedbackWriteResult(ToDocument(current), false);
        }

        if (current.FeedbackDecision is not null)
        {
            throw new AiRunLedgerException(
                "ai-run-feedback-already-recorded",
                "Deze AI-run heeft al een beoordeling van een andere actor of met andere inhoud.",
                StatusCodes.Status409Conflict);
        }

        throw new AiRunLedgerException(
            "ai-run-concurrency-conflict",
            $"AI-run '{runId}' is ondertussen gewijzigd.",
            StatusCodes.Status409Conflict);
    }

    public static AiRunDocument ToDocument(AiRunEntity run)
    {
        var acceptedIds = DeserializeChangeIds(run.AcceptedChangeIdsJson);
        var feedback = run.FeedbackDecision is null ||
                       run.FeedbackByActorName is null ||
                       run.FeedbackAtUtc is null
            ? null
            : new AiRunFeedbackDocument(
                run.FeedbackDecision,
                run.FeedbackReason,
                acceptedIds,
                run.FeedbackByActorName,
                run.FeedbackAtUtc.Value.ToString("O"));

        return new AiRunDocument(
            run.RunId,
            run.Capability,
            run.ProcessId,
            run.ProcessRevision,
            run.Status,
            run.ResultStatus,
            run.Provider,
            run.Model,
            run.ActorName,
            run.StartedAtUtc.ToString("O"),
            run.CompletedAtUtc?.ToString("O"),
            run.DurationMs,
            run.InputHash,
            run.OutputHash,
            run.QuestionCount,
            run.IssueCount,
            run.ChangeCount,
            run.ErrorCode,
            feedback);
    }

    private async Task<AiRunEntity> GetRunningAsync(
        string runId,
        CancellationToken cancellationToken)
    {
        ValidateRunId(runId);
        var run = await db.AiRuns.SingleOrDefaultAsync(
            item =>
                item.TenantId == TenantId &&
                item.RunId == runId,
            cancellationToken);
        if (run is null || !run.Status.Equals("running", StringComparison.Ordinal))
        {
            throw new AiRunLedgerException(
                "ai-run-state-invalid",
                "De AI-run bestaat niet of is niet meer actief.",
                StatusCodes.Status409Conflict);
        }

        return run;
    }

    private async Task EnsureProcessExistsAsync(
        string processId,
        bool includeArchived,
        CancellationToken cancellationToken)
    {
        var exists = await db.Processes
            .AsNoTracking()
            .AnyAsync(
                process =>
                    process.Id == processId &&
                    (includeArchived || process.Status != ArchivedStatus),
                cancellationToken);
        if (!exists)
        {
            throw new AiRunLedgerException(
                "process-not-found",
                $"Proces '{processId}' is niet gevonden.",
                StatusCodes.Status404NotFound);
        }
    }

    private async Task EnsureRunProcessIsCurrentAsync(
        AiRunEntity run,
        CancellationToken cancellationToken)
    {
        var current = await db.Processes
            .AsNoTracking()
            .AnyAsync(
                process =>
                    process.Id == run.ProcessId &&
                    process.Revision == run.ProcessRevision &&
                    process.Status != ArchivedStatus,
                cancellationToken);
        if (!current)
        {
            throw new AiRunLedgerException(
                "process-revision-changed",
                "Het proces is gewijzigd of gearchiveerd; deze AI-run kan niet meer worden beoordeeld.",
                StatusCodes.Status409Conflict);
        }
    }

    private async Task NormalizeTimedOutRunsAsync(
        string processId,
        CancellationToken cancellationToken)
    {
        var now = DateTimeOffset.UtcNow;
        var cutoff = now - RunningTimeout;
        await using var transaction = await db.Database.BeginTransactionAsync(
            IsolationLevel.Serializable,
            cancellationToken);
        var running = await db.AiRuns
            .Where(run =>
                run.TenantId == TenantId &&
                run.ProcessId == processId &&
                run.Status == "running")
            .OrderBy(run => run.Id)
            .Take(100)
            .ToListAsync(cancellationToken);
        var timedOut = running
            .Where(run => run.StartedAtUtc <= cutoff)
            .ToArray();
        if (timedOut.Length == 0)
        {
            await transaction.CommitAsync(cancellationToken);
            return;
        }

        foreach (var run in timedOut)
        {
            run.Status = "stale";
            run.ErrorCode = TimeoutErrorCode;
            run.CompletedAtUtc = now;
            run.DurationMs = Math.Max(
                0,
                (long)(now - run.StartedAtUtc).TotalMilliseconds);
            run.Revision += 1;
            AddLifecycleAudit(
                "ai.process-maintenance.failed",
                run,
                now,
                new { runId = run.RunId, errorCode = TimeoutErrorCode },
                actorId: "system",
                actorName: "Systeem");
        }

        try
        {
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            db.ChangeTracker.Clear();
            logger.LogInformation(
                "Een AI-run werd tijdens timeoutnormalisatie al door een andere worker afgerond. ProcessId={ProcessId}",
                processId);
        }
        catch (DbUpdateException ex)
        {
            logger.LogWarning(
                "Timeoutnormalisatie van AI-runs is mislukt. ProcessId={ProcessId}, ErrorType={ErrorType}",
                processId,
                ex.GetType().Name);
            throw new AiRunLedgerException(
                "ai-run-persist-failed",
                "Verlopen AI-runs konden niet veilig worden genormaliseerd.",
                StatusCodes.Status503ServiceUnavailable);
        }
    }

    private async Task SaveUpdateAsync(
        string runId,
        CancellationToken cancellationToken)
    {
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            throw new AiRunLedgerException(
                "ai-run-concurrency-conflict",
                $"AI-run '{runId}' is ondertussen gewijzigd.",
                StatusCodes.Status409Conflict);
        }
        catch (DbUpdateException ex)
        {
            logger.LogWarning(
                "AI-run kon niet worden bijgewerkt. RunId={RunId}, ErrorType={ErrorType}",
                runId,
                ex.GetType().Name);
            throw new AiRunLedgerException(
                "ai-run-persist-failed",
                "De AI-run kon niet veilig worden bijgewerkt.",
                StatusCodes.Status503ServiceUnavailable);
        }
    }

    private static FeedbackInput NormalizeFeedback(AiRunFeedbackRequest request)
    {
        var decision = request.Beslissing?.Trim().ToLowerInvariant() ?? "";
        if (!FeedbackDecisions.Contains(decision))
        {
            throw Invalid(
                "ai-run-feedback-decision-invalid",
                "Kies accepted of rejected.");
        }

        var reason = NormalizeFeedbackReason(request.Reden);
        if (reason is not null &&
            (reason.Length > MaxFeedbackReasonLength ||
             UnsafeFeedbackReasonPattern().IsMatch(reason) ||
             reason.Any(character =>
                 !char.IsLetterOrDigit(character) &&
                 character != ' ' &&
                 !".,;:!?()'’-".Contains(character, StringComparison.Ordinal))))
        {
            throw Invalid(
                "ai-run-feedback-reason-unsafe",
                "Gebruik maximaal 160 tekens zonder contactgegevens, lange nummers, links of regeleinden.");
        }

        var acceptedIds = (request.GeaccepteerdeWijzigingIds ?? [])
            .Select(id => id?.Trim() ?? "")
            .Where(id => id.Length > 0)
            .ToArray();
        if (acceptedIds.Length > 20 ||
            acceptedIds.Distinct(StringComparer.Ordinal).Count() != acceptedIds.Length ||
            acceptedIds.Any(id =>
                id.Length > 160 ||
                !ResultIdentifierPattern().IsMatch(id)))
        {
            throw Invalid(
                "ai-run-feedback-change-ids-invalid",
                "Geaccepteerde wijziging-id's zijn ongeldig of te talrijk.");
        }

        if (decision == "rejected" && acceptedIds.Length > 0)
        {
            throw Invalid(
                "ai-run-feedback-rejected-changes-invalid",
                "Een afgewezen run kan geen geaccepteerde wijzigingen bevatten.");
        }

        if (decision == "accepted" && acceptedIds.Length == 0)
        {
            throw Invalid(
                "ai-run-feedback-accepted-changes-required",
                "Een geaccepteerd voorstel vereist minimaal één geaccepteerde wijziging-id.");
        }

        var opaqueAcceptedIds = acceptedIds
            .Select(NormalizeAcceptedChangeId)
            .ToArray();
        if (opaqueAcceptedIds.Distinct(StringComparer.Ordinal).Count() !=
            opaqueAcceptedIds.Length)
        {
            throw Invalid(
                "ai-run-feedback-change-ids-ambiguous",
                "Geaccepteerde wijziging-id's zijn niet eenduidig.");
        }

        return new FeedbackInput(
            decision,
            reason,
            opaqueAcceptedIds.OrderBy(id => id, StringComparer.Ordinal).ToArray());
    }

    private static bool FeedbackEquals(
        AiRunEntity run,
        FeedbackInput feedback,
        User actor)
    {
        var storedIds = DeserializeChangeIds(run.AcceptedChangeIdsJson);
        return run.FeedbackDecision == feedback.Decision &&
               run.FeedbackReason == feedback.Reason &&
               run.FeedbackByActorId == actor.Id &&
               storedIds.SequenceEqual(feedback.AcceptedChangeIds, StringComparer.Ordinal);
    }

    private static string[] DeserializeChangeIds(string json)
    {
        try
        {
            var ids = JsonSerializer.Deserialize<string[]>(json, ProcessJson.Options);
            if (ids is null ||
                ids.Length > 20 ||
                ids.Distinct(StringComparer.Ordinal).Count() != ids.Length ||
                ids.Any(id =>
                    string.IsNullOrWhiteSpace(id) ||
                    id.Length > 160 ||
                    !ResultIdentifierPattern().IsMatch(id)))
            {
                throw CorruptRunData();
            }

            var opaqueIds = ids.Select(NormalizeStoredChangeId).ToArray();
            if (opaqueIds.Distinct(StringComparer.Ordinal).Count() != opaqueIds.Length)
            {
                throw CorruptRunData();
            }

            return opaqueIds;
        }
        catch (JsonException)
        {
            throw CorruptRunData();
        }
    }

    private static void ValidateProviderResult(
        string provider,
        string model,
        string resultStatus,
        string outputHash,
        int questionCount,
        int issueCount,
        int changeCount,
        IReadOnlyList<string> proposedChangeIds,
        long durationMs)
    {
        if (string.IsNullOrWhiteSpace(provider) ||
            provider.Length > 80 ||
            string.IsNullOrWhiteSpace(model) ||
            model.Length > 180 ||
            !ResultStatuses.Contains(resultStatus) ||
            !IsSha256(outputHash) ||
            questionCount is < 0 or > 5 ||
            issueCount is < 0 or > 20 ||
            changeCount is < 0 or > 20 ||
            proposedChangeIds.Count != changeCount ||
            proposedChangeIds.Distinct(StringComparer.Ordinal).Count() != proposedChangeIds.Count ||
            proposedChangeIds.Any(id =>
                string.IsNullOrWhiteSpace(id) ||
                id.Length > 160 ||
                !ResultIdentifierPattern().IsMatch(id)) ||
            durationMs < 0)
        {
            throw Invalid(
                "ai-run-result-invalid",
                "Het resultaat van de AI-run bevat ongeldige metadata.");
        }
    }

    private static string? NormalizeProviderValue(string? value, int maxLength) =>
        string.IsNullOrWhiteSpace(value)
            ? null
            : value.Trim()[..Math.Min(value.Trim().Length, maxLength)];

    private static bool IsSha256(string value) =>
        value.Length == 71 &&
        value.StartsWith("sha256:", StringComparison.Ordinal) &&
        value[7..].All(Uri.IsHexDigit);

    private static bool IsOpaqueChangeId(string value) =>
        value.Length == 71 &&
        value.StartsWith("chg:v1:", StringComparison.Ordinal) &&
        value[7..].All(Uri.IsHexDigit);

    private static string HashModelChangeId(string value)
    {
        var hash = ProcessMaintenanceHash.Sha256(
            $"process-maintenance-change-id:v1\u0000{value}");
        return $"chg:v1:{hash[7..]}";
    }

    private static string NormalizeAcceptedChangeId(string value) =>
        HashModelChangeId(value);

    private static string NormalizeStoredChangeId(string value) =>
        IsOpaqueChangeId(value)
            ? value.ToLowerInvariant()
            : HashModelChangeId(value);

    private static string? NormalizeFeedbackReason(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        return string.Join(
            ' ',
            value.Trim().Split(
                ' ',
                StringSplitOptions.RemoveEmptyEntries));
    }

    private static void ValidateRequestAuditMetadata(
        AiRunRequestAuditMetadata metadata,
        int processRevision)
    {
        if (!metadata.SchemaVersion.Equals(
                ProcessMaintenanceService.SchemaVersion,
                StringComparison.Ordinal) ||
            metadata.ExpectedRevision != processRevision ||
            metadata.StepCount is < 0 or > 50 ||
            metadata.AnswerCount is < 0 or > 5 ||
            (metadata.Trigger is not null &&
             !TriggerKinds.Contains(metadata.Trigger)))
        {
            throw Invalid(
                "ai-run-request-audit-invalid",
                "De auditmetadata van de AI-run is ongeldig.");
        }
    }

    private void AddLifecycleAudit(
        string action,
        AiRunEntity run,
        DateTimeOffset timestamp,
        object details,
        string? actorId = null,
        string? actorName = null)
    {
        db.AuditLogs.Add(new AuditLogEntity
        {
            Action = action,
            EntityType = "process",
            EntityId = run.ProcessId,
            ActorId = actorId ?? run.ActorId,
            ActorName = actorName ?? run.ActorName,
            CreatedAtUtc = timestamp,
            DetailsJson = JsonSerializer.Serialize(details, ProcessJson.Options)
        });
    }

    private static void ValidateRunId(string runId)
    {
        if (!Guid.TryParseExact(runId, "N", out _))
        {
            throw Invalid(
                "ai-run-id-invalid",
                "Het AI-run-id is ongeldig.");
        }
    }

    private static void ValidateActor(User actor)
    {
        if (string.IsNullOrWhiteSpace(actor.Id) ||
            actor.Id.Length > 180 ||
            string.IsNullOrWhiteSpace(actor.Naam) ||
            actor.Naam.Length > 220)
        {
            throw Invalid(
                "ai-run-actor-invalid",
                "De gebruiker van de AI-run is ongeldig.");
        }
    }

    private static AiRunLedgerException CorruptRunData() =>
        new(
            "ai-run-data-invalid",
            "De opgeslagen AI-runmetadata is ongeldig en kan niet veilig worden gebruikt.",
            StatusCodes.Status503ServiceUnavailable);

    private static AiRunLedgerException Invalid(string code, string message) =>
        new(code, message, StatusCodes.Status400BadRequest);

    private sealed record FeedbackInput(
        string Decision,
        string? Reason,
        IReadOnlyList<string> AcceptedChangeIds);

    [GeneratedRegex("^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$", RegexOptions.CultureInvariant)]
    private static partial Regex ResultIdentifierPattern();

    [GeneratedRegex(
        "(?:https?://|www\\.|@|[0-9]{8,}|[\\r\\n\\t])",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex UnsafeFeedbackReasonPattern();
}
