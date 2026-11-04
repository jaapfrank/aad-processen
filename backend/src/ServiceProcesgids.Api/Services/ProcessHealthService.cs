using ServiceProcesgids.Api.Contract;
using ServiceProcesgids.Api.Data;

namespace ServiceProcesgids.Api.Services;

public sealed class ProcessHealthService
{
    public HealthReport CreateReport(ProcessDocument process, IReadOnlySet<string> knownProcessIds)
    {
        var issues = new List<HealthIssue>();
        var laneIds = process.Lanes.Select(lane => lane.Id).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var stepIds = process.Stappen.Select(step => step.Id).ToHashSet(StringComparer.OrdinalIgnoreCase);

        foreach (var step in process.Stappen)
        {
            if (!laneIds.Contains(step.LaneId))
            {
                issues.Add(new HealthIssue(
                    step.Id,
                    "geen-verantwoordelijke",
                    "fout",
                    $"Stap {step.Nummer} verwijst naar onbekende lane '{step.LaneId}'."));
            }

            if (step.Type.Equals("bericht", StringComparison.OrdinalIgnoreCase) &&
                !string.IsNullOrWhiteSpace(step.DoelLaneId) &&
                !laneIds.Contains(step.DoelLaneId))
            {
                issues.Add(new HealthIssue(
                    step.Id,
                    "geen-verantwoordelijke",
                    "fout",
                    $"Berichtstap {step.Nummer} verwijst naar onbekende doel-lane '{step.DoelLaneId}'."));
            }

            if (!string.IsNullOrWhiteSpace(step.InteractieDoelLaneId) &&
                (!laneIds.Contains(step.InteractieDoelLaneId) ||
                 step.InteractieDoelLaneId.Equals(step.LaneId, StringComparison.OrdinalIgnoreCase)))
            {
                issues.Add(new HealthIssue(
                    step.Id,
                    "ongeldige-interactie-lane",
                    "fout",
                    $"Stap {step.Nummer} heeft geen geldige tweede lane voor de horizontale activiteit."));
            }

            var eventIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var systemEvent in step.SysteemGebeurtenissen ?? [])
            {
                if (!eventIds.Add(systemEvent.Id))
                {
                    issues.Add(new HealthIssue(
                        step.Id,
                        "dubbele-systeemgebeurtenis",
                        "fout",
                        $"Stap {step.Nummer} bevat systeemgebeurtenis-id '{systemEvent.Id}' meer dan één keer."));
                }

                if (!laneIds.Contains(systemEvent.LaneId) ||
                    (!string.IsNullOrWhiteSpace(systemEvent.DoelLaneId) &&
                     !laneIds.Contains(systemEvent.DoelLaneId)))
                {
                    issues.Add(new HealthIssue(
                        step.Id,
                        "ongeldige-systeemlane",
                        "fout",
                        $"Systeemgebeurtenis '{systemEvent.Activiteit}' bij stap {step.Nummer} verwijst naar een onbekende lane."));
                }

                if (systemEvent.Type.Equals("synchronisatie", StringComparison.OrdinalIgnoreCase) &&
                    string.IsNullOrWhiteSpace(systemEvent.DoelLaneId))
                {
                    issues.Add(new HealthIssue(
                        step.Id,
                        "synchronisatie-zonder-doel",
                        "fout",
                        $"Synchronisatie '{systemEvent.Activiteit}' bij stap {step.Nummer} heeft geen doel-lane."));
                }
            }

            if (HasMissingNextStep(step, stepIds))
            {
                issues.Add(new HealthIssue(
                    step.Id,
                    "geen-vervolg",
                    "waarschuwing",
                    $"Stap {step.Nummer} heeft geen geldig vervolg binnen het proces."));
            }

            if (step.Type.Equals("beslissing", StringComparison.OrdinalIgnoreCase) &&
                (step.Routes is null || step.Routes.Count == 0))
            {
                issues.Add(new HealthIssue(
                    step.Id,
                    "voorwaarde-zonder-route",
                    "fout",
                    $"Beslissing {step.Nummer} heeft geen routes."));
            }

            if (LooksLikeStatusStep(step) && string.IsNullOrWhiteSpace(step.ErpStatus))
            {
                issues.Add(new HealthIssue(
                    step.Id,
                    "ontbrekende-erp-status",
                    "waarschuwing",
                    $"Stap {step.Nummer} noemt status/ERP maar heeft geen gestructureerde erpStatus."));
            }

            if (!string.IsNullOrWhiteSpace(step.Termijn) && string.IsNullOrWhiteSpace(step.Waarschuwing))
            {
                issues.Add(new HealthIssue(
                    step.Id,
                    "termijn-zonder-waarschuwing",
                    "waarschuwing",
                    $"Stap {step.Nummer} heeft een termijn zonder zichtbare waarschuwing."));
            }

        }

        foreach (var linkedProcess in ProcessMapper.GetKoppelingen(process))
        {
            if (!knownProcessIds.Contains(linkedProcess))
            {
                issues.Add(new HealthIssue(
                    null,
                    "vervolgproces-bestaat-niet",
                    "info",
                    $"Vervolgproces '{linkedProcess}' is nog niet aanwezig in de database."));
            }
        }

        var distinctIssues = issues
            .DistinctBy(issue => $"{issue.StapId}|{issue.Soort}|{issue.Bericht}")
            .ToArray();

        var penalty = distinctIssues.Sum(issue => issue.Ernst switch
        {
            "fout" => 18,
            "waarschuwing" => 9,
            _ => 3
        });

        return new HealthReport(Math.Max(0, 100 - penalty), distinctIssues);
    }

    private static bool HasMissingNextStep(Step step, IReadOnlySet<string> stepIds)
    {
        if (step.Type.Equals("eind", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        if (!string.IsNullOrWhiteSpace(step.NaarStap) && !stepIds.Contains(step.NaarStap))
        {
            return true;
        }

        if (step.Routes is not null)
        {
            return step.Routes.Any(route =>
                !string.IsNullOrWhiteSpace(route.NaarStap) &&
                !stepIds.Contains(route.NaarStap));
        }

        return string.IsNullOrWhiteSpace(step.NaarStap) && string.IsNullOrWhiteSpace(step.NaarProces);
    }

    private static bool LooksLikeStatusStep(Step step)
    {
        if (!step.Type.Equals("actie", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var text = $"{step.Activiteit} {step.Opmerking} {step.Zijnotitie}";
        return text.Contains("ERP", StringComparison.OrdinalIgnoreCase) ||
            text.Contains("status", StringComparison.OrdinalIgnoreCase);
    }
}
