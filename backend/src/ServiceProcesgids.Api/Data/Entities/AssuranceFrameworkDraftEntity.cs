namespace ServiceProcesgids.Api.Data.Entities;

/// <summary>
/// Een door AI voorbereid normenkader. Een rij is pas catalogusinhoud nadat
/// een beheerder de bron en gebruiksrechten afzonderlijk heeft gecontroleerd
/// en het concept expliciet heeft gepubliceerd.
/// </summary>
public sealed class AssuranceFrameworkDraftEntity
{
    public long Id { get; set; }
    public string DraftId { get; set; } = "";
    public string TenantId { get; set; } = "single-tenant";
    public string Status { get; set; } = "concept";
    public string FrameworkId { get; set; } = "";
    public string Name { get; set; } = "";
    public string Edition { get; set; } = "";
    public string Domain { get; set; } = "";
    public string SourceUrl { get; set; } = "";
    public string SourceOrganization { get; set; } = "";
    public string PublicSummary { get; set; } = "";
    public string QuestionsJson { get; set; } = "[]";
    public string SchemaVersion { get; set; } = "";
    public string Provider { get; set; } = "";
    public string Model { get; set; } = "";
    public string InputHash { get; set; } = "";
    public string OutputHash { get; set; } = "";
    public string CatalogUniquenessKey { get; set; } = "";
    public bool UsageRightsConfirmed { get; set; }
    public string CreatedByActorId { get; set; } = "";
    public string CreatedByActorName { get; set; } = "";
    public DateTimeOffset CreatedAtUtc { get; set; } = DateTimeOffset.UtcNow;
    public string? PublishedByActorId { get; set; }
    public string? PublishedByActorName { get; set; }
    public DateTimeOffset? PublishedAtUtc { get; set; }
    public DateTimeOffset? SourceReviewedAtUtc { get; set; }
    public DateTimeOffset? RightsReviewedAtUtc { get; set; }
    public string? RejectedByActorId { get; set; }
    public string? RejectedByActorName { get; set; }
    public DateTimeOffset? RejectedAtUtc { get; set; }
    public string? RejectionReason { get; set; }
    public int Revision { get; set; } = 1;
}
