namespace ServiceProcesgids.Api.Data.Entities;

public sealed class AssuranceFindingEntity
{
    public long Id { get; set; }
    public string FindingId { get; set; } = "";
    public string RunId { get; set; } = "";
    public string? FrameworkId { get; set; }
    public string? ProcessId { get; set; }
    public string? QuestionId { get; set; }
    public string Type { get; set; } = "";
    public string Severity { get; set; } = "";
    public string Title { get; set; } = "";
    public string Message { get; set; } = "";
    public DateTimeOffset CreatedAtUtc { get; set; } = DateTimeOffset.UtcNow;
    public AssuranceRunEntity? Run { get; set; }
}
