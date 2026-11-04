using System.Text.Json;
using System.Text.Json.Serialization;

namespace ServiceProcesgids.Api.Contract;

public sealed record Lane(string Id, string Naam, string Kleur);

public sealed record Section(string Id, string Naam);

public sealed record StepRoute(
    string Id,
    string Label,
    string? Voorwaarde,
    string? NaarStap,
    string? NaarProces,
    bool? Standaard);

public sealed record StepSystemEvent(
    string Id,
    string Type,
    string LaneId,
    string Activiteit,
    string? DoelLaneId,
    string? Positie);

public sealed record Step(
    string Id,
    string Nummer,
    string LaneId,
    string Type,
    string Activiteit,
    string? SectieId,
    string? Toelichting,
    string? Opmerking,
    string? Zijnotitie,
    string? DoelLaneId,
    string? Voorwaarde,
    string? ErpStatus,
    string? Termijn,
    string? Waarschuwing,
    IReadOnlyList<string>? Checklist,
    IReadOnlyList<string>? FotoEisen,
    string? NaarStap,
    IReadOnlyList<StepRoute>? Routes,
    string? NaarProces,
    double? BronZekerheid,
    IReadOnlyList<StepSystemEvent>? SysteemGebeurtenissen = null,
    string? InteractieDoelLaneId = null);

public sealed record ProcessSource(
    string Type,
    string? Bestand,
    IReadOnlyList<int>? Paginas,
    string? ImportDatum,
    double? ImportZekerheid);

public sealed record ProcessDiagramPoint(double X, double Y);

public sealed record ProcessNodePlacement(
    double X,
    double Y,
    double? Width,
    double? Height);

public sealed record ProcessEdgePlacement(
    IReadOnlyList<ProcessDiagramPoint>? Waypoints,
    string? SourcePort,
    string? TargetPort,
    ProcessDiagramPoint? LabelPosition);

public sealed record ProcessDiagramLayout(
    int Version,
    string CoordinateSystem,
    IReadOnlyDictionary<string, ProcessNodePlacement> Nodes,
    IReadOnlyDictionary<string, ProcessEdgePlacement>? Edges);

public sealed record ProcessDocument(
    string Id,
    string Hoofdproces,
    string Detailproces,
    string Versie,
    string Status,
    string LaatsteWijziging,
    int? Revision,
    ProcessSource? Bron,
    IReadOnlyList<Lane> Lanes,
    IReadOnlyList<Section> Secties,
    IReadOnlyList<Step> Stappen,
    ProcessDiagramLayout? DiagramLayout = null);

public sealed record ProcessSummary(
    string Id,
    string Hoofdproces,
    string Detailproces,
    string Versie,
    string Status,
    string LaatsteWijziging,
    int? Revision,
    int AantalStappen,
    IReadOnlyList<string> Koppelingen);

public sealed record HealthIssue(
    string? StapId,
    string Soort,
    string Ernst,
    string Bericht);

public sealed record HealthReport(
    double Score,
    IReadOnlyList<HealthIssue> Issues);

public sealed record VersionDocument(
    int VersieNr,
    string ProcesId,
    string Status,
    string GewijzigdDoor,
    string GewijzigdOp,
    string? Opmerking,
    IReadOnlyList<string>? VerwerkteSuggesties);

public sealed record SuggestionDocument(
    string Id,
    string ProcesId,
    string? StapId,
    string Type,
    string Tekst,
    string DoorGebruiker,
    string AangemaaktOp,
    string Status);

public sealed record ImportFieldConfidence(
    string Veld,
    double Zekerheid,
    int? Pagina,
    string? BronTekst,
    string? Opmerking);

public sealed record ImportJobDocument(
    string Id,
    string Bestandsnaam,
    string Status,
    string AangemaaktOp,
    double? Voortgang,
    string? BronBestandId,
    ProcessDocument? ConceptProces,
    IReadOnlyList<ImportFieldConfidence>? Zekerheid,
    IReadOnlyList<string>? PaginaAfbeeldingen,
    string? Fout);

public sealed record DiffChange(
    string? StapId,
    string Soort,
    string? Veld,
    object? Oud,
    object? Nieuw);

public sealed record DiffReport(
    string ProcesId,
    int Van,
    int Naar,
    IReadOnlyList<DiffChange> Wijzigingen);

public sealed record IsoMapping(
    string Norm,
    IReadOnlyList<string>? Clausules,
    string Rol,
    string? Toelichting);

public sealed record ProcessGovernance(
    string? Eigenaar,
    string? Herzieningsinterval,
    string? LaatsteReview,
    string? VolgendeReview);

/// <summary>
/// Door de backend gestempelde menselijke beoordeling van één niet
/// automatiseerbare kadercontrole. Dit is auditbewijs, geen certificaat.
/// </summary>
public sealed record AuditBevestiging(
    string AssessmentId,
    string CatalogVersion,
    string KaderId,
    string ControleId,
    string Uitkomst,
    string Toelichting,
    string? Bewijsreferentie,
    string BevestigdDoorId,
    string BevestigdDoor,
    string BevestigdOp,
    int ProcessRevision);

public sealed record IsoProcessConfig(
    string ProcesId,
    IReadOnlyList<IsoMapping> Mappings,
    ProcessGovernance? Governance,
    IReadOnlyList<AuditBevestiging>? AuditBevestigingen = null);

public sealed record AuditBeoordelingStartRequest(string KaderId);

public sealed record AuditBeoordelingStart(
    string AssessmentId,
    string ProcesId,
    string KaderId,
    string GestartDoorId,
    string GestartDoor,
    string GestartOp,
    string VerlooptOp,
    int ProcessRevision,
    string CatalogVersion);

public sealed record AuditBevestigingRequest(
    string AssessmentId,
    int ExpectedRevision,
    string KaderId,
    string ControleId,
    string Uitkomst,
    string? Toelichting,
    string? Bewijsreferentie);

public sealed record BorgingIssue(
    string ProcesId,
    string? Norm,
    string Signaal,
    string Ernst,
    string Bericht);

public sealed record IsoMatrixRow(
    string ProcesId,
    string Hoofdproces,
    string Detailproces,
    string Norm,
    string Rol,
    IReadOnlyList<string> Clausules,
    string? Eigenaar,
    string Status,
    string? LaatsteReview,
    string? VolgendeReview,
    IReadOnlyList<BorgingIssue> Borging);

public sealed record IsoOverview(
    string? Norm,
    IReadOnlyList<string> Hoofdprocessen,
    IReadOnlyList<IsoMatrixRow> Rijen,
    IReadOnlyList<BorgingIssue> Signalen,
    string GegenereerdOp);

public static class ProcessJson
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        WriteIndented = false
    };
}
