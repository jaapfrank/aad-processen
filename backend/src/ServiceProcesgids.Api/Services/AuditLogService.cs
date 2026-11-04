using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ServiceProcesgids.Api.Contract;
using ServiceProcesgids.Api.Data;
using ServiceProcesgids.Api.Data.Entities;
using ServiceProcesgids.Api.Models;

namespace ServiceProcesgids.Api.Services;

public sealed class AuditLogService(AppDbContext dbContext)
{
    public async Task WriteAsync(
        string action,
        string entityType,
        string entityId,
        User actor,
        object? details = null,
        CancellationToken cancellationToken = default)
    {
        dbContext.AuditLogs.Add(new AuditLogEntity
        {
            Action = action,
            EntityType = entityType,
            EntityId = entityId,
            ActorId = actor.Id,
            ActorName = actor.Naam,
            CreatedAtUtc = DateTimeOffset.UtcNow,
            DetailsJson = details is null ? null : JsonSerializer.Serialize(details, ProcessJson.Options)
        });

        await dbContext.SaveChangesAsync(cancellationToken);
    }

    public async Task<bool> HasEntriesAsync(CancellationToken cancellationToken = default) =>
        await dbContext.AuditLogs.AnyAsync(cancellationToken);
}
