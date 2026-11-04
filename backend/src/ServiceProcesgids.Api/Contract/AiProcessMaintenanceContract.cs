namespace ServiceProcesgids.Api.Contract;

public sealed record ProcessMaintenanceAnalysisRequest(
    int ExpectedRevision,
    string? Doel,
    IReadOnlyList<string>? StapIds,
    ProcessMaintenanceTrigger? Aanleiding,
    IReadOnlyDictionary<string, string>? Antwoorden);

public sealed record ProcessMaintenanceTrigger(
    string Soort,
    string? ReferentieId,
    string? KaderId,
    string? Titel,
    string? Beschrijving);

public sealed record ProcessMaintenanceQuestion(
    string Id,
    string Vraag,
    string Waarom,
    string? StapId,
    IReadOnlyList<string> BronIds);

public sealed record ProcessMaintenanceIssue(
    string Id,
    string? StapId,
    string Categorie,
    string Ernst,
    string Titel,
    string Bevinding,
    string Uitleg,
    IReadOnlyList<string> BronIds);

public sealed record ProcessMaintenanceChange(
    string Id,
    string StapId,
    string Veld,
    string? OudeWaarde,
    string? NieuweWaarde,
    string Reden,
    bool BevestigingVereist,
    IReadOnlyList<string> BronIds);

public sealed record ProcessMaintenanceSource(
    string Id,
    string Type,
    string ProcesId,
    int ProcessRevision,
    string? StapId,
    string? Veld,
    string Label,
    string ContentHash);

public sealed record ProcessMaintenanceAnalysis(
    string SchemaVersion,
    string RunId,
    string ProcesId,
    int ProcessRevision,
    string Status,
    string Samenvatting,
    IReadOnlyList<string> BronIds,
    IReadOnlyList<ProcessMaintenanceQuestion> Vragen,
    IReadOnlyList<ProcessMaintenanceIssue> Issues,
    IReadOnlyList<ProcessMaintenanceChange> Wijzigingen,
    IReadOnlyList<ProcessMaintenanceSource> Bronnen);

public sealed record AiRunFeedbackRequest(
    string Beslissing,
    string? Reden,
    IReadOnlyList<string>? GeaccepteerdeWijzigingIds);

public sealed record AiRunFeedbackDocument(
    string Beslissing,
    string? Reden,
    IReadOnlyList<string> GeaccepteerdeWijzigingIds,
    string DoorGebruiker,
    string Op);

public sealed record AiRunDocument(
    string RunId,
    string Capability,
    string ProcesId,
    int ProcessRevision,
    string Status,
    string? ResultaatStatus,
    string? Provider,
    string? Model,
    string GestartDoor,
    string GestartOp,
    string? AfgerondOp,
    long? DuurMs,
    string? InputHash,
    string? OutputHash,
    int VraagAantal,
    int IssueAantal,
    int WijzigingAantal,
    string? Foutcode,
    AiRunFeedbackDocument? Feedback);
