namespace ServiceProcesgids.Api.Data.Entities;

public sealed class StoredFileEntity
{
    public string Id { get; set; } = "";
    public string FileName { get; set; } = "";
    public string ContentType { get; set; } = "application/octet-stream";
    public long Length { get; set; }
    public byte[] Content { get; set; } = [];
    public DateTimeOffset CreatedAtUtc { get; set; } = DateTimeOffset.UtcNow;
}
