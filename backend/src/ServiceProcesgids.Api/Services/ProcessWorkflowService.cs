using Microsoft.EntityFrameworkCore;
using ServiceProcesgids.Api.Contract;
using ServiceProcesgids.Api.Data;
using ServiceProcesgids.Api.Models;

namespace ServiceProcesgids.Api.Services;

public enum ProcessWorkflowAction { Submit, Approve, Reject }

public sealed class ProcessWorkflowException(string code, string message, int statusCode = 409)
    : Exception(message)
{
    public string Code { get; } = code;
    public int StatusCode { get; } = statusCode;
}

/// <summary>Publishes exactly the revision a reviewer has seen, with an atomic version and audit.</summary>
public sealed class ProcessWorkflowService(
    AppDbContext db,
    ProcessVersionService versions,
    ProcessHealthService health,
    AuditLogService audit)
{
    public async Task<VersionDocument> TransitionAsync(
        string id,
        ProcessWorkflowAction action,
        int? expectedRevision,
        string? comment,
        User actor,
        CancellationToken cancellationToken = default)
    {
        if (expectedRevision is null or < 1)
        {
            throw new ProcessWorkflowException("expected-revision-required",
                "De bekeken revisie ontbreekt. Laad het proces opnieuw voordat je deze actie uitvoert.", 400);
        }

        var entity = await db.Processes.SingleOrDefaultAsync(process => process.Id == id, cancellationToken)
            ?? throw new ProcessWorkflowException("process-not-found", $"Proces '{id}' is niet gevonden.", 404);
        if (entity.Revision != expectedRevision)
        {
            throw RevisionConflict();
        }

        var requiredStatus = action == ProcessWorkflowAction.Submit ? "concept" : "in-review";
        if (entity.Status != requiredStatus)
        {
            throw new ProcessWorkflowException("workflow-invalid-status",
                action == ProcessWorkflowAction.Submit
                    ? "Alleen conceptprocessen kunnen worden ingediend."
                    : "Alleen ingediende processen kunnen worden beoordeeld.");
        }

        if (action != ProcessWorkflowAction.Reject)
        {
            var knownIds = (await db.Processes.AsNoTracking()
                .Where(process => process.Status != "gearchiveerd")
                .Select(process => process.Id).ToListAsync(cancellationToken))
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
            var issues = health.CreateReport(ProcessMapper.ToDocument(entity), knownIds)
                .Issues.Where(issue => issue.Ernst == "fout").ToList();
            if (issues.Count > 0)
            {
                throw new ProcessWorkflowException("process-health-blocking",
                    $"Actie geblokkeerd: {string.Join(" | ", issues.Select(issue => issue.Bericht))}");
            }
        }

        var (status, auditAction, defaultComment) = action switch
        {
            ProcessWorkflowAction.Submit => ("in-review", "process.submit", "Ingediend ter goedkeuring"),
            ProcessWorkflowAction.Approve => ("live", "process.approve", "Goedgekeurd en live gezet"),
            ProcessWorkflowAction.Reject => ("concept", "process.reject", "Afgewezen"),
            _ => throw new ArgumentOutOfRangeException(nameof(action))
        };
        var processedSuggestions = action == ProcessWorkflowAction.Approve
            ? await db.Suggestions.AsNoTracking()
                .Where(suggestion => suggestion.ProcessId == id && suggestion.Status == "verwerkt")
                .Select(suggestion => suggestion.Id).ToListAsync(cancellationToken)
            : null;
        var document = ProcessMapper.ToDocument(entity) with
        {
            Status = status,
            Revision = entity.Revision + 1,
            LaatsteWijziging = DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd")
        };

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        try
        {
            ProcessMapper.UpdateEntity(entity, document, document.Revision!.Value);
            await db.SaveChangesAsync(cancellationToken);
            var version = await versions.CreateSnapshotAsync(entity, actor.Naam,
                string.IsNullOrWhiteSpace(comment) ? defaultComment : comment,
                processedSuggestions, cancellationToken);
            await audit.WriteAsync(auditAction, "process", id, actor,
                new { version.VersieNr, expectedRevision, revision = entity.Revision, opmerking = comment },
                cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return version;
        }
        catch (DbUpdateConcurrencyException)
        {
            await transaction.RollbackAsync(cancellationToken);
            db.ChangeTracker.Clear();
            throw RevisionConflict();
        }
    }

    private static ProcessWorkflowException RevisionConflict() => new("revision-conflict",
        "Het proces is ondertussen gewijzigd. Laad de actuele versie opnieuw en controleer de wijzigingen voordat je verdergaat.");
}
