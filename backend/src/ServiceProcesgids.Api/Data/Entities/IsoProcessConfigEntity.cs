namespace ServiceProcesgids.Api.Data.Entities;

public sealed class IsoProcessConfigEntity
{
    public string ProcessId { get; set; } = "";
    public string ConfigJson { get; set; } = "";
    public DateTimeOffset UpdatedAtUtc { get; set; } = DateTimeOffset.UtcNow;
    public string UpdatedBy { get; set; } = "";
}
