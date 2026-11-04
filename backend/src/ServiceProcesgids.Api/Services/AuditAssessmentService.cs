using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using ServiceProcesgids.Api.Contract;
using ServiceProcesgids.Api.Data;
using ServiceProcesgids.Api.Data.Entities;
using ServiceProcesgids.Api.Models;

namespace ServiceProcesgids.Api.Services;

public sealed class AuditAssessmentException(
    string code,
    string message,
    int statusCode = StatusCodes.Status400BadRequest) : Exception(message)
{
    public string Code { get; } = code;
    public int StatusCode { get; } = statusCode;
}

/// <summary>
/// Integriteitsgrens voor menselijke kaderbeoordelingen. Actor, tijd en
/// procesrevisie komen uitsluitend van de server. Een bevestiging is een
/// traceerbare beoordeling en nadrukkelijk geen certificeringsbesluit.
/// </summary>
public sealed partial class AuditAssessmentService(
    AppDbContext dbContext,
    IsoService isoService,
    AuditLogService auditLog)
{
    private static readonly HashSet<string> Outcomes =
        new(StringComparer.OrdinalIgnoreCase)
        {
            "voldoet",
            "actie-nodig",
            "niet-van-toepassing"
        };
    private static readonly TimeSpan AssessmentLifetime = TimeSpan.FromHours(2);

    private sealed record PersistedAssessment(
        string AssessmentId,
        string FrameworkId,
        int ProcessRevision,
        string CatalogVersion,
        string ActorId,
        string ActorName,
        DateTimeOffset StartedAt,
        DateTimeOffset ExpiresAt);

    public async Task<AuditBeoordelingStart> StartAsync(
        string processId,
        string frameworkId,
        User actor,
        CancellationToken cancellationToken = default)
    {
        var normalizedFramework = NormalizeFramework(frameworkId);
        var process = await dbContext.Processes
            .AsNoTracking()
            .FirstOrDefaultAsync(item => item.Id == processId, cancellationToken)
            ?? throw new AuditAssessmentException(
                "process-not-found",
                $"Proces '{processId}' is niet gevonden.",
                StatusCodes.Status404NotFound);
        var startedAt = DateTimeOffset.UtcNow;
        var expiresAt = startedAt.Add(AssessmentLifetime);
        var assessmentId = Guid.NewGuid().ToString("N");
        var result = new AuditBeoordelingStart(
            assessmentId,
            process.Id,
            normalizedFramework,
            actor.Id,
            actor.Naam,
            startedAt.ToString("O"),
            expiresAt.ToString("O"),
            process.Revision,
            AuditControlCatalog.Version);

        await auditLog.WriteAsync(
            "audit.review.start",
            "process",
            process.Id,
            actor,
            new
            {
                assessmentId,
                kaderId = normalizedFramework,
                processRevision = process.Revision,
                catalogVersion = AuditControlCatalog.Version,
                expiresAt = expiresAt.ToString("O"),
                betekenis = "Menselijke beoordeling gestart; dit is geen certificering."
            },
            cancellationToken);
        return result;
    }

    public async Task<AuditBevestiging> ConfirmAsync(
        string processId,
        AuditBevestigingRequest request,
        User actor,
        CancellationToken cancellationToken = default)
    {
        var normalized = Validate(request);
        await using var transaction = await dbContext.Database.BeginTransactionAsync(
            IsolationLevel.Serializable,
            cancellationToken);
        var process = await dbContext.Processes
            .AsNoTracking()
            .FirstOrDefaultAsync(item => item.Id == processId, cancellationToken)
            ?? throw new AuditAssessmentException(
                "process-not-found",
                $"Proces '{processId}' is niet gevonden.",
                StatusCodes.Status404NotFound);
        var assessment = await LoadAssessmentAsync(
            process.Id,
            normalized.AssessmentId,
            cancellationToken);
        ValidateAssessment(assessment, normalized, process.Revision, actor);
        if (!AuditControlCatalog.IsManualControl(
                normalized.KaderId,
                normalized.ControleId))
        {
            throw new AuditAssessmentException(
                "audit-control-not-manual",
                "Deze controle staat niet als handmatige controle in de actuele, versioned controlcatalogus.");
        }

        var currentConfig = await isoService.GetConfigAsync(process.Id, cancellationToken);
        var previous = (currentConfig.AuditBevestigingen ?? [])
            .SingleOrDefault(item =>
                item.KaderId.Equals(normalized.KaderId, StringComparison.OrdinalIgnoreCase) &&
                item.ControleId.Equals(normalized.ControleId, StringComparison.OrdinalIgnoreCase));
        var confirmedAt = DateTimeOffset.UtcNow;
        var rationaleHash = RationaleHash(
            normalized.Toelichting!,
            normalized.Bewijsreferentie);
        var confirmation = new AuditBevestiging(
            assessment.AssessmentId,
            assessment.CatalogVersion,
            normalized.KaderId,
            normalized.ControleId,
            normalized.Uitkomst,
            normalized.Toelichting!,
            normalized.Bewijsreferentie,
            actor.Id,
            actor.Naam,
            confirmedAt.ToString("O"),
            process.Revision);

        await isoService.SaveAuditConfirmationAsync(
            process.Id,
            confirmation,
            actor.Naam,
            cancellationToken);
        await auditLog.WriteAsync(
            "audit.confirmation.record",
            "process",
            process.Id,
            actor,
            new
            {
                confirmation.KaderId,
                confirmation.ControleId,
                confirmation.Uitkomst,
                confirmation.Bewijsreferentie,
                confirmation.ProcessRevision,
                confirmation.AssessmentId,
                confirmation.CatalogVersion,
                rationaleHash,
                supersedes = previous is null
                    ? null
                    : new
                    {
                        previous.AssessmentId,
                        previous.BevestigdOp,
                        rationaleHash = RationaleHash(
                            previous.Toelichting,
                            previous.Bewijsreferentie)
                    },
                betekenis = "Menselijke beoordeling; geen certificering."
            },
            cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return confirmation;
    }

    public static AuditBevestigingRequest Validate(AuditBevestigingRequest request)
    {
        var assessmentId = request.AssessmentId?.Trim().ToLowerInvariant() ?? "";
        var framework = NormalizeFramework(request.KaderId);
        var controlId = request.ControleId?.Trim().ToLowerInvariant() ?? "";
        var outcome = request.Uitkomst?.Trim().ToLowerInvariant() ?? "";
        var explanation = request.Toelichting?.Trim() ?? "";
        var evidence = string.IsNullOrWhiteSpace(request.Bewijsreferentie)
            ? null
            : request.Bewijsreferentie.Trim();

        if (!Guid.TryParseExact(assessmentId, "N", out _))
        {
            throw new AuditAssessmentException(
                "audit-assessment-required",
                "Start eerst een handmatige beoordeling en gebruik het server-assessment-id.",
                StatusCodes.Status409Conflict);
        }

        if (request.ExpectedRevision <= 0)
        {
            throw new AuditAssessmentException(
                "audit-revision-required",
                "De verwachte procesrevisie ontbreekt.",
                StatusCodes.Status409Conflict);
        }

        if (!ControlIdPattern().IsMatch(controlId))
        {
            throw new AuditAssessmentException(
                "audit-control-invalid",
                "De kadercontrole heeft geen geldig controle-id.");
        }

        if (!Outcomes.Contains(outcome))
        {
            throw new AuditAssessmentException(
                "audit-outcome-invalid",
                "Kies voldoet, actie-nodig of niet-van-toepassing.");
        }

        if (explanation.Length < 10 || explanation.Length > 2000)
        {
            throw new AuditAssessmentException(
                "audit-explanation-required",
                "Leg de beoordeling uit in 10 tot 2000 tekens.");
        }

        if (outcome == "voldoet" && string.IsNullOrWhiteSpace(evidence))
        {
            throw new AuditAssessmentException(
                "audit-evidence-required",
                "Een bevestiging 'voldoet' vereist een controleerbare bewijsreferentie.");
        }

        if (evidence?.Length > 500)
        {
            throw new AuditAssessmentException(
                "audit-evidence-too-long",
                "De bewijsreferentie mag maximaal 500 tekens bevatten.");
        }

        return new AuditBevestigingRequest(
            assessmentId,
            request.ExpectedRevision,
            framework,
            controlId,
            outcome,
            explanation,
            evidence);
    }

    public static bool IsValidFramework(string? frameworkId) =>
        AuditControlCatalog.IsKnownFramework(frameworkId);

    public static bool IsValidOutcome(string? outcome) =>
        !string.IsNullOrWhiteSpace(outcome) &&
        Outcomes.Contains(outcome.Trim());

    private static string NormalizeFramework(string? frameworkId)
    {
        var normalized = frameworkId?.Trim().ToLowerInvariant() ?? "";
        if (!AuditControlCatalog.IsKnownFramework(normalized))
        {
            throw new AuditAssessmentException(
                "audit-framework-invalid",
                "Kies een ondersteund ISO- of BPMN-kader.");
        }

        return normalized;
    }

    [GeneratedRegex("^[a-z0-9][a-z0-9-]{1,79}$", RegexOptions.CultureInvariant)]
    private static partial Regex ControlIdPattern();

    private async Task<PersistedAssessment> LoadAssessmentAsync(
        string processId,
        string assessmentId,
        CancellationToken cancellationToken)
    {
        var starts = await dbContext.AuditLogs
            .AsNoTracking()
            .Where(item =>
                item.Action == "audit.review.start" &&
                item.EntityType == "process" &&
                item.EntityId == processId)
            .OrderByDescending(item => item.Id)
            .ToListAsync(cancellationToken);
        foreach (var start in starts)
        {
            if (TryParseAssessment(start, assessmentId, out var assessment))
            {
                return assessment;
            }
        }

        throw new AuditAssessmentException(
            "audit-assessment-not-found",
            "Start eerst een handmatige beoordeling voor dit proces en kader.",
            StatusCodes.Status409Conflict);
    }

    private static bool TryParseAssessment(
        AuditLogEntity entry,
        string assessmentId,
        out PersistedAssessment assessment)
    {
        assessment = default!;
        if (string.IsNullOrWhiteSpace(entry.DetailsJson))
        {
            return false;
        }

        try
        {
            using var document = JsonDocument.Parse(entry.DetailsJson);
            var root = document.RootElement;
            if (!root.TryGetProperty("assessmentId", out var id) ||
                !id.ValueEquals(assessmentId) ||
                !root.TryGetProperty("kaderId", out var framework) ||
                !root.TryGetProperty("processRevision", out var revision) ||
                !root.TryGetProperty("catalogVersion", out var catalogVersion) ||
                !root.TryGetProperty("expiresAt", out var expiresAt) ||
                framework.GetString() is not { } frameworkId ||
                catalogVersion.GetString() is not { } version ||
                !revision.TryGetInt32(out var processRevision) ||
                !DateTimeOffset.TryParse(expiresAt.GetString(), out var parsedExpiry))
            {
                return false;
            }

            assessment = new PersistedAssessment(
                assessmentId,
                frameworkId,
                processRevision,
                version,
                entry.ActorId,
                entry.ActorName,
                entry.CreatedAtUtc,
                parsedExpiry);
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private static void ValidateAssessment(
        PersistedAssessment assessment,
        AuditBevestigingRequest request,
        int currentRevision,
        User actor)
    {
        if (!assessment.ActorId.Equals(actor.Id, StringComparison.Ordinal))
        {
            throw new AuditAssessmentException(
                "audit-assessment-actor-mismatch",
                "Alleen de gebruiker die deze beoordeling startte kan binnen dit assessment bevestigen.",
                StatusCodes.Status409Conflict);
        }

        if (!assessment.FrameworkId.Equals(
                request.KaderId,
                StringComparison.OrdinalIgnoreCase))
        {
            throw new AuditAssessmentException(
                "audit-assessment-framework-mismatch",
                "Het assessment hoort bij een ander kader. Start een nieuwe beoordeling.",
                StatusCodes.Status409Conflict);
        }

        if (assessment.ExpiresAt <= DateTimeOffset.UtcNow)
        {
            throw new AuditAssessmentException(
                "audit-assessment-expired",
                "De handmatige beoordeling is verlopen. Start een nieuwe beoordeling.",
                StatusCodes.Status409Conflict);
        }

        if (!assessment.CatalogVersion.Equals(
                AuditControlCatalog.Version,
                StringComparison.Ordinal))
        {
            throw new AuditAssessmentException(
                "audit-catalog-changed",
                "De controlcatalogus is gewijzigd. Start de beoordeling opnieuw.",
                StatusCodes.Status409Conflict);
        }

        if (request.ExpectedRevision != assessment.ProcessRevision ||
            currentRevision != assessment.ProcessRevision)
        {
            throw new AuditAssessmentException(
                "audit-process-revision-changed",
                $"Het proces is gewijzigd van revisie {assessment.ProcessRevision} naar {currentRevision}. Start de beoordeling opnieuw.",
                StatusCodes.Status409Conflict);
        }
    }

    private static string RationaleHash(string explanation, string? evidence)
    {
        var canonical = $"{explanation.Trim()}\n{evidence?.Trim() ?? ""}";
        return $"sha256:{Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(canonical))).ToLowerInvariant()}";
    }
}
