using System.Text.RegularExpressions;
using ServiceProcesgids.Api.Contract;

namespace ServiceProcesgids.Api.Services;

public sealed partial class ProcessMaintenanceValidator
{
    public static readonly IReadOnlyList<string> AllowedTextFields =
    [
        "activiteit",
        "toelichting",
        "opmerking",
        "zijnotitie",
        "voorwaarde",
        "erpStatus",
        "termijn",
        "waarschuwing"
    ];

    private static readonly HashSet<string> TriggerKinds =
        new(["handmatig", "health", "kader", "suggestie"], StringComparer.Ordinal);

    private static readonly HashSet<string> Statuses =
        new(["vragen", "voorstel", "geen-wijziging"], StringComparer.Ordinal);

    private static readonly HashSet<string> Categories =
        new(
        [
            "onduidelijkheid",
            "verantwoordelijkheid",
            "proceslogica",
            "beheersing",
            "bewijs",
            "systeem",
            "termijn",
            "consistentie"
        ],
        StringComparer.Ordinal);

    private static readonly HashSet<string> Severities =
        new(["info", "waarschuwing", "fout"], StringComparer.Ordinal);

    private static readonly string[] ForbiddenFormalClaims =
    [
        "volledig compliant",
        "is compliant",
        "is gecertificeerd",
        "audit-ready",
        "voldoet volledig aan"
    ];

    public ProcessMaintenanceAnalysisRequest NormalizeRequest(
        ProcessMaintenanceAnalysisRequest request)
    {
        if (request.ExpectedRevision <= 0)
        {
            throw InvalidRequest(
                "ai-maintenance-revision-required",
                "De actuele procesrevisie is verplicht.");
        }

        var goal = NormalizeOptional(request.Doel, 1_000, "doel");
        var stepIds = (request.StapIds ?? [])
            .Select(id => id?.Trim() ?? "")
            .Where(id => id.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
        if (stepIds.Length > 50)
        {
            throw InvalidRequest(
                "ai-maintenance-scope-too-large",
                "Selecteer maximaal 50 afzonderlijke stappen.");
        }

        foreach (var stepId in stepIds)
        {
            ValidateIdentifier(stepId, "stap-id");
        }

        var answers = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var (questionId, answer) in
                 request.Antwoorden ?? new Dictionary<string, string>())
        {
            var normalizedQuestionId = questionId?.Trim() ?? "";
            ValidateIdentifier(normalizedQuestionId, "vraag-id");
            var normalizedAnswer = NormalizeOptional(answer, 2_000, "antwoord");
            if (normalizedAnswer is null)
            {
                throw InvalidRequest(
                    "ai-maintenance-answer-required",
                    "Een antwoord op een verduidelijkingsvraag mag niet leeg zijn.");
            }

            if (!answers.TryAdd(normalizedQuestionId, normalizedAnswer))
            {
                throw InvalidRequest(
                    "ai-maintenance-answer-duplicate",
                    $"Vraag '{normalizedQuestionId}' is meer dan eenmaal beantwoord.");
            }
        }

        if (answers.Count > 5)
        {
            throw InvalidRequest(
                "ai-maintenance-too-many-answers",
                "Beantwoord maximaal vijf verduidelijkingsvragen per analyse.");
        }

        var trigger = NormalizeTrigger(request.Aanleiding);
        return new ProcessMaintenanceAnalysisRequest(
            request.ExpectedRevision,
            goal,
            stepIds,
            trigger,
            answers);
    }

    internal IReadOnlySet<string> ValidateScope(
        ProcessMaintenanceAnalysisRequest request,
        ProcessDocument process)
    {
        var known = process.Stappen
            .Select(step => step.Id)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (request.StapIds is null || request.StapIds.Count == 0)
        {
            return known;
        }

        var unknown = request.StapIds.Where(id => !known.Contains(id)).ToArray();
        if (unknown.Length > 0)
        {
            throw InvalidRequest(
                "ai-maintenance-step-not-found",
                $"Onbekende processtap(pen): {string.Join(", ", unknown)}.");
        }

        return request.StapIds.ToHashSet(StringComparer.OrdinalIgnoreCase);
    }

    internal void ValidateOutput(
        ProcessMaintenanceModelOutput output,
        ProcessMaintenanceContext context)
    {
        if (!ProcessMaintenanceService.SchemaVersion.Equals(
                output.SchemaVersion,
                StringComparison.Ordinal))
        {
            throw InvalidOutput("De AI-uitvoer gebruikt een onbekende schemaversie.");
        }

        if (!Statuses.Contains(output.Status))
        {
            throw InvalidOutput("De AI-uitvoer bevat een onbekende status.");
        }

        ValidateText(output.Samenvatting, 1, 1_200, "samenvatting");
        ValidateFormalClaims(output.Samenvatting);
        ValidateSourceIds(output.BronIds, null, context, "samenvatting");

        if (output.Vragen is null || output.Issues is null || output.Wijzigingen is null)
        {
            throw InvalidOutput("De AI-uitvoer bevat niet alle verplichte lijsten.");
        }

        if (output.Vragen.Count > 5 ||
            output.Issues.Count > 20 ||
            output.Wijzigingen.Count > 20)
        {
            throw InvalidOutput("De AI-uitvoer overschrijdt de toegestane aantallen.");
        }

        var ids = new HashSet<string>(StringComparer.Ordinal);
        var changeTargets = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var question in output.Vragen)
        {
            ValidateResultId(question.Id, ids);
            ValidateText(question.Vraag, 1, 500, "vraag");
            ValidateText(question.Waarom, 1, 800, "waarom");
            ValidateFormalClaims(question.Vraag);
            ValidateFormalClaims(question.Waarom);
            ValidateStepId(question.StapId, context, required: false);
            ValidateSourceIds(question.BronIds, question.StapId, context, "vraag");
        }

        foreach (var issue in output.Issues)
        {
            ValidateResultId(issue.Id, ids);
            ValidateStepId(issue.StapId, context, required: false);
            if (!Categories.Contains(issue.Categorie) || !Severities.Contains(issue.Ernst))
            {
                throw InvalidOutput("Een issue bevat een onbekende categorie of ernst.");
            }

            ValidateText(issue.Titel, 1, 160, "issuetitel");
            ValidateText(issue.Bevinding, 1, 1_200, "bevinding");
            ValidateText(issue.Uitleg, 1, 1_600, "uitleg");
            ValidateFormalClaims(issue.Titel);
            ValidateFormalClaims(issue.Bevinding);
            ValidateFormalClaims(issue.Uitleg);
            ValidateSourceIds(issue.BronIds, issue.StapId, context, "issue");
        }

        foreach (var change in output.Wijzigingen)
        {
            ValidateResultId(change.Id, ids);
            ValidateStepId(change.StapId, context, required: true);
            if (!AllowedTextFields.Contains(change.Veld, StringComparer.Ordinal))
            {
                throw InvalidOutput($"Veld '{change.Veld}' mag niet door AI worden voorgesteld.");
            }

            if (!changeTargets.Add($"{change.StapId}\u001f{change.Veld}"))
            {
                throw InvalidOutput(
                    $"Stap '{change.StapId}' en veld '{change.Veld}' worden meer dan eenmaal gewijzigd.");
            }

            var step = context.Process.Stappen.Single(item =>
                item.Id.Equals(change.StapId, StringComparison.OrdinalIgnoreCase));
            var currentValue = GetTextField(step, change.Veld);
            if (!string.Equals(currentValue, change.OudeWaarde, StringComparison.Ordinal))
            {
                throw InvalidOutput(
                    $"De oude waarde voor stap '{change.StapId}' en veld '{change.Veld}' komt niet overeen.");
            }

            if (change.NieuweWaarde is not null)
            {
                ValidateText(change.NieuweWaarde, 1, 2_000, "nieuwe waarde");
                ValidateFormalClaims(change.NieuweWaarde);
            }

            if (change.Veld == "activiteit" && string.IsNullOrWhiteSpace(change.NieuweWaarde))
            {
                throw InvalidOutput("Een activiteit mag niet worden leeggemaakt.");
            }

            if (string.Equals(change.OudeWaarde, change.NieuweWaarde, StringComparison.Ordinal))
            {
                throw InvalidOutput("Een voorgestelde wijziging verandert de waarde niet.");
            }

            ValidateText(change.Reden, 1, 1_200, "reden");
            ValidateFormalClaims(change.Reden);
            if (!change.BevestigingVereist)
            {
                throw InvalidOutput("Iedere AI-wijziging moet menselijke bevestiging vereisen.");
            }

            ValidateSourceIds(change.BronIds, change.StapId, context, "wijziging");
        }

        switch (output.Status)
        {
            case "vragen" when output.Vragen.Count == 0 || output.Wijzigingen.Count > 0:
                throw InvalidOutput(
                    "Status 'vragen' vereist vragen en mag geen wijzigingen bevatten.");
            case "voorstel" when output.Vragen.Count > 0 ||
                                 (output.Issues.Count == 0 && output.Wijzigingen.Count == 0):
                throw InvalidOutput(
                    "Status 'voorstel' mag geen open vragen bevatten en vereist een issue of wijziging.");
            case "geen-wijziging" when output.Vragen.Count > 0 ||
                                       output.Issues.Count > 0 ||
                                       output.Wijzigingen.Count > 0:
                throw InvalidOutput(
                    "Status 'geen-wijziging' mag geen vragen, issues of wijzigingen bevatten.");
        }
    }

    public static string? GetTextField(Step step, string field) => field switch
    {
        "activiteit" => step.Activiteit,
        "toelichting" => step.Toelichting,
        "opmerking" => step.Opmerking,
        "zijnotitie" => step.Zijnotitie,
        "voorwaarde" => step.Voorwaarde,
        "erpStatus" => step.ErpStatus,
        "termijn" => step.Termijn,
        "waarschuwing" => step.Waarschuwing,
        _ => throw new ArgumentOutOfRangeException(nameof(field), field, "Geen toegestaan tekstveld.")
    };

    private static ProcessMaintenanceTrigger? NormalizeTrigger(ProcessMaintenanceTrigger? trigger)
    {
        if (trigger is null)
        {
            return null;
        }

        var kind = trigger.Soort?.Trim().ToLowerInvariant() ?? "";
        if (!TriggerKinds.Contains(kind))
        {
            throw InvalidRequest(
                "ai-maintenance-trigger-invalid",
                "De aanleiding moet handmatig, health, kader of suggestie zijn.");
        }

        var referenceId = NormalizeOptional(trigger.ReferentieId, 160, "referentie-id");
        var frameworkId = NormalizeOptional(trigger.KaderId, 80, "kader-id")?.ToLowerInvariant();
        var title = NormalizeOptional(trigger.Titel, 200, "titel");
        var description = NormalizeOptional(trigger.Beschrijving, 2_000, "beschrijving");
        if (kind == "kader" && (frameworkId is null || referenceId is null))
        {
            throw InvalidRequest(
                "ai-maintenance-framework-trigger-incomplete",
                "Een kaderaanleiding vereist kader-id en controle-id.");
        }

        return new ProcessMaintenanceTrigger(
            kind,
            referenceId,
            frameworkId,
            title,
            description);
    }

    private static void ValidateSourceIds(
        IReadOnlyList<string>? sourceIds,
        string? relatedStepId,
        ProcessMaintenanceContext context,
        string field)
    {
        if (sourceIds is null || sourceIds.Count == 0 || sourceIds.Count > 10)
        {
            throw InvalidOutput($"{field} vereist één tot tien geldige bronverwijzingen.");
        }

        var unique = new HashSet<string>(StringComparer.Ordinal);
        var hasRelatedStepSource = relatedStepId is null;
        foreach (var sourceId in sourceIds)
        {
            if (string.IsNullOrWhiteSpace(sourceId) ||
                !unique.Add(sourceId) ||
                !context.Sources.TryGetValue(sourceId, out var source))
            {
                throw InvalidOutput($"{field} verwijst naar een onbekende of dubbele bron.");
            }

            if (relatedStepId is not null &&
                source.StapId?.Equals(relatedStepId, StringComparison.OrdinalIgnoreCase) == true)
            {
                hasRelatedStepSource = true;
            }
        }

        if (!hasRelatedStepSource)
        {
            throw InvalidOutput($"{field} mist een bron van de gekoppelde processtap.");
        }
    }

    private static void ValidateStepId(
        string? stepId,
        ProcessMaintenanceContext context,
        bool required)
    {
        if (string.IsNullOrWhiteSpace(stepId))
        {
            if (required)
            {
                throw InvalidOutput("Een wijziging vereist een stap-id.");
            }

            return;
        }

        if (!context.ScopedStepIds.Contains(stepId))
        {
            throw InvalidOutput($"Stap '{stepId}' valt buiten de geselecteerde context.");
        }
    }

    private static void ValidateResultId(string id, ISet<string> known)
    {
        if (string.IsNullOrWhiteSpace(id) ||
            id.Length > 160 ||
            !IdentifierPattern().IsMatch(id))
        {
            throw InvalidOutput("De AI-uitvoer bevat een ongeldig resultaat-id.");
        }

        if (!known.Add(id))
        {
            throw InvalidOutput($"Dubbel resultaat-id '{id}'.");
        }
    }

    private static void ValidateIdentifier(string value, string field)
    {
        if (string.IsNullOrWhiteSpace(value) ||
            value.Length > 160 ||
            !IdentifierPattern().IsMatch(value))
        {
            throw InvalidRequest(
                "ai-maintenance-identifier-invalid",
                $"{field} bevat geen geldige identifier.");
        }
    }

    private static string? NormalizeOptional(string? value, int maxLength, string field)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var normalized = value.Trim();
        if (normalized.Length > maxLength)
        {
            throw InvalidRequest(
                "ai-maintenance-input-too-long",
                $"{field} mag maximaal {maxLength} tekens bevatten.");
        }

        return normalized;
    }

    private static void ValidateText(string? value, int min, int max, string field)
    {
        if (value is null || value.Trim().Length < min || value.Length > max)
        {
            throw InvalidOutput(
                $"{field} moet tussen {min} en {max} tekens bevatten.");
        }
    }

    private static void ValidateFormalClaims(string value)
    {
        if (ForbiddenFormalClaims.Any(claim =>
                value.Contains(claim, StringComparison.OrdinalIgnoreCase)))
        {
            throw InvalidOutput(
                "De AI-uitvoer bevat een verboden formele compliance- of certificeringsclaim.");
        }
    }

    private static ProcessMaintenanceException InvalidRequest(string code, string message) =>
        new(code, message, StatusCodes.Status400BadRequest);

    private static ProcessMaintenanceException InvalidOutput(string message) =>
        new(
            "ai-output-invalid",
            $"De AI-provider leverde geen veilig bruikbaar onderhoudsvoorstel. {message}",
            StatusCodes.Status502BadGateway);

    [GeneratedRegex("^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$", RegexOptions.CultureInvariant)]
    private static partial Regex IdentifierPattern();
}
