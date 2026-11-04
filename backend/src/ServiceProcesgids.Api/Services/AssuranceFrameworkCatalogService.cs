using ServiceProcesgids.Api.Contract;

namespace ServiceProcesgids.Api.Services;

/// <summary>
/// Openbare metadata en eigen, hoog-over evidencevragen. Deze catalogus bevat
/// bewust geen normtekst en doet geen conformiteitsclaim. De vaste catalogus
/// is een eerste extensiepunt; een toekomstige packruntime kan dezelfde
/// contracten vanuit gereviewde, immutable packs vullen.
/// </summary>
public sealed class AssuranceFrameworkCatalogService
{
    private readonly AssuranceFrameworkDraftService? _customDrafts;

    public AssuranceFrameworkCatalogService()
    {
    }

    public AssuranceFrameworkCatalogService(
        AssuranceFrameworkDraftService customDrafts)
    {
        _customDrafts = customDrafts;
    }

    public const string Version = "assurance-public-metadata-2026-07-28.1";

    private static readonly IReadOnlyList<AssuranceFramework> Frameworks =
    [
        Framework(
            "iso9001",
            "ISO 9001",
            "ISO 9001:2015 + Amendment 1:2024",
            "Kwaliteitsmanagement",
            "standard",
            "https://www.iso.org/standard/62085.html",
            "ISO",
            Question(
                "qms-owner-review",
                "Eigenaarschap en review",
                "Is voor de gekozen scope aantoonbaar wie verantwoordelijk is en wanneer de werking voor het laatst is beoordeeld?",
                "Verwijs naar een eigenaarstoewijzing, reviewverslag of goedgekeurde procesversie."),
            Question(
                "qms-performance-improvement",
                "Prestatie en verbetering",
                "Zijn afwijkingen, prestatie-uitkomsten en verbeteracties over een recente periode aantoonbaar gevolgd?",
                "Verwijs naar KPI-uitkomsten, afwijkingenregister, CAPA of managementreview.")),
        Framework(
            "iso27001",
            "ISO/IEC 27001",
            "ISO/IEC 27001:2022 + Amendment 1:2024",
            "Informatiebeveiliging",
            "standard",
            "https://www.iso.org/standard/27001",
            "ISO",
            Question(
                "isms-risk-treatment",
                "Risico en behandeling",
                "Zijn actuele informatiebeveiligingsrisico's, eigenaren en gekozen behandelingen voor de scope aantoonbaar vastgelegd?",
                "Verwijs naar een risicoregister, behandelplan en goedgekeurd restrisicobesluit."),
            Question(
                "isms-operation-evidence",
                "Werking van maatregelen",
                "Bestaat actueel bewijs dat belangrijke beveiligingsmaatregelen worden uitgevoerd en onafhankelijk beoordeeld?",
                "Verwijs naar testresultaten, toegangsreview, loggingcontrole of ander gedateerd uitvoeringsbewijs.")),
        Framework(
            "iso14001",
            "ISO 14001",
            "ISO 14001:2026",
            "Milieumanagement",
            "standard",
            "https://www.iso.org/standard/14001",
            "ISO",
            Question(
                "ems-aspects-obligations",
                "Aspecten en verplichtingen",
                "Zijn relevante milieuaspecten en toepasselijke complianceverplichtingen voor de scope actueel beoordeeld?",
                "Verwijs naar aspectenregister, vergunningenregister of beoordeling van verplichtingen."),
            Question(
                "ems-control-monitoring",
                "Beheersing en monitoring",
                "Is aantoonbaar dat belangrijke milieumaatregelen, meetpunten en afwijkingen periodiek worden gevolgd?",
                "Verwijs naar meetresultaten, inspecties, afwijkingen en opvolgacties.")),
        Framework(
            "iso45001",
            "ISO 45001",
            "ISO 45001:2018 + Amendment 1:2024",
            "Gezond en veilig werken",
            "standard",
            "https://www.iso.org/standard/63787.html",
            "ISO",
            Question(
                "ohs-hazards-controls",
                "Gevaren en maatregelen",
                "Zijn actuele gevaren, risico's en beheersmaatregelen voor de gekozen werkzaamheden aantoonbaar vastgelegd?",
                "Verwijs naar RI&E, taakrisicoanalyse, werkplekinspectie of maatregelenplan."),
            Question(
                "ohs-participation-learning",
                "Participatie en leren",
                "Is aantoonbaar hoe medewerkers worden geraadpleegd en hoe incidenten of bijna-incidenten tot verbetering leiden?",
                "Verwijs naar overlegverslagen, meldingen, incidentonderzoek en opvolgacties.")),
        Framework(
            "iso22301",
            "ISO 22301",
            "ISO 22301:2019 + Amendment 1:2024",
            "Business continuity",
            "standard",
            "https://www.iso.org/standard/75106.html",
            "ISO",
            Question(
                "bcms-impact-recovery",
                "Impact en hersteldoelen",
                "Zijn kritieke diensten, afhankelijkheden en hersteldoelen actueel en aantoonbaar bepaald?",
                "Verwijs naar BIA, afhankelijkhedenoverzicht en vastgestelde hersteldoelen."),
            Question(
                "bcms-exercise-improvement",
                "Oefenen en verbeteren",
                "Zijn continuïteitsplannen recent geoefend en zijn bevindingen aantoonbaar opgevolgd?",
                "Verwijs naar oefenplan, resultaten, verbeteracties en hertoetsing.")),
        Framework(
            "bpmn20",
            "BPMN 2.0.2",
            "BPMN 2.0.2 / ISO/IEC 19510",
            "Formele procesnotatie",
            "notation",
            "https://www.omg.org/spec/BPMN/2.0.2/",
            "OMG",
            Question(
                "bpmn-model-boundaries",
                "Modelgrenzen",
                "Zijn start, einde, rollen en beslisroutes in de gebruikte procesmodellen eenduidig en reviewbaar?",
                "Verwijs naar een gevalideerde modelversie of modelleringreview."),
            Question(
                "bpmn-model-governance",
                "Modelgovernance",
                "Is duidelijk welke gepubliceerde modelversie geldig is en wie wijzigingen beoordeelt?",
                "Verwijs naar publicatie, versiehistorie en review- of goedkeuringsbesluit.")),
        Framework(
            "nis2",
            "NIS2",
            "Richtlijn (EU) 2022/2555",
            "Cyberbeveiliging en bestuurlijke verantwoordelijkheid",
            "law",
            "https://eur-lex.europa.eu/eli/dir/2022/2555/oj",
            "Europese Unie",
            Question(
                "nis2-scope-governance",
                "Scope en governance",
                "Is de toepasselijkheid voor de organisatie onderbouwd en zijn bestuurlijke verantwoordelijkheden aantoonbaar toegewezen?",
                "Verwijs naar een scopebesluit, juridische bron, roltoewijzing en bestuurdersreview."),
            Question(
                "nis2-risk-incident-chain",
                "Risico, incidenten en keten",
                "Bestaat actueel bewijs voor risicobeheersing, incidentafhandeling en beheersing van kritieke leveranciers?",
                "Verwijs naar risico-, incident- en leveranciersdossiers met recente tests of reviews.")),
        Framework(
            "avg",
            "AVG",
            "Verordening (EU) 2016/679",
            "Privacy en gegevensbescherming",
            "regulation",
            "https://eur-lex.europa.eu/eli/reg/2016/679/oj",
            "Europese Unie",
            Question(
                "avg-processing-accountability",
                "Verwerkingen en verantwoording",
                "Zijn verwerkingen, doelen, grondslagen, betrokkenen, ontvangers en bewaartermijnen actueel en aantoonbaar vastgelegd?",
                "Verwijs naar het verwerkingsregister en de laatste inhoudelijke review."),
            Question(
                "avg-risk-rights-processors",
                "Risico's, rechten en verwerkers",
                "Bestaat actueel bewijs voor privacyrisicobeoordeling, rechtenafhandeling en toezicht op verwerkers?",
                "Verwijs naar DPIA/screening, verzoekenregister, verwerkersreviews en beveiligingsbewijs."))
    ];

    private static AssuranceFramework Framework(
        string id,
        string name,
        string edition,
        string domain,
        string type,
        string sourceUrl,
        string sourceOrganization,
        params AssuranceFrameworkQuestion[] questions) =>
        new(
            id,
            name,
            edition,
            domain,
            type,
            sourceUrl,
            sourceOrganization,
            "2026-07-28",
            false,
            questions);

    private static AssuranceFrameworkQuestion Question(
        string id,
        string title,
        string question,
        string evidenceHint) =>
        new(id, title, question, evidenceHint);

    public string CurrentVersion => Snapshot().Version;

    public IReadOnlyList<string> KnownIds =>
        Snapshot().Frameworks.Select(item => item.Id).ToArray();

    public bool IsKnown(string? id) =>
        !string.IsNullOrWhiteSpace(id) &&
        Snapshot().Frameworks.Any(item =>
            item.Id.Equals(id.Trim(), StringComparison.OrdinalIgnoreCase));

    public AssuranceFramework Get(string id)
    {
        var normalized = id.Trim().ToLowerInvariant();
        return Snapshot().Frameworks.Single(item => item.Id == normalized);
    }

    public AssuranceFrameworkCatalog CreateCatalog(
        IReadOnlySet<string> activeFrameworkIds)
    {
        var snapshot = Snapshot();
        return new(
            snapshot.Version,
            snapshot.Frameworks.Select(item =>
                    item with { Actief = activeFrameworkIds.Contains(item.Id) })
                .ToArray());
    }

    private (IReadOnlyList<AssuranceFramework> Frameworks, string Version) Snapshot()
    {
        var custom = _customDrafts?.GetPublishedCatalogSnapshot()
            ?? new PublishedAssuranceFrameworkCatalogSnapshot([], null);
        var version = custom.VersionSuffix is null
            ? Version
            : $"{Version}+custom.{custom.VersionSuffix}";
        return (
            Frameworks.Concat(custom.Kaders).ToArray(),
            version);
    }
}
