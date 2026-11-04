namespace ServiceProcesgids.Api.Data.Entities;

public sealed class AssuranceRunEntity
{
    public long Id { get; set; }
    public string RunId { get; set; } = "";
    public string TenantId { get; set; } = "single-tenant";
    public string Trigger { get; set; } = "";
    public string? ScheduleKey { get; set; }
    public string Status { get; set; } = "running";
    public string CatalogVersion { get; set; } = "";
    public string FrameworkIdsJson { get; set; } = "[]";
    public string StartedByActorId { get; set; } = "";
    public string StartedByActorName { get; set; } = "";
    public DateTimeOffset StartedAtUtc { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? CompletedAtUtc { get; set; }
    public int FindingCount { get; set; }
    public string? ErrorCode { get; set; }
    public int Revision { get; set; } = 1;
    public ICollection<AssuranceFindingEntity> Findings { get; set; } = [];
}
