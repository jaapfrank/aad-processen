namespace ServiceProcesgids.Api.Data.Entities;

/// <summary>
/// Privacybewuste AI-runmetadata. Deze tabel bevat bewust geen prompt,
/// procesinhoud, gebruikersantwoorden, bronfragmenten of ruwe modeluitvoer.
/// Wijziging-id's worden uitsluitend als domeingescheiden hashes opgeslagen;
/// een optionele feedbackreden is kort, enkelregelig en streng gevalideerd.
/// </summary>
public sealed class AiRunEntity
{
    public long Id { get; set; }
    public string RunId { get; set; } = "";
    public string TenantId { get; set; } = "single-tenant";
    public string Capability { get; set; } = "";
    public string ProcessId { get; set; } = "";
    public int ProcessRevision { get; set; }
    public string ActorId { get; set; } = "";
    public string ActorName { get; set; } = "";
    public string? Provider { get; set; }
    public string? Model { get; set; }
    public string Status { get; set; } = "running";
    public string? ResultStatus { get; set; }
    public string? InputHash { get; set; }
    public string? OutputHash { get; set; }
    public DateTimeOffset StartedAtUtc { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? CompletedAtUtc { get; set; }
    public long? DurationMs { get; set; }
    public int QuestionCount { get; set; }
    public int IssueCount { get; set; }
    public int ChangeCount { get; set; }
    public string? ErrorCode { get; set; }
    public string? FeedbackDecision { get; set; }
    public string? FeedbackReason { get; set; }
    public string ProposedChangeIdsJson { get; set; } = "[]";
    public string AcceptedChangeIdsJson { get; set; } = "[]";
    public string? FeedbackByActorId { get; set; }
    public string? FeedbackByActorName { get; set; }
    public DateTimeOffset? FeedbackAtUtc { get; set; }
    public int Revision { get; set; } = 1;
}
