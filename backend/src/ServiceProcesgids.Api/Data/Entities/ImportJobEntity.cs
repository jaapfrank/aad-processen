namespace ServiceProcesgids.Api.Data.Entities;

public sealed class ImportJobEntity
{
    public string Id { get; set; } = "";
    public string FileName { get; set; } = "";
    public string Status { get; set; } = "wachtrij";
    public DateTimeOffset CreatedAtUtc { get; set; } = DateTimeOffset.UtcNow;
    public double Progress { get; set; }
    public string? SourceFileId { get; set; }
    public string? ConceptProcessJson { get; set; }
    public string ConfidenceJson { get; set; } = "[]";
    public string PageImagesJson { get; set; } = "[]";
    public string? Error { get; set; }
}
