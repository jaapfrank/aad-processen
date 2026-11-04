using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ServiceProcesgids.Api.Contract;
using ServiceProcesgids.Api.Data;

namespace ServiceProcesgids.Api.Services;

internal sealed record ProcessMaintenanceStepContext(
    string Id,
    string Nummer,
    string LaneId,
    string LaneNaam,
    string Type,
    string Activiteit,
    string? Toelichting,
    string? Opmerking,
    string? Zijnotitie,
    string? Voorwaarde,
    string? ErpStatus,
    string? Termijn,
    string? Waarschuwing,
    IReadOnlyList<string> Checklist,
    IReadOnlyList<string> FotoEisen,
    string? NaarStap,
    string? NaarProces,
    IReadOnlyList<StepRoute> Routes);

internal sealed record ProcessMaintenanceSuggestionContext(
    string Id,
    string? StapId,
    string Type,
    string Tekst);

internal sealed record ProcessMaintenanceIsoContext(
    IReadOnlyList<IsoMapping> Mappings,
    ProcessGovernance? Governance,
    IReadOnlyList<ProcessMaintenanceConfirmationContext> Bevestigingen);

internal sealed record ProcessMaintenanceConfirmationContext(
    string KaderId,
    string ControleId,
    string Uitkomst,
    string Toelichting,
    string? Bewijsreferentie,
    int ProcessRevision);

internal sealed record ProcessMaintenanceModelSource(
    string Id,
    string Type,
    string? StapId,
    string? Veld,
    string Inhoud);

internal sealed record ProcessMaintenanceAnswerContext(
    string VraagId,
    string Antwoord,
    string BronId);

internal sealed record ProcessMaintenanceModelContext(
    string SchemaVersion,
    string ProcesId,
    int ProcessRevision,
    string Hoofdproces,
    string Detailproces,
    string Versie,
    string Status,
    string LaatsteWijziging,
    string? Doel,
    ProcessMaintenanceTrigger? Aanleiding,
    IReadOnlyList<ProcessMaintenanceAnswerContext> Antwoorden,
    IReadOnlyList<ProcessMaintenanceStepContext> Stappen,
    IReadOnlyList<HealthIssue> Gezondheidsissues,
    ProcessMaintenanceIsoContext Iso,
    IReadOnlyList<ProcessMaintenanceSuggestionContext> OpenSuggesties,
    IReadOnlyList<ProcessMaintenanceModelSource> Bronnen);

internal sealed record ProcessMaintenanceContext(
    ProcessDocument Process,
    ProcessMaintenanceAnalysisRequest Request,
    ProcessMaintenanceModelContext ModelContext,
    IReadOnlyDictionary<string, ProcessMaintenanceSource> Sources,
    IReadOnlySet<string> ScopedStepIds);

public sealed class ProcessMaintenanceContextService(
    AppDbContext db,
    ProcessHealthService health,
    IsoService iso,
    ProcessMaintenanceValidator validator)
{
    private const int MaxProcessSteps = 200;
    private const int MaxOpenSuggestions = 200;
    private const int MaxContextBytes = 300_000;

    internal async Task<ProcessMaintenanceContext> BuildAsync(
        string processId,
        ProcessMaintenanceAnalysisRequest request,
        CancellationToken cancellationToken)
    {
        var normalizedRequest = validator.NormalizeRequest(request);
        var entity = await db.Processes
            .AsNoTracking()
            .FirstOrDefaultAsync(process => process.Id == processId, cancellationToken);
        if (entity is null)
        {
            throw new ProcessMaintenanceException(
                "process-not-found",
                $"Werkversie van proces '{processId}' is niet gevonden.",
                StatusCodes.Status404NotFound);
        }

        if (entity.Status.Equals("gearchiveerd", StringComparison.OrdinalIgnoreCase))
        {
            throw new ProcessMaintenanceException(
                "process-archived",
                "Een gearchiveerd proces kan niet door de onderhoudsassistent worden gewijzigd.",
                StatusCodes.Status409Conflict);
        }

        if (normalizedRequest.ExpectedRevision != entity.Revision)
        {
            throw new ProcessMaintenanceException(
                "process-revision-changed",
                $"Het proces is gewijzigd. Verwacht revisie {normalizedRequest.ExpectedRevision}, actueel is {entity.Revision}.",
                StatusCodes.Status409Conflict);
        }

        var process = ProcessMapper.ToDocument(entity);
        var scopedStepIds = validator.ValidateScope(normalizedRequest, process);
        var selectedSteps = process.Stappen
            .Where(step => scopedStepIds.Contains(step.Id))
            .ToList();
        if (selectedSteps.Count > MaxProcessSteps)
        {
            throw new ProcessMaintenanceException(
                "ai-process-too-large",
                $"Selecteer maximaal {MaxProcessSteps} stappen voor één onderhoudsanalyse.",
                StatusCodes.Status413PayloadTooLarge);
        }

        var knownProcessIds = (await db.Processes
                .AsNoTracking()
                .Where(item => item.Status != "gearchiveerd")
                .Select(item => item.Id)
                .ToListAsync(cancellationToken))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var healthIssues = health
            .CreateReport(process, knownProcessIds)
            .Issues
            .Where(issue => issue.StapId is null || scopedStepIds.Contains(issue.StapId))
            .ToList();
        var isoConfig = await iso.GetConfigAsync(process.Id, cancellationToken);
        // SQLite kan DateTimeOffset niet server-side sorteren. De begrensde
        // processelectie wordt daarom eerst geladen en daarna deterministisch
        // in het geheugen geordend.
        var suggestions = (await db.Suggestions
                .AsNoTracking()
                .Where(item =>
                    item.ProcessId == process.Id &&
                    item.Status == "open" &&
                    (item.StepId == null || scopedStepIds.Contains(item.StepId)))
                .OrderBy(item => item.Id)
                .Take(MaxOpenSuggestions)
                .ToListAsync(cancellationToken))
            .OrderBy(item => item.CreatedAtUtc)
            .ThenBy(item => item.Id, StringComparer.Ordinal)
            .Select(item => new ProcessMaintenanceSuggestionContext(
                item.Id,
                item.StepId,
                item.Type,
                item.Text))
            .ToList();

        var lanes = process.Lanes.ToDictionary(
            lane => lane.Id,
            lane => lane.Naam,
            StringComparer.OrdinalIgnoreCase);
        var stepContexts = selectedSteps.Select(step => new ProcessMaintenanceStepContext(
            step.Id,
            step.Nummer,
            step.LaneId,
            lanes.GetValueOrDefault(step.LaneId, step.LaneId),
            step.Type,
            step.Activiteit,
            step.Toelichting,
            step.Opmerking,
            step.Zijnotitie,
            step.Voorwaarde,
            step.ErpStatus,
            step.Termijn,
            step.Waarschuwing,
            step.Checklist ?? [],
            step.FotoEisen ?? [],
            step.NaarStap,
            step.NaarProces,
            step.Routes ?? [])).ToList();

        var sourceBuilder = new SourceBuilder(process);
        sourceBuilder.AddProcess();
        if (normalizedRequest.Doel is not null)
        {
            sourceBuilder.Add(
                "request:goal",
                "user-input",
                null,
                "doel",
                "Doel van de onderhoudsanalyse",
                normalizedRequest.Doel);
        }

        if (normalizedRequest.Aanleiding is not null)
        {
            sourceBuilder.Add(
                "request:trigger",
                "user-input",
                null,
                "aanleiding",
                "Door gebruiker geselecteerde aanleiding",
                JsonSerializer.Serialize(normalizedRequest.Aanleiding, ProcessJson.Options));
        }

        var answerContexts = new List<ProcessMaintenanceAnswerContext>();
        foreach (var (questionId, answer) in
                 normalizedRequest.Antwoorden ?? new Dictionary<string, string>())
        {
            var sourceId = $"request:answer:{questionId}";
            sourceBuilder.Add(
                sourceId,
                "user-answer",
                null,
                questionId,
                $"Antwoord op verduidelijkingsvraag {questionId}",
                answer);
            answerContexts.Add(new ProcessMaintenanceAnswerContext(
                questionId,
                answer,
                sourceId));
        }

        foreach (var step in selectedSteps)
        {
            sourceBuilder.AddStep(step);
        }

        foreach (var (issue, index) in healthIssues.Select((issue, index) => (issue, index)))
        {
            sourceBuilder.Add(
                $"health:{index + 1}",
                "health",
                issue.StapId,
                issue.Soort,
                $"Gezondheidscontrole {issue.Soort}",
                issue.Bericht);
        }

        foreach (var suggestion in suggestions)
        {
            sourceBuilder.Add(
                $"suggestion:{suggestion.Id}",
                "suggestion",
                suggestion.StapId,
                suggestion.Type,
                $"Open suggestie {suggestion.Id}",
                suggestion.Tekst);
        }

        AddIsoSources(sourceBuilder, isoConfig);
        var modelSources = sourceBuilder.ModelSources;
        var publicSources = sourceBuilder.PublicSources;
        var modelContext = new ProcessMaintenanceModelContext(
            ProcessMaintenanceService.SchemaVersion,
            process.Id,
            entity.Revision,
            process.Hoofdproces,
            process.Detailproces,
            process.Versie,
            process.Status,
            process.LaatsteWijziging,
            normalizedRequest.Doel,
            normalizedRequest.Aanleiding,
            answerContexts,
            stepContexts,
            healthIssues,
            new ProcessMaintenanceIsoContext(
                isoConfig.Mappings,
                isoConfig.Governance,
                (isoConfig.AuditBevestigingen ?? []).Select(item =>
                    new ProcessMaintenanceConfirmationContext(
                        item.KaderId,
                        item.ControleId,
                        item.Uitkomst,
                        item.Toelichting,
                        item.Bewijsreferentie,
                        item.ProcessRevision)).ToList()),
            suggestions,
            modelSources);

        var contextJson = JsonSerializer.Serialize(modelContext, ProcessJson.Options);
        if (Encoding.UTF8.GetByteCount(contextJson) > MaxContextBytes)
        {
            throw new ProcessMaintenanceException(
                "ai-context-too-large",
                "De geselecteerde procescontext is te groot. Selecteer minder stappen.",
                StatusCodes.Status413PayloadTooLarge);
        }

        return new ProcessMaintenanceContext(
            process,
            normalizedRequest,
            modelContext,
            publicSources,
            scopedStepIds);
    }

    internal async Task EnsureRevisionAsync(
        string processId,
        int expectedRevision,
        CancellationToken cancellationToken)
    {
        var currentRevision = await db.Processes
            .AsNoTracking()
            .Where(process => process.Id == processId)
            .Select(process => (int?)process.Revision)
            .SingleOrDefaultAsync(cancellationToken);
        if (currentRevision != expectedRevision)
        {
            throw new ProcessMaintenanceException(
                "process-revision-changed",
                "Het proces is tijdens de AI-analyse gewijzigd. Start de analyse opnieuw.",
                StatusCodes.Status409Conflict);
        }
    }

    private static void AddIsoSources(SourceBuilder builder, IsoProcessConfig config)
    {
        for (var index = 0; index < config.Mappings.Count; index++)
        {
            var mapping = config.Mappings[index];
            builder.Add(
                $"iso:mapping:{index + 1}",
                "iso-mapping",
                null,
                mapping.Norm,
                $"ISO-koppeling {mapping.Norm}",
                JsonSerializer.Serialize(mapping, ProcessJson.Options));
        }

        if (config.Governance is not null)
        {
            builder.Add(
                "iso:governance",
                "iso-governance",
                null,
                "governance",
                "Procesgovernance",
                JsonSerializer.Serialize(config.Governance, ProcessJson.Options));
        }

        foreach (var confirmation in config.AuditBevestigingen ?? [])
        {
            builder.Add(
                $"iso:confirmation:{confirmation.KaderId}:{confirmation.ControleId}",
                "audit-confirmation",
                null,
                confirmation.ControleId,
                $"Menselijke bevestiging {confirmation.KaderId}/{confirmation.ControleId}",
                JsonSerializer.Serialize(new
                {
                    confirmation.KaderId,
                    confirmation.ControleId,
                    confirmation.Uitkomst,
                    confirmation.Toelichting,
                    confirmation.Bewijsreferentie,
                    confirmation.ProcessRevision
                }, ProcessJson.Options));
        }
    }

    private sealed class SourceBuilder(ProcessDocument process)
    {
        private readonly Dictionary<string, ProcessMaintenanceSource> _public =
            new(StringComparer.Ordinal);
        private readonly List<ProcessMaintenanceModelSource> _model = [];

        public IReadOnlyDictionary<string, ProcessMaintenanceSource> PublicSources => _public;
        public IReadOnlyList<ProcessMaintenanceModelSource> ModelSources => _model;

        public void AddProcess()
        {
            Add(
                $"process:{process.Id}:revision:{process.Revision}",
                "process",
                null,
                null,
                $"Proces {process.Detailproces}, revisie {process.Revision}",
                JsonSerializer.Serialize(new
                {
                    process.Id,
                    process.Hoofdproces,
                    process.Detailproces,
                    process.Versie,
                    process.Status,
                    process.LaatsteWijziging
                }, ProcessJson.Options));
        }

        public void AddStep(Step step)
        {
            Add(
                $"process:{process.Id}:step:{step.Id}",
                "process-step",
                step.Id,
                null,
                $"Stap {step.Nummer}: {step.Activiteit}",
                JsonSerializer.Serialize(step, ProcessJson.Options));

            foreach (var field in ProcessMaintenanceValidator.AllowedTextFields)
            {
                Add(
                    $"process:{process.Id}:step:{step.Id}:field:{field}",
                    "process-field",
                    step.Id,
                    field,
                    $"Stap {step.Nummer}, veld {field}",
                    ProcessMaintenanceValidator.GetTextField(step, field));
            }
        }

        public void Add(
            string id,
            string type,
            string? stepId,
            string? field,
            string label,
            string? content)
        {
            var value = content ?? "null";
            var source = new ProcessMaintenanceSource(
                id,
                type,
                process.Id,
                process.Revision ?? 0,
                stepId,
                field,
                label,
                ProcessMaintenanceHash.Sha256(value));
            if (!_public.TryAdd(id, source))
            {
                throw new InvalidOperationException($"Dubbele onderhoudsbron '{id}'.");
            }

            _model.Add(new ProcessMaintenanceModelSource(id, type, stepId, field, value));
        }
    }
}

internal static class ProcessMaintenanceHash
{
    public static string Sha256(string value) =>
        $"sha256:{Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant()}";
}
