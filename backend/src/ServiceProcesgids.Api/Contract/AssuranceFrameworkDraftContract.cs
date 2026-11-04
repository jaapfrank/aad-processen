namespace ServiceProcesgids.Api.Contract;

public sealed record AssuranceFrameworkDraftQuestion(
    string Id,
    string Titel,
    string Vraag,
    string BewijsHint);

public sealed record AssuranceFrameworkDraftCreateRequest(
    string BronUrl,
    string BronOrganisatie,
    string Naam,
    string Editie,
    string Domein,
    string PubliekeSamenvatting,
    bool GebruiksrechtenBevestigd);

public sealed record AssuranceFrameworkDraftPublishRequest(
    int ExpectedRevision,
    bool BronGecontroleerd,
    bool RechtenGecontroleerd,
    bool HighLevelBeperkingGeaccepteerd);

public sealed record AssuranceFrameworkDraftRejectRequest(
    int ExpectedRevision,
    string Reden);

public sealed record AssuranceFrameworkDraftDocument(
    string DraftId,
    string Status,
    string KaderId,
    string Naam,
    string Editie,
    string Domein,
    string BronUrl,
    string BronOrganisatie,
    string PubliekeSamenvatting,
    bool GebruiksrechtenBevestigd,
    string SchemaVersion,
    string Provider,
    string Model,
    string InputHash,
    string OutputHash,
    IReadOnlyList<AssuranceFrameworkDraftQuestion> Vragen,
    string AangemaaktDoor,
    string AangemaaktOp,
    string? GepubliceerdDoor,
    string? GepubliceerdOp,
    string? BronGecontroleerdOp,
    string? RechtenGecontroleerdOp,
    string? AfgewezenDoor,
    string? AfgewezenOp,
    string? Afwijsreden,
    int Revision,
    string Disclaimer);
