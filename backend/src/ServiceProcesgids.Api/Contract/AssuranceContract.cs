namespace ServiceProcesgids.Api.Contract;

public sealed record AssuranceFrameworkQuestion(
    string Id,
    string Titel,
    string Vraag,
    string BewijsHint);

public sealed record AssuranceFramework(
    string Id,
    string Naam,
    string Editie,
    string Domein,
    string Type,
    string BronUrl,
    string BronOrganisatie,
    string BronGecontroleerdOp,
    bool Actief,
    IReadOnlyList<AssuranceFrameworkQuestion> Vragen);

public sealed record AssuranceFrameworkCatalog(
    string CatalogVersion,
    IReadOnlyList<AssuranceFramework> Kaders);

public sealed record AssuranceSettingsUpdateRequest(
    int ExpectedRevision,
    IReadOnlyList<string> ActieveKaderIds,
    int AangevraagdIntervalUren);

public sealed record AssuranceSettingsDocument(
    IReadOnlyList<string> ActieveKaderIds,
    int AangevraagdIntervalUren,
    int EffectiefIntervalUren,
    int MaximaalIntervalUren,
    IReadOnlyList<int> ToegestaneIntervalUren,
    bool MonitoringActief,
    string VolgendeRunOp,
    string BijgewerktOp,
    string BijgewerktDoor,
    int Revision);

public sealed record AssuranceQuestionnaireStartRequest(string KaderId);

public sealed record AssuranceQuestionnaireAnswerRequest(
    int ExpectedRevision,
    string VraagId,
    string Uitkomst,
    string? Bewijsreferentie,
    string? Motivatie);

public sealed record AssuranceQuestionnaireAnswer(
    string VraagId,
    string Uitkomst,
    string? Bewijsreferentie,
    string? Motivatie,
    string BeantwoordDoor,
    string BeantwoordOp);

public sealed record AssuranceReadiness(
    int Beantwoord,
    int Totaal,
    int Ja,
    int Deels,
    int Nee,
    int Onbekend,
    int Nvt,
    int BewijsGereed,
    int Open,
    string Disclaimer);

public sealed record AssuranceQuestionnaire(
    string SessionId,
    string KaderId,
    string KaderNaam,
    string CatalogVersion,
    string Status,
    string GestartDoor,
    string GestartOp,
    string? AfgerondOp,
    int Revision,
    IReadOnlyList<AssuranceFrameworkQuestion> Vragen,
    IReadOnlyList<AssuranceQuestionnaireAnswer> Antwoorden,
    AssuranceReadiness Readiness);

public sealed record AssuranceFinding(
    string Id,
    string? KaderId,
    string? ProcesId,
    string? VraagId,
    string Type,
    string Ernst,
    string Titel,
    string Bericht);

public sealed record AssuranceRun(
    string RunId,
    string Trigger,
    string Status,
    string CatalogVersion,
    IReadOnlyList<string> KaderIds,
    string GestartDoor,
    string GestartOp,
    string? AfgerondOp,
    int FindingCount,
    string? Foutcode,
    IReadOnlyList<AssuranceFinding> Bevindingen);

public sealed record AssuranceMonitoringStatus(
    bool MonitoringActief,
    bool Achterstallig,
    string VolgendeRunOp,
    int EffectiefIntervalUren,
    IReadOnlyList<string> ActieveKaderIds,
    AssuranceRun? LaatsteRun,
    string GegenereerdOp);
