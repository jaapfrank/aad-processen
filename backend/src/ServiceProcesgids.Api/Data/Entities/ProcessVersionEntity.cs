namespace ServiceProcesgids.Api.Data.Entities;

public sealed class ProcessVersionEntity
{
    public string ProcessId { get; set; } = "";
    public int VersionNr { get; set; }
    public string Status { get; set; } = "";
    public string ChangedBy { get; set; } = "";
    public DateTimeOffset ChangedAtUtc { get; set; } = DateTimeOffset.UtcNow;
    public string? Comment { get; set; }
    public string ProcessJson { get; set; } = "";
    public int ProcessRevision { get; set; }
    public string ProcessVersion { get; set; } = "";
    public string ProcessedSuggestionsJson { get; set; } = "[]";
}
