using System.Data;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ServiceProcesgids.Api.Contract;
using ServiceProcesgids.Api.Data;
using ServiceProcesgids.Api.Data.Entities;
using ServiceProcesgids.Api.Models;

namespace ServiceProcesgids.Api.Services;

public sealed class AssuranceSettingsService(
    AppDbContext db,
    AssuranceFrameworkCatalogService catalog,
    AuditLogService audit,
    TimeProvider timeProvider)
{
    public const string TenantId = "single-tenant";
    public const int MaximumIntervalHours = 720;
    public static readonly int[] AllowedIntervalHours = [24, 168, 720];
    private static readonly string[] DefaultFrameworkIds = ["iso9001"];

    public async Task<AssuranceSettingsDocument> GetAsync(
        CancellationToken cancellationToken = default)
    {
        var entity = await EnsureEntityAsync(cancellationToken);
        return ToDocument(entity);
    }

    public async Task<IReadOnlySet<string>> GetActiveFrameworkIdsAsync(
        CancellationToken cancellationToken = default)
    {
        var entity = await EnsureEntityAsync(cancellationToken);
        return DeserializeFrameworkIds(entity.ActiveFrameworkIdsJson)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
    }

    public async Task<AssuranceSettingsDocument> SaveAsync(
        AssuranceSettingsUpdateRequest request,
        User actor,
        CancellationToken cancellationToken = default)
    {
        if (request.ExpectedRevision <= 0)
        {
            throw new AssuranceException(
                "assurance-settings-revision-required",
                "De verwachte instellingenrevisie ontbreekt.",
                StatusCodes.Status409Conflict);
        }

        if (!AllowedIntervalHours.Contains(request.AangevraagdIntervalUren))
        {
            throw new AssuranceException(
                "assurance-interval-invalid",
                "Kies een controle-interval van 24, 168 of 720 uur.");
        }

        var frameworkIds = NormalizeFrameworkIds(request.ActieveKaderIds);
        if (frameworkIds.Count == 0)
        {
            throw new AssuranceException(
                "assurance-framework-required",
                "Selecteer minimaal één kader. Continue controle kan niet worden uitgeschakeld.");
        }

        await using var transaction = await db.Database.BeginTransactionAsync(
            IsolationLevel.Serializable,
            cancellationToken);
        var entity = await EnsureEntityAsync(cancellationToken);
        if (entity.Revision != request.ExpectedRevision)
        {
            throw new AssuranceException(
                "assurance-settings-revision-changed",
                $"De instellingen zijn gewijzigd. Verwacht revisie {request.ExpectedRevision}, actueel is {entity.Revision}.",
                StatusCodes.Status409Conflict);
        }

        var previousIds = DeserializeFrameworkIds(entity.ActiveFrameworkIdsJson);
        var previousInterval = entity.RequestedIntervalHours;
        var frameworksChanged = !previousIds.SequenceEqual(
            frameworkIds,
            StringComparer.OrdinalIgnoreCase);
        var now = timeProvider.GetUtcNow();

        entity.ActiveFrameworkIdsJson = JsonSerializer.Serialize(
            frameworkIds,
            ProcessJson.Options);
        entity.RequestedIntervalHours = request.AangevraagdIntervalUren;
        entity.UpdatedAtUtc = now;
        entity.UpdatedBy = actor.Naam;
        entity.Revision++;
        // Een gewijzigde scope wordt direct opnieuw gecontroleerd. Alleen een
        // intervalwijziging mag een reeds eerdere due-date nooit uitstellen.
        var requestedNext = now.AddHours(request.AangevraagdIntervalUren);
        entity.NextRunAtUtc = frameworksChanged
            ? now
            : entity.NextRunAtUtc <= requestedNext
                ? entity.NextRunAtUtc
                : requestedNext;

        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(
            "assurance.settings.update",
            "assurance-settings",
            TenantId,
            actor,
            new
            {
                vorigeKaderIds = previousIds,
                actieveKaderIds = frameworkIds,
                vorigIntervalUren = previousInterval,
                aangevraagdIntervalUren = request.AangevraagdIntervalUren,
                effectiefIntervalUren = request.AangevraagdIntervalUren,
                maximaalIntervalUren = MaximumIntervalHours,
                monitoringActief = true,
                entity.Revision
            },
            cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return ToDocument(entity);
    }

    public async Task MarkRunCompletedAsync(
        DateTimeOffset completedAt,
        CancellationToken cancellationToken)
    {
        var entity = await EnsureEntityAsync(cancellationToken);
        entity.NextRunAtUtc = completedAt.AddHours(
            EffectiveInterval(entity.RequestedIntervalHours));
        await db.SaveChangesAsync(cancellationToken);
    }

    internal async Task<AssuranceSettingsEntity> GetEntityAsync(
        CancellationToken cancellationToken) =>
        await EnsureEntityAsync(cancellationToken);

    private async Task<AssuranceSettingsEntity> EnsureEntityAsync(
        CancellationToken cancellationToken)
    {
        var entity = await db.AssuranceSettings
            .FirstOrDefaultAsync(
                item => item.TenantId == TenantId,
                cancellationToken);
        if (entity is not null)
        {
            return entity;
        }

        var now = timeProvider.GetUtcNow();
        entity = new AssuranceSettingsEntity
        {
            TenantId = TenantId,
            ActiveFrameworkIdsJson = JsonSerializer.Serialize(
                DefaultFrameworkIds,
                ProcessJson.Options),
            RequestedIntervalHours = MaximumIntervalHours,
            NextRunAtUtc = now,
            UpdatedAtUtc = now,
            UpdatedBy = "Systeem",
            Revision = 1
        };
        db.AssuranceSettings.Add(entity);
        try
        {
            await db.SaveChangesAsync(cancellationToken);
            return entity;
        }
        catch (DbUpdateException)
        {
            db.Entry(entity).State = EntityState.Detached;
            return await db.AssuranceSettings.SingleAsync(
                item => item.TenantId == TenantId,
                cancellationToken);
        }
    }

    private IReadOnlyList<string> NormalizeFrameworkIds(
        IReadOnlyList<string>? frameworkIds)
    {
        var normalized = (frameworkIds ?? [])
            .Where(item => !string.IsNullOrWhiteSpace(item))
            .Select(item => item.Trim().ToLowerInvariant())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(item => item, StringComparer.Ordinal)
            .ToArray();
        var unknown = normalized.Where(item => !catalog.IsKnown(item)).ToArray();
        if (unknown.Length > 0)
        {
            throw new AssuranceException(
                "assurance-framework-invalid",
                $"Onbekend kader: {string.Join(", ", unknown)}.");
        }

        return normalized;
    }

    private static IReadOnlyList<string> DeserializeFrameworkIds(string json)
    {
        try
        {
            return (JsonSerializer.Deserialize<string[]>(
                        json,
                        ProcessJson.Options) ?? [])
                .Where(item => !string.IsNullOrWhiteSpace(item))
                .Select(item => item.Trim().ToLowerInvariant())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(item => item, StringComparer.Ordinal)
                .ToArray();
        }
        catch (JsonException)
        {
            throw new AssuranceException(
                "assurance-settings-corrupt",
                "De opgeslagen assurance-instellingen zijn ongeldig.",
                StatusCodes.Status500InternalServerError);
        }
    }

    private static int EffectiveInterval(int requestedIntervalHours) =>
        AllowedIntervalHours.Contains(requestedIntervalHours)
            ? Math.Min(requestedIntervalHours, MaximumIntervalHours)
            : MaximumIntervalHours;

    private static AssuranceSettingsDocument ToDocument(
        AssuranceSettingsEntity entity) =>
        new(
            DeserializeFrameworkIds(entity.ActiveFrameworkIdsJson),
            entity.RequestedIntervalHours,
            EffectiveInterval(entity.RequestedIntervalHours),
            MaximumIntervalHours,
            AllowedIntervalHours,
            true,
            entity.NextRunAtUtc.ToString("O"),
            entity.UpdatedAtUtc.ToString("O"),
            entity.UpdatedBy,
            entity.Revision);
}
