using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ServiceProcesgids.Api.Contract;
using ServiceProcesgids.Api.Data;
using ServiceProcesgids.Api.Data.Entities;

namespace ServiceProcesgids.Api.Services;

public sealed class ProcessVersionService(AppDbContext dbContext)
{
    public async Task<VersionDocument> CreateSnapshotAsync(
        ProcessEntity process,
        string changedBy,
        string? comment,
        IEnumerable<string>? processedSuggestionIds = null,
        CancellationToken cancellationToken = default)
    {
        var nextVersion = await GetNextVersionNrAsync(process.Id, cancellationToken);
        var processedSuggestions = NormalizeIds(processedSuggestionIds);

        var entity = new ProcessVersionEntity
        {
            ProcessId = process.Id,
            VersionNr = nextVersion,
            Status = process.Status,
            ChangedBy = changedBy,
            ChangedAtUtc = DateTimeOffset.UtcNow,
            Comment = string.IsNullOrWhiteSpace(comment) ? null : comment.Trim(),
            ProcessJson = process.DocumentJson,
            ProcessRevision = process.Revision,
            ProcessVersion = process.Versie,
            ProcessedSuggestionsJson = JsonSerializer.Serialize(processedSuggestions, ProcessJson.Options)
        };

        dbContext.ProcessVersions.Add(entity);
        await dbContext.SaveChangesAsync(cancellationToken);

        return ToDocument(entity);
    }

    public async Task EnsureInitialSnapshotAsync(
        ProcessEntity process,
        string changedBy,
        CancellationToken cancellationToken = default)
    {
        var exists = await dbContext.ProcessVersions.AnyAsync(
            version => version.ProcessId == process.Id,
            cancellationToken);

        if (exists)
        {
            return;
        }

        await CreateSnapshotAsync(process, changedBy, "Initiële versie", null, cancellationToken);
    }

    public async Task<IReadOnlyList<VersionDocument>> GetVersionsAsync(
        string processId,
        CancellationToken cancellationToken = default)
    {
        var versions = await dbContext.ProcessVersions
            .AsNoTracking()
            .Where(version => version.ProcessId == processId)
            .OrderBy(version => version.VersionNr)
            .ToListAsync(cancellationToken);

        return versions.Select(ToDocument).ToList();
    }

    public async Task<ProcessVersionEntity?> GetVersionEntityAsync(
        string processId,
        int versionNr,
        CancellationToken cancellationToken = default)
    {
        return await dbContext.ProcessVersions
            .AsNoTracking()
            .FirstOrDefaultAsync(
                version => version.ProcessId == processId && version.VersionNr == versionNr,
                cancellationToken);
    }

    public ProcessDocument ToProcessDocument(ProcessVersionEntity version)
    {
        var document = JsonSerializer.Deserialize<ProcessDocument>(version.ProcessJson, ProcessJson.Options);
        if (document is null)
        {
            throw new InvalidOperationException($"Versie {version.VersionNr} van proces '{version.ProcessId}' bevat ongeldige JSON.");
        }

        return document with { Revision = version.ProcessRevision };
    }

    public static VersionDocument ToDocument(ProcessVersionEntity entity)
    {
        var processedSuggestions = JsonSerializer.Deserialize<string[]>(
            entity.ProcessedSuggestionsJson,
            ProcessJson.Options) ?? [];

        return new VersionDocument(
            entity.VersionNr,
            entity.ProcessId,
            entity.Status,
            entity.ChangedBy,
            entity.ChangedAtUtc.ToString("O"),
            entity.Comment,
            processedSuggestions);
    }

    private async Task<int> GetNextVersionNrAsync(string processId, CancellationToken cancellationToken)
    {
        var currentMax = await dbContext.ProcessVersions
            .Where(version => version.ProcessId == processId)
            .Select(version => (int?)version.VersionNr)
            .MaxAsync(cancellationToken);

        return (currentMax ?? 0) + 1;
    }

    private static string[] NormalizeIds(IEnumerable<string>? ids)
    {
        return ids?
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .Select(id => id.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray() ?? [];
    }
}
