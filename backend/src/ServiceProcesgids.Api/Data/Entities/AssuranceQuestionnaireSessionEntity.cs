namespace ServiceProcesgids.Api.Data.Entities;

public sealed class AssuranceQuestionnaireSessionEntity
{
    public string SessionId { get; set; } = "";
    public string TenantId { get; set; } = "single-tenant";
    public string FrameworkId { get; set; } = "";
    public string CatalogVersion { get; set; } = "";
    public string Status { get; set; } = "open";
    public string StartedByActorId { get; set; } = "";
    public string StartedByActorName { get; set; } = "";
    public DateTimeOffset StartedAtUtc { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? CompletedAtUtc { get; set; }
    public int Revision { get; set; } = 1;
    public ICollection<AssuranceQuestionnaireAnswerEntity> Answers { get; set; } = [];
}
