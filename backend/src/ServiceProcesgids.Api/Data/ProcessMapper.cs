using System.Text.Json;
using ServiceProcesgids.Api.Contract;
using ServiceProcesgids.Api.Data.Entities;

namespace ServiceProcesgids.Api.Data;

public static class ProcessMapper
{
    public static ProcessEntity ToEntity(ProcessDocument document, int revision)
    {
        var normalized = document with { Revision = revision };
        var koppelingen = GetKoppelingen(normalized).ToArray();

        return new ProcessEntity
        {
            Id = normalized.Id,
            Hoofdproces = normalized.Hoofdproces,
            Detailproces = normalized.Detailproces,
            Versie = normalized.Versie,
            Status = normalized.Status,
            LaatsteWijziging = normalized.LaatsteWijziging,
            Revision = revision,
            AantalStappen = normalized.Stappen.Count,
            KoppelingenJson = JsonSerializer.Serialize(koppelingen, ProcessJson.Options),
            DocumentJson = JsonSerializer.Serialize(normalized, ProcessJson.Options)
        };
    }

    public static void UpdateEntity(ProcessEntity entity, ProcessDocument document, int revision)
    {
        var next = ToEntity(document, revision);
        entity.Hoofdproces = next.Hoofdproces;
        entity.Detailproces = next.Detailproces;
        entity.Versie = next.Versie;
        entity.Status = next.Status;
        entity.LaatsteWijziging = next.LaatsteWijziging;
        entity.Revision = next.Revision;
        entity.AantalStappen = next.AantalStappen;
        entity.KoppelingenJson = next.KoppelingenJson;
        entity.DocumentJson = next.DocumentJson;
    }

    public static ProcessDocument ToDocument(ProcessEntity entity)
    {
        var document = JsonSerializer.Deserialize<ProcessDocument>(entity.DocumentJson, ProcessJson.Options);
        if (document is null)
        {
            throw new InvalidOperationException($"Proces '{entity.Id}' bevat ongeldige JSON.");
        }

        return document with { Revision = entity.Revision };
    }

    public static ProcessSummary ToSummary(ProcessEntity entity)
    {
        var koppelingen = JsonSerializer.Deserialize<string[]>(entity.KoppelingenJson, ProcessJson.Options) ?? [];
        return new ProcessSummary(
            entity.Id,
            entity.Hoofdproces,
            entity.Detailproces,
            entity.Versie,
            entity.Status,
            entity.LaatsteWijziging,
            entity.Revision,
            entity.AantalStappen,
            koppelingen);
    }

    public static ProcessSummary ToSummary(ProcessDocument document)
    {
        return new ProcessSummary(
            document.Id,
            document.Hoofdproces,
            document.Detailproces,
            document.Versie,
            document.Status,
            document.LaatsteWijziging,
            document.Revision,
            document.Stappen.Count,
            GetKoppelingen(document).ToArray());
    }

    public static IEnumerable<string> GetKoppelingen(ProcessDocument document)
    {
        return document.Stappen
            .SelectMany(step =>
            {
                var routes = step.Routes?.Select(route => route.NaarProces).Where(IsFilled) ?? [];
                var direct = IsFilled(step.NaarProces) ? [step.NaarProces] : Array.Empty<string?>();
                return direct.Concat(routes);
            })
            .Where(IsFilled)
            .Select(value => value!)
            .Distinct(StringComparer.OrdinalIgnoreCase);
    }

    private static bool IsFilled(string? value) => !string.IsNullOrWhiteSpace(value);
}
