namespace ServiceProcesgids.Api.Data.Entities;

public sealed class SuggestionEntity
{
    public string Id { get; set; } = "";
    public string ProcessId { get; set; } = "";
    public string? StepId { get; set; }
    public string Type { get; set; } = "";
    public string Text { get; set; } = "";
    public string CreatedBy { get; set; } = "";
    public DateTimeOffset CreatedAtUtc { get; set; } = DateTimeOffset.UtcNow;
    public string Status { get; set; } = "open";
    public string? ResolvedBy { get; set; }
    public DateTimeOffset? ResolvedAtUtc { get; set; }
}
