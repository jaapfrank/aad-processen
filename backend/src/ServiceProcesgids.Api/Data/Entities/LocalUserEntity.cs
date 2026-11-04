namespace ServiceProcesgids.Api.Data.Entities;

public sealed class LocalUserEntity
{
    public string Id { get; set; } = "";
    public string UserName { get; set; } = "";
    public string NormalizedUserName { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string? Email { get; set; }
    public string PasswordHash { get; set; } = "";
    public string RolesJson { get; set; } = "[]";
    public bool IsActive { get; set; } = true;
    public DateTimeOffset CreatedAtUtc { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? UpdatedAtUtc { get; set; }
}
