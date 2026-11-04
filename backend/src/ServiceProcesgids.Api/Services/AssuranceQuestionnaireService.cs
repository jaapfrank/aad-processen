using System.Data;
using Microsoft.EntityFrameworkCore;
using ServiceProcesgids.Api.Contract;
using ServiceProcesgids.Api.Data;
using ServiceProcesgids.Api.Data.Entities;
using ServiceProcesgids.Api.Models;

namespace ServiceProcesgids.Api.Services;

public sealed class AssuranceQuestionnaireService(
    AppDbContext db,
    AssuranceFrameworkCatalogService catalog,
    AssuranceSettingsService settings,
    AuditLogService audit,
    TimeProvider timeProvider)
{
    private static readonly HashSet<string> Outcomes =
        new(StringComparer.Ordinal)
        {
            "ja",
            "deels",
            "nee",
            "onbekend",
            "nvt"
        };

    private const string ReadinessDisclaimer =
        "Gereed betekent dat alle evidencevragen zijn beantwoord. Dit is readiness-informatie en geen conformiteits-, certificerings- of auditverklaring.";

    public async Task<AssuranceQuestionnaire> StartAsync(
        string frameworkId,
        User actor,
        CancellationToken cancellationToken = default)
    {
        var normalizedFrameworkId = NormalizeFrameworkId(frameworkId);
        var activeFrameworkIds = await settings.GetActiveFrameworkIdsAsync(
            cancellationToken);
        if (!activeFrameworkIds.Contains(normalizedFrameworkId))
        {
            throw new AssuranceException(
                "assurance-framework-not-active",
                "Activeer dit kader eerst in de assurance-instellingen.",
                StatusCodes.Status409Conflict);
        }

        var now = timeProvider.GetUtcNow();
        var entity = new AssuranceQuestionnaireSessionEntity
        {
            SessionId = Guid.NewGuid().ToString("N"),
            TenantId = AssuranceSettingsService.TenantId,
            FrameworkId = normalizedFrameworkId,
            CatalogVersion = catalog.CurrentVersion,
            Status = "open",
            StartedByActorId = actor.Id,
            StartedByActorName = actor.Naam,
            StartedAtUtc = now,
            Revision = 1
        };

        await using var transaction = await db.Database.BeginTransactionAsync(
            cancellationToken);
        db.AssuranceQuestionnaireSessions.Add(entity);
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(
            "assurance.questionnaire.start",
            "assurance-questionnaire",
            entity.SessionId,
            actor,
            new
            {
                kaderId = normalizedFrameworkId,
                catalogVersion = entity.CatalogVersion,
                betekenis = ReadinessDisclaimer
            },
            cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return ToDocument(entity);
    }

    public async Task<IReadOnlyList<AssuranceQuestionnaire>> ListAsync(
        string? frameworkId,
        int? limit,
        CancellationToken cancellationToken = default)
    {
        var max = Math.Clamp(limit ?? 50, 1, 100);
        var normalizedFrameworkId = string.IsNullOrWhiteSpace(frameworkId)
            ? null
            : NormalizeFrameworkId(frameworkId);
        var query = db.AssuranceQuestionnaireSessions
            .AsNoTracking()
            .Include(item => item.Answers)
            .Where(item => item.TenantId == AssuranceSettingsService.TenantId);
        if (normalizedFrameworkId is not null)
        {
            query = query.Where(item =>
                item.FrameworkId == normalizedFrameworkId);
        }

        // SQLite ondersteunt DateTimeOffset niet in ORDER BY. De begrensde
        // standalone-set wordt daarom na materialisatie geordend.
        return (await query.ToListAsync(cancellationToken))
            .OrderByDescending(item => item.StartedAtUtc)
            .ThenByDescending(item => item.SessionId, StringComparer.Ordinal)
            .Take(max)
            .Select(ToDocument)
            .ToArray();
    }

    public async Task<AssuranceQuestionnaire> GetAsync(
        string sessionId,
        CancellationToken cancellationToken = default)
    {
        var normalizedSessionId = NormalizeSessionId(sessionId);
        var entity = await db.AssuranceQuestionnaireSessions
            .AsNoTracking()
            .Include(item => item.Answers)
            .SingleOrDefaultAsync(
                item =>
                    item.SessionId == normalizedSessionId &&
                    item.TenantId == AssuranceSettingsService.TenantId,
                cancellationToken)
            ?? throw new AssuranceException(
                "assurance-questionnaire-not-found",
                "De normcoach-sessie is niet gevonden.",
                StatusCodes.Status404NotFound);
        return ToDocument(entity);
    }

    public async Task<AssuranceQuestionnaire> AnswerAsync(
        string sessionId,
        AssuranceQuestionnaireAnswerRequest request,
        User actor,
        CancellationToken cancellationToken = default)
    {
        var normalizedSessionId = NormalizeSessionId(sessionId);
        var normalizedOutcome = NormalizeOutcome(request.Uitkomst);
        var questionId = request.VraagId?.Trim().ToLowerInvariant() ?? "";
        var evidenceReference = NormalizeOptional(
            request.Bewijsreferentie,
            500,
            "assurance-evidence-reference-too-long",
            "De bewijsreferentie mag maximaal 500 tekens bevatten.");
        var motivation = NormalizeOptional(
            request.Motivatie,
            2000,
            "assurance-motivation-too-long",
            "De motivatie mag maximaal 2000 tekens bevatten.");

        if (request.ExpectedRevision <= 0)
        {
            throw new AssuranceException(
                "assurance-questionnaire-revision-required",
                "De verwachte sessierevisie ontbreekt.",
                StatusCodes.Status409Conflict);
        }

        if (normalizedOutcome == "ja" &&
            string.IsNullOrWhiteSpace(evidenceReference))
        {
            throw new AssuranceException(
                "assurance-evidence-required",
                "Een antwoord 'ja' vereist een controleerbare bewijsreferentie.");
        }

        if (normalizedOutcome == "nvt" &&
            (motivation?.Length ?? 0) < 10)
        {
            throw new AssuranceException(
                "assurance-na-motivation-required",
                "Niet van toepassing vereist een motivatie van minimaal 10 tekens.");
        }

        await using var transaction = await db.Database.BeginTransactionAsync(
            IsolationLevel.Serializable,
            cancellationToken);
        var entity = await db.AssuranceQuestionnaireSessions
            .Include(item => item.Answers)
            .SingleOrDefaultAsync(
                item =>
                    item.SessionId == normalizedSessionId &&
                    item.TenantId == AssuranceSettingsService.TenantId,
                cancellationToken)
            ?? throw new AssuranceException(
                "assurance-questionnaire-not-found",
                "De normcoach-sessie is niet gevonden.",
                StatusCodes.Status404NotFound);
        if (entity.Status != "open")
        {
            throw new AssuranceException(
                "assurance-questionnaire-completed",
                "Deze readiness-sessie is afgerond. Start een nieuwe sessie om opnieuw te beoordelen.",
                StatusCodes.Status409Conflict);
        }

        if (entity.Revision != request.ExpectedRevision)
        {
            throw new AssuranceException(
                "assurance-questionnaire-revision-changed",
                $"De sessie is gewijzigd. Verwacht revisie {request.ExpectedRevision}, actueel is {entity.Revision}.",
                StatusCodes.Status409Conflict);
        }

        var framework = catalog.Get(entity.FrameworkId);
        if (!framework.Vragen.Any(item => item.Id == questionId))
        {
            throw new AssuranceException(
                "assurance-question-invalid",
                "De vraag behoort niet tot deze catalogusversie.");
        }

        var now = timeProvider.GetUtcNow();
        var answer = entity.Answers.SingleOrDefault(item =>
            item.QuestionId == questionId);
        if (answer is null)
        {
            answer = new AssuranceQuestionnaireAnswerEntity
            {
                SessionId = entity.SessionId,
                QuestionId = questionId,
                Session = entity,
                Revision = 1
            };
            entity.Answers.Add(answer);
        }
        else
        {
            answer.Revision++;
        }

        answer.Outcome = normalizedOutcome;
        answer.EvidenceReference = evidenceReference;
        answer.Motivation = motivation;
        answer.AnsweredByActorId = actor.Id;
        answer.AnsweredByActorName = actor.Naam;
        answer.AnsweredAtUtc = now;
        entity.Revision++;
        if (framework.Vragen.All(question =>
                entity.Answers.Any(item => item.QuestionId == question.Id)))
        {
            entity.Status = "gereed";
            entity.CompletedAtUtc = now;
        }

        try
        {
            await db.SaveChangesAsync(cancellationToken);
            await audit.WriteAsync(
                "assurance.questionnaire.answer",
                "assurance-questionnaire",
                entity.SessionId,
                actor,
                new
                {
                    kaderId = entity.FrameworkId,
                    vraagId = questionId,
                    uitkomst = normalizedOutcome,
                    bewijsAanwezig = evidenceReference is not null,
                    motivatieAanwezig = motivation is not null,
                    status = entity.Status,
                    entity.Revision,
                    betekenis = ReadinessDisclaimer
                },
                cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            throw new AssuranceException(
                "assurance-questionnaire-revision-changed",
                "De sessie is gelijktijdig gewijzigd. Herlaad de normcoach.",
                StatusCodes.Status409Conflict);
        }

        return ToDocument(entity);
    }

    internal AssuranceQuestionnaire ToDocument(
        AssuranceQuestionnaireSessionEntity entity)
    {
        var framework = catalog.Get(entity.FrameworkId);
        var answers = entity.Answers
            .OrderBy(item => item.QuestionId, StringComparer.Ordinal)
            .Select(item => new AssuranceQuestionnaireAnswer(
                item.QuestionId,
                item.Outcome,
                item.EvidenceReference,
                item.Motivation,
                item.AnsweredByActorName,
                item.AnsweredAtUtc.ToString("O")))
            .ToArray();
        var counts = answers
            .GroupBy(item => item.Uitkomst)
            .ToDictionary(group => group.Key, group => group.Count());
        var total = framework.Vragen.Count;
        var answered = answers.Length;
        var readiness = new AssuranceReadiness(
            answered,
            total,
            counts.GetValueOrDefault("ja"),
            counts.GetValueOrDefault("deels"),
            counts.GetValueOrDefault("nee"),
            counts.GetValueOrDefault("onbekend"),
            counts.GetValueOrDefault("nvt"),
            answers.Count(item =>
                item.Uitkomst == "ja" &&
                !string.IsNullOrWhiteSpace(item.Bewijsreferentie)),
            Math.Max(0, total - answered),
            ReadinessDisclaimer);

        return new AssuranceQuestionnaire(
            entity.SessionId,
            entity.FrameworkId,
            framework.Naam,
            entity.CatalogVersion,
            entity.Status,
            entity.StartedByActorName,
            entity.StartedAtUtc.ToString("O"),
            entity.CompletedAtUtc?.ToString("O"),
            entity.Revision,
            framework.Vragen,
            answers,
            readiness);
    }

    private string NormalizeFrameworkId(string? frameworkId)
    {
        var normalized = frameworkId?.Trim().ToLowerInvariant() ?? "";
        if (!catalog.IsKnown(normalized))
        {
            throw new AssuranceException(
                "assurance-framework-invalid",
                "Kies een bekend assurancekader.");
        }

        return normalized;
    }

    private static string NormalizeSessionId(string? sessionId)
    {
        var normalized = sessionId?.Trim().ToLowerInvariant() ?? "";
        if (!Guid.TryParseExact(normalized, "N", out _))
        {
            throw new AssuranceException(
                "assurance-questionnaire-id-invalid",
                "De normcoach-sessie heeft geen geldig id.");
        }

        return normalized;
    }

    private static string NormalizeOutcome(string? outcome)
    {
        var normalized = outcome?.Trim().ToLowerInvariant() ?? "";
        if (!Outcomes.Contains(normalized))
        {
            throw new AssuranceException(
                "assurance-outcome-invalid",
                "Kies ja, deels, nee, onbekend of nvt.");
        }

        return normalized;
    }

    private static string? NormalizeOptional(
        string? value,
        int maxLength,
        string errorCode,
        string errorMessage)
    {
        var normalized = string.IsNullOrWhiteSpace(value)
            ? null
            : value.Trim();
        if (normalized?.Length > maxLength)
        {
            throw new AssuranceException(errorCode, errorMessage);
        }

        return normalized;
    }
}
