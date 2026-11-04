using System.Text.Json;
using ServiceProcesgids.Api.Contract;

namespace ServiceProcesgids.Api.Services;

public sealed class ProcessDiffService
{
    public DiffReport CreateReport(ProcessDocument from, ProcessDocument to, int fromVersion, int toVersion)
    {
        var changes = new List<DiffChange>();

        AddIfChanged(changes, null, "hoofdproces", from.Hoofdproces, to.Hoofdproces);
        AddIfChanged(changes, null, "detailproces", from.Detailproces, to.Detailproces);
        AddIfChanged(changes, null, "versie", from.Versie, to.Versie);
        AddIfChanged(changes, null, "status", from.Status, to.Status);
        AddIfChanged(changes, null, "laatsteWijziging", from.LaatsteWijziging, to.LaatsteWijziging);
        AddIfChanged(changes, null, "lanes", from.Lanes, to.Lanes);
        AddIfChanged(changes, null, "secties", from.Secties, to.Secties);
        AddIfChanged(changes, null, "diagramLayout", from.DiagramLayout, to.DiagramLayout);

        var fromSteps = from.Stappen.ToDictionary(step => step.Id, StringComparer.OrdinalIgnoreCase);
        var toSteps = to.Stappen.ToDictionary(step => step.Id, StringComparer.OrdinalIgnoreCase);

        foreach (var (stepId, oldStep) in fromSteps.OrderBy(pair => pair.Value.Nummer))
        {
            if (!toSteps.TryGetValue(stepId, out var newStep))
            {
                changes.Add(new DiffChange(stepId, "verwijderd", null, oldStep, null));
                continue;
            }

            AddStepChanges(changes, oldStep, newStep);
        }

        foreach (var (stepId, newStep) in toSteps.OrderBy(pair => pair.Value.Nummer))
        {
            if (!fromSteps.ContainsKey(stepId))
            {
                changes.Add(new DiffChange(stepId, "toegevoegd", null, null, newStep));
            }
        }

        return new DiffReport(to.Id, fromVersion, toVersion, changes);
    }

    private static void AddStepChanges(List<DiffChange> changes, Step from, Step to)
    {
        AddIfChanged(changes, to.Id, "nummer", from.Nummer, to.Nummer);
        AddIfChanged(changes, to.Id, "laneId", from.LaneId, to.LaneId);
        AddIfChanged(changes, to.Id, "type", from.Type, to.Type);
        AddIfChanged(changes, to.Id, "activiteit", from.Activiteit, to.Activiteit);
        AddIfChanged(changes, to.Id, "sectieId", from.SectieId, to.SectieId);
        AddIfChanged(changes, to.Id, "toelichting", from.Toelichting, to.Toelichting);
        AddIfChanged(changes, to.Id, "opmerking", from.Opmerking, to.Opmerking);
        AddIfChanged(changes, to.Id, "zijnotitie", from.Zijnotitie, to.Zijnotitie);
        AddIfChanged(changes, to.Id, "doelLaneId", from.DoelLaneId, to.DoelLaneId);
        AddIfChanged(changes, to.Id, "voorwaarde", from.Voorwaarde, to.Voorwaarde);
        AddIfChanged(changes, to.Id, "erpStatus", from.ErpStatus, to.ErpStatus);
        AddIfChanged(changes, to.Id, "termijn", from.Termijn, to.Termijn);
        AddIfChanged(changes, to.Id, "waarschuwing", from.Waarschuwing, to.Waarschuwing);
        AddIfChanged(changes, to.Id, "checklist", from.Checklist, to.Checklist);
        AddIfChanged(changes, to.Id, "fotoEisen", from.FotoEisen, to.FotoEisen);
        AddIfChanged(changes, to.Id, "naarStap", from.NaarStap, to.NaarStap);
        AddIfChanged(changes, to.Id, "routes", from.Routes, to.Routes);
        AddIfChanged(changes, to.Id, "naarProces", from.NaarProces, to.NaarProces);
        AddIfChanged(changes, to.Id, "bronZekerheid", from.BronZekerheid, to.BronZekerheid);
        AddIfChanged(
            changes,
            to.Id,
            "systeemGebeurtenissen",
            from.SysteemGebeurtenissen,
            to.SysteemGebeurtenissen);
        AddIfChanged(
            changes,
            to.Id,
            "interactieDoelLaneId",
            from.InteractieDoelLaneId,
            to.InteractieDoelLaneId);
    }

    private static void AddIfChanged<T>(List<DiffChange> changes, string? stepId, string field, T oldValue, T newValue)
    {
        var oldJson = JsonSerializer.Serialize(oldValue, ProcessJson.Options);
        var newJson = JsonSerializer.Serialize(newValue, ProcessJson.Options);

        if (oldJson.Equals(newJson, StringComparison.Ordinal))
        {
            return;
        }

        changes.Add(new DiffChange(stepId, "gewijzigd", field, oldValue, newValue));
    }
}
