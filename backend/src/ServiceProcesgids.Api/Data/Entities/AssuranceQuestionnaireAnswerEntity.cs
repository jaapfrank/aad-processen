namespace ServiceProcesgids.Api.Data.Entities;

public sealed class AssuranceQuestionnaireAnswerEntity
{
    public long Id { get; set; }
    public string SessionId { get; set; } = "";
    public string QuestionId { get; set; } = "";
    public string Outcome { get; set; } = "";
    public string? EvidenceReference { get; set; }
    public string? Motivation { get; set; }
    public string AnsweredByActorId { get; set; } = "";
    public string AnsweredByActorName { get; set; } = "";
    public DateTimeOffset AnsweredAtUtc { get; set; } = DateTimeOffset.UtcNow;
    public int Revision { get; set; } = 1;
    public AssuranceQuestionnaireSessionEntity? Session { get; set; }
}
