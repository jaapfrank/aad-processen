namespace ServiceProcesgids.Api.Data.Entities;

public sealed class AssuranceSettingsEntity
{
    public string TenantId { get; set; } = "single-tenant";
    public string ActiveFrameworkIdsJson { get; set; } = "[]";
    public int RequestedIntervalHours { get; set; } = 720;
    public DateTimeOffset NextRunAtUtc { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAtUtc { get; set; } = DateTimeOffset.UtcNow;
    public string UpdatedBy { get; set; } = "Systeem";
    public int Revision { get; set; } = 1;
}
