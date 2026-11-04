namespace ServiceProcesgids.Api.Data.Entities;

public sealed class AuditLogEntity
{
    public long Id { get; set; }
    public string Action { get; set; } = "";
    public string EntityType { get; set; } = "";
    public string EntityId { get; set; } = "";
    public string ActorId { get; set; } = "";
    public string ActorName { get; set; } = "";
    public DateTimeOffset CreatedAtUtc { get; set; } = DateTimeOffset.UtcNow;
    public string? DetailsJson { get; set; }
}
