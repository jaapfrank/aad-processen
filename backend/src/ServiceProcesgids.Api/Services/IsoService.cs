using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ServiceProcesgids.Api.Contract;
using ServiceProcesgids.Api.Data;
using ServiceProcesgids.Api.Data.Entities;

namespace ServiceProcesgids.Api.Services;

public sealed class IsoService(AppDbContext dbContext)
{
    private static readonly string[] Norms = ["iso27001", "iso9001", "iso14001"];
    private static readonly string[] Roles = ["kern", "ondersteunend"];

    public async Task<IsoProcessConfig> GetConfigAsync(
        string processId,
        CancellationToken cancellationToken = default)
    {
        var entity = await dbContext.IsoProcessConfigs
            .AsNoTracking()
            .FirstOrDefaultAsync(config => config.ProcessId == processId, cancellationToken);

        return entity is null
            ? new IsoProcessConfig(processId, [], null, [])
            : DeserializeConfig(entity.ConfigJson, processId);
    }

    public async Task<IsoProcessConfig> SaveConfigAsync(
        IsoProcessConfig config,
        string updatedBy,
        CancellationToken cancellationToken = default)
    {
        var entity = await dbContext.IsoProcessConfigs.FirstOrDefaultAsync(
            existing => existing.ProcessId == config.ProcesId,
            cancellationToken);
        var existingConfirmations = entity is null
            ? []
            : DeserializeConfig(entity.ConfigJson, entity.ProcessId).AuditBevestigingen ?? [];
        // Het generieke ISO-formulier mag server-gestempelde bevestigingen
        // nooit overschrijven of voorzien van zelfgekozen actor/tijd.
        var normalized = Normalize(config with { AuditBevestigingen = existingConfirmations });
        await PersistAsync(normalized, updatedBy, entity, cancellationToken);
        return normalized;
    }

    public async Task<AuditBevestiging> SaveAuditConfirmationAsync(
        string processId,
        AuditBevestiging confirmation,
        string updatedBy,
        CancellationToken cancellationToken = default)
    {
        var entity = await dbContext.IsoProcessConfigs.FirstOrDefaultAsync(
            existing => existing.ProcessId == processId,
            cancellationToken);
        var current = entity is null
            ? new IsoProcessConfig(processId, [], null, [])
            : DeserializeConfig(entity.ConfigJson, processId);
        var confirmations = (current.AuditBevestigingen ?? [])
            .Where(item =>
                !item.KaderId.Equals(confirmation.KaderId, StringComparison.OrdinalIgnoreCase) ||
                !item.ControleId.Equals(confirmation.ControleId, StringComparison.OrdinalIgnoreCase))
            .Append(confirmation)
            .OrderBy(item => item.KaderId, StringComparer.OrdinalIgnoreCase)
            .ThenBy(item => item.ControleId, StringComparer.OrdinalIgnoreCase)
            .ToList();
        var updated = Normalize(current with { AuditBevestigingen = confirmations });

        await PersistAsync(updated, updatedBy, entity, cancellationToken);
        return confirmation;
    }

    public async Task<IsoOverview> CreateOverviewAsync(
        string? norm,
        CancellationToken cancellationToken = default)
    {
        var normalizedNorm = NormalizeNorm(norm);
        var processes = await dbContext.Processes.AsNoTracking().ToListAsync(cancellationToken);
        var configs = await dbContext.IsoProcessConfigs.AsNoTracking().ToListAsync(cancellationToken);
        var configByProcessId = configs.ToDictionary(
            config => config.ProcessId,
            config => DeserializeConfig(config.ConfigJson, config.ProcessId),
            StringComparer.OrdinalIgnoreCase);

        var rows = new List<IsoMatrixRow>();
        var signals = new List<BorgingIssue>();

        foreach (var process in processes.OrderBy(process => process.Hoofdproces).ThenBy(process => process.Detailproces))
        {
            var config = configByProcessId.TryGetValue(process.Id, out var value)
                ? value
                : new IsoProcessConfig(process.Id, [], null, []);

            var mappings = config.Mappings
                .Where(mapping => normalizedNorm is null || mapping.Norm.Equals(normalizedNorm, StringComparison.OrdinalIgnoreCase))
                .ToList();

            foreach (var mapping in mappings)
            {
                var rowSignals = CreateSignals(process, mapping, config.Governance);
                signals.AddRange(rowSignals);

                rows.Add(new IsoMatrixRow(
                    process.Id,
                    process.Hoofdproces,
                    process.Detailproces,
                    mapping.Norm,
                    mapping.Rol,
                    mapping.Clausules ?? [],
                    config.Governance?.Eigenaar,
                    process.Status,
                    config.Governance?.LaatsteReview,
                    config.Governance?.VolgendeReview,
                    rowSignals));
            }
        }

        return new IsoOverview(
            normalizedNorm,
            rows.Select(row => row.Hoofdproces).Distinct(StringComparer.OrdinalIgnoreCase).Order().ToList(),
            rows,
            signals,
            DateTimeOffset.UtcNow.ToString("O"));
    }

    public string CreateCsv(IsoOverview overview)
    {
        var builder = new StringBuilder();
        builder.AppendLine("procesId;hoofdproces;detailproces;norm;rol;clausules;eigenaar;status;laatsteReview;volgendeReview;borging");

        foreach (var row in overview.Rijen)
        {
            builder.AppendJoin(
                ';',
                Escape(row.ProcesId),
                Escape(row.Hoofdproces),
                Escape(row.Detailproces),
                Escape(row.Norm),
                Escape(row.Rol),
                Escape(string.Join(",", row.Clausules)),
                Escape(row.Eigenaar),
                Escape(row.Status),
                Escape(row.LaatsteReview),
                Escape(row.VolgendeReview),
                Escape(string.Join(" | ", row.Borging.Select(issue => $"{issue.Signaal}: {issue.Bericht}"))));
            builder.AppendLine();
        }

        return builder.ToString();
    }

    public static bool IsValidNorm(string? norm) => NormalizeNorm(norm) is not null;

    private static IsoProcessConfig DeserializeConfig(string json, string processId)
    {
        var config = JsonSerializer.Deserialize<IsoProcessConfig>(json, ProcessJson.Options);
        return config is null ? new IsoProcessConfig(processId, [], null, []) : Normalize(config);
    }

    private static IsoProcessConfig Normalize(IsoProcessConfig config)
    {
        var mappings = (config.Mappings ?? [])
            .Where(mapping => NormalizeNorm(mapping.Norm) is not null)
            .Select(mapping => mapping with
            {
                Norm = NormalizeNorm(mapping.Norm)!,
                Rol = Roles.Contains(mapping.Rol, StringComparer.OrdinalIgnoreCase) ? mapping.Rol.ToLowerInvariant() : "ondersteunend",
                Clausules = mapping.Clausules?
                    .Where(clausule => !string.IsNullOrWhiteSpace(clausule))
                    .Select(clausule => clausule.Trim())
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToArray()
            })
            .ToList();

        return config with
        {
            ProcesId = config.ProcesId?.Trim() ?? "",
            Mappings = mappings,
            AuditBevestigingen = (config.AuditBevestigingen ?? [])
                .Where(item =>
                    Guid.TryParseExact(item.AssessmentId, "N", out _) &&
                    !string.IsNullOrWhiteSpace(item.CatalogVersion) &&
                    AuditAssessmentService.IsValidFramework(item.KaderId) &&
                    !string.IsNullOrWhiteSpace(item.ControleId) &&
                    AuditAssessmentService.IsValidOutcome(item.Uitkomst) &&
                    !string.IsNullOrWhiteSpace(item.Toelichting) &&
                    !string.IsNullOrWhiteSpace(item.BevestigdDoorId) &&
                    !string.IsNullOrWhiteSpace(item.BevestigdDoor) &&
                    DateTimeOffset.TryParse(item.BevestigdOp, out _) &&
                    item.ProcessRevision > 0)
                .Select(item => item with
                {
                    AssessmentId = item.AssessmentId.Trim().ToLowerInvariant(),
                    CatalogVersion = item.CatalogVersion.Trim(),
                    KaderId = item.KaderId.Trim().ToLowerInvariant(),
                    ControleId = item.ControleId.Trim().ToLowerInvariant(),
                    Uitkomst = item.Uitkomst.Trim().ToLowerInvariant(),
                    Toelichting = item.Toelichting.Trim(),
                    Bewijsreferentie = string.IsNullOrWhiteSpace(item.Bewijsreferentie)
                        ? null
                        : item.Bewijsreferentie.Trim()
                })
                .ToList()
        };
    }

    private async Task PersistAsync(
        IsoProcessConfig config,
        string updatedBy,
        IsoProcessConfigEntity? entity,
        CancellationToken cancellationToken)
    {
        var json = JsonSerializer.Serialize(config, ProcessJson.Options);
        if (entity is null)
        {
            dbContext.IsoProcessConfigs.Add(new IsoProcessConfigEntity
            {
                ProcessId = config.ProcesId,
                ConfigJson = json,
                UpdatedAtUtc = DateTimeOffset.UtcNow,
                UpdatedBy = updatedBy
            });
        }
        else
        {
            entity.ConfigJson = json;
            entity.UpdatedAtUtc = DateTimeOffset.UtcNow;
            entity.UpdatedBy = updatedBy;
        }

        await dbContext.SaveChangesAsync(cancellationToken);
    }

    private static IReadOnlyList<BorgingIssue> CreateSignals(
        ProcessEntity process,
        IsoMapping mapping,
        ProcessGovernance? governance)
    {
        var signals = new List<BorgingIssue>();

        if (string.IsNullOrWhiteSpace(governance?.Eigenaar))
        {
            signals.Add(new BorgingIssue(
                process.Id,
                mapping.Norm,
                "geen-eigenaar",
                "waarschuwing",
                "Proces heeft geen eigenaar; borging is niet aantoonbaar toegewezen."));
        }

        if (!process.Status.Equals("live", StringComparison.OrdinalIgnoreCase))
        {
            signals.Add(new BorgingIssue(
                process.Id,
                mapping.Norm,
                "geen-live-versie",
                "fout",
                "Proces heeft geen live-versie voor deze ISO-koppeling."));
        }

        if (mapping.Clausules is null || mapping.Clausules.Count == 0)
        {
            signals.Add(new BorgingIssue(
                process.Id,
                mapping.Norm,
                "clausule-niet-gedekt",
                "waarschuwing",
                "ISO-koppeling heeft nog geen clausules/controls."));
        }

        if (DateOnly.TryParse(governance?.VolgendeReview, out var nextReview))
        {
            var vandaag = DateOnly.FromDateTime(DateTime.UtcNow);
            if (nextReview < vandaag)
            {
                signals.Add(new BorgingIssue(
                    process.Id,
                    mapping.Norm,
                    "review-verlopen",
                    "waarschuwing",
                    $"Volgende review ({governance?.VolgendeReview}) is verstreken; herbeoordeling vereist voor borging."));
            }
            else if (nextReview <= vandaag.AddDays(30))
            {
                // Vroege herinnering zodat de eigenaar de herbeoordeling kan plannen.
                signals.Add(new BorgingIssue(
                    process.Id,
                    mapping.Norm,
                    "review-nadert",
                    "info",
                    $"Volgende review nadert ({governance?.VolgendeReview}); plan de herbeoordeling in."));
            }
        }

        return signals;
    }

    private static string? NormalizeNorm(string? norm)
    {
        if (string.IsNullOrWhiteSpace(norm))
        {
            return null;
        }

        var normalized = norm.Trim().ToLowerInvariant();
        return Norms.Contains(normalized, StringComparer.OrdinalIgnoreCase) ? normalized : null;
    }

    private static string Escape(string? value)
    {
        var text = value ?? "";
        return text.Contains(';') || text.Contains('"') || text.Contains('\n')
            ? $"\"{text.Replace("\"", "\"\"")}\""
            : text;
    }
}
