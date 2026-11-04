using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Xml;
using System.Xml.Linq;
using ServiceProcesgids.Api.Contract;

namespace ServiceProcesgids.Api.Services;

/// <summary>
/// Begrensde, netwerkloze codecs voor Lucid Standard Import en semantische
/// VSDX-import. De service extraheert nooit ZIP-inhoud naar het bestandssysteem.
/// </summary>
public sealed class DiagramPackageService(DiagramPackageLimits? configuredLimits = null)
{
    private const string SpgSchema = "1";
    private const double PixelsPerInch = 96;
    private const int LaneWidth = 240;
    private const int StepWidth = 200;
    private const int StepHeight = 72;
    private const int RowHeight = 136;
    private const int StartY = 70;
    private const int SectionHeight = 44;
    private static readonly string[] LanePalette =
        ["#2563eb", "#0891b2", "#059669", "#ca8a04", "#ea580c", "#9333ea"];
    private static readonly XNamespace VisioNs = "http://schemas.microsoft.com/office/visio/2012/main";
    private static readonly XNamespace RelationshipNs = "http://schemas.openxmlformats.org/package/2006/relationships";
    private static readonly XNamespace OfficeRelationshipNs = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    private static readonly XNamespace ContentTypeNs = "http://schemas.openxmlformats.org/package/2006/content-types";
    private readonly DiagramPackageLimits _limits = configuredLimits ?? new();

    public DiagramPackageExportResult ExportLucidStandard(ProcessDocument process)
    {
        var warnings = new List<DiagramExchangeIssue>();
        var shapes = new List<object>();
        var lines = new List<object>();
        var stepY = BuildStepPositions(process);
        var totalHeight = Math.Max(240, stepY.Values.DefaultIfEmpty(StartY).Max() + RowHeight);

        for (var index = 0; index < process.Lanes.Count; index++)
        {
            var lane = process.Lanes[index];
            shapes.Add(LucidShape(
                StableExternalId("lane", lane.Id),
                "rectangle",
                lane.Naam,
                index * LaneWidth,
                0,
                LaneWidth,
                totalHeight,
                lane.Kleur,
                "lane",
                lane.Id,
                lane));
        }

        foreach (var section in process.Secties)
        {
            var sectionSteps = process.Stappen.Where(step => step.SectieId == section.Id).ToList();
            var y = sectionSteps.Count > 0
                ? stepY[sectionSteps[0].Id] - SectionHeight
                : StartY;
            shapes.Add(LucidShape(
                StableExternalId("section", section.Id),
                "rectangle",
                section.Naam,
                0,
                y,
                Math.Max(LaneWidth, process.Lanes.Count * LaneWidth),
                32,
                "#f3f4f6",
                "section",
                section.Id,
                section));
        }

        var knownSteps = process.Stappen.Select(step => step.Id).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var knownLanes = process.Lanes.Select(lane => lane.Id).ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var step in process.Stappen)
        {
            var laneIndex = IndexOfLane(process.Lanes, step.LaneId);
            if (laneIndex < 0)
            {
                warnings.Add(new("unknown-lane", $"Stap '{step.Id}' is in de eerste kolom geplaatst.", step.Id));
                laneIndex = 0;
            }

            shapes.Add(LucidShape(
                StableExternalId("step", step.Id),
                LucidShapeType(step.Type),
                step.Activiteit,
                laneIndex * LaneWidth + (LaneWidth - StepWidth) / 2,
                stepY.GetValueOrDefault(step.Id, StartY),
                StepWidth,
                StepHeight,
                process.Lanes.ElementAtOrDefault(laneIndex)?.Kleur ?? "#9ca3af",
                "step",
                step.Id,
                step));

            if (!string.IsNullOrWhiteSpace(step.NaarStap))
            {
                if (knownSteps.Contains(step.NaarStap))
                {
                    lines.Add(LucidLine(
                        StableExternalId("transition", step.Id),
                        StableExternalId("step", step.Id),
                        StableExternalId("step", step.NaarStap),
                        "",
                        "transition",
                        step.Id,
                        null));
                }
                else
                {
                    warnings.Add(new("unknown-target", $"Stap '{step.Id}' verwijst naar onbekende stap '{step.NaarStap}'.", step.Id));
                }
            }

            foreach (var route in step.Routes ?? [])
            {
                if (!string.IsNullOrWhiteSpace(route.NaarStap) && knownSteps.Contains(route.NaarStap))
                {
                    lines.Add(LucidLine(
                        StableExternalId("route", $"{step.Id}:{route.Id}"),
                        StableExternalId("step", step.Id),
                        StableExternalId("step", route.NaarStap),
                        route.Label,
                        "route",
                        step.Id,
                        route.Id));
                }
                else if (!string.IsNullOrWhiteSpace(route.NaarStap))
                {
                    warnings.Add(new("unknown-route-target", $"Route '{route.Id}' heeft een onbekend doel.", route.Id));
                }
            }

            if (step.Type.Equals("bericht", StringComparison.OrdinalIgnoreCase) &&
                !string.IsNullOrWhiteSpace(step.DoelLaneId))
            {
                if (knownLanes.Contains(step.DoelLaneId))
                {
                    lines.Add(LucidLine(
                        StableExternalId("message", step.Id),
                        StableExternalId("step", step.Id),
                        StableExternalId("lane", step.DoelLaneId),
                        "",
                        "message",
                        step.Id,
                        null));
                }
                else
                {
                    warnings.Add(new("unknown-message-lane", $"Berichtstap '{step.Id}' heeft een onbekende doel-lane.", step.Id));
                }
            }
        }

        var page = new
        {
            id = StableExternalId("page", process.Id),
            title = process.Detailproces,
            shapes,
            lines,
            customData = new[]
            {
                Datum("spgSchema", SpgSchema),
                Datum("spgProcess", JsonSerializer.Serialize(process, ProcessJson.Options))
            }
        };
        var document = new { version = 1, pages = new[] { page } };
        var json = JsonSerializer.SerializeToUtf8Bytes(document, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        if (json.Length > 2 * 1024 * 1024 || json.Length > _limits.MaxEntryBytes)
        {
            return ExportError("lucid-standard", "document-too-large", "document.json overschrijdt de veilige Lucid-limiet.");
        }

        using var output = new MemoryStream();
        using (var archive = new ZipArchive(output, ZipArchiveMode.Create, leaveOpen: true, Encoding.UTF8))
        {
            var entry = archive.CreateEntry("document.json", CompressionLevel.Optimal);
            entry.LastWriteTime = new DateTimeOffset(1980, 1, 1, 0, 0, 0, TimeSpan.Zero);
            using var target = entry.Open();
            target.Write(json);
        }

        return new(
            true,
            "lucid-standard",
            $"{SafeFilePart(process.Id)}.lucid",
            "x-application/vnd.lucid.standardImport",
            output.ToArray(),
            warnings,
            []);
    }

    /// <summary>
    /// Maakt een macro-vrije, zelfstandig opgebouwde VSDX. De codec gebruikt
    /// alleen gedocumenteerde OPC/Visio XML-parts en geen Office-automatisering.
    /// Shapes zijn standalone (geen externe stencils of masters) en bevatten
    /// begrensde SPG Shape Data voor een semantische herimport.
    /// </summary>
    public DiagramPackageExportResult ExportVisioVsdx(ProcessDocument process)
    {
        if (process.Lanes.Count == 0)
        {
            return ExportError("visio-vsdx", "lanes-required", "Visio-export vereist minimaal één procesrol.");
        }

        var processJson = JsonSerializer.Serialize(process, ProcessJson.Options);
        if (processJson.Length > _limits.MaxMetadataCharacters)
        {
            return ExportError(
                "visio-vsdx",
                "process-metadata-too-large",
                "Het proces is te groot voor de begrensde Visio Shape Data-export.");
        }

        var warnings = new List<DiagramExchangeIssue>();
        var layout = BuildVisioExportLayout(process, warnings);
        var estimatedEdges = process.Stappen.Sum(step =>
            (string.IsNullOrWhiteSpace(step.NaarStap) ? 0 : 1) +
            (step.Routes?.Count(route => !string.IsNullOrWhiteSpace(route.NaarStap)) ?? 0) +
            (step.Type.Equals("bericht", StringComparison.OrdinalIgnoreCase) &&
             !string.IsNullOrWhiteSpace(step.DoelLaneId) ? 1 : 0));
        if (1 + process.Lanes.Count + process.Secties.Count + process.Stappen.Count + estimatedEdges >
            _limits.MaxDiagramItems)
        {
            return ExportError("visio-vsdx", "too-many-items", "Het proces bevat te veel Visio-shapes en connectors.");
        }

        var shapes = new XElement(VisioNs + "Shapes");
        var connects = new XElement(VisioNs + "Connects");
        var nextShapeId = 1;

        // Een onzichtbare shape is de package-lokale semantische bron van waarheid.
        // Dit voorkomt afhankelijkheid van custom XML-parts die Visio kan verwijderen.
        shapes.Add(CreateVisioShape(
            nextShapeId++,
            "SPG Process Metadata",
            "",
            new(0, layout.PageHeightPx - 2, 1, 1),
            layout.PageHeightPx,
            "#ffffff",
            "metadata",
            "process",
            process.Id,
            processJson,
            hidden: true));

        var laneShapeIds = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        foreach (var lane in process.Lanes)
        {
            var shapeId = nextShapeId++;
            laneShapeIds[lane.Id] = shapeId;
            shapes.Add(CreateVisioShape(
                shapeId,
                $"Swimlane {SafeVisioName(lane.Id)}",
                lane.Naam,
                layout.Lanes[lane.Id],
                layout.PageHeightPx,
                lane.Kleur,
                "lane",
                "lane",
                lane.Id,
                "{}"));
        }

        foreach (var section in process.Secties)
        {
            shapes.Add(CreateVisioShape(
                nextShapeId++,
                $"Section {SafeVisioName(section.Id)}",
                section.Naam,
                layout.Sections[section.Id],
                layout.PageHeightPx,
                "#f3f4f6",
                "section",
                "section",
                section.Id,
                "{}"));
        }

        var stepShapeIds = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        foreach (var step in process.Stappen)
        {
            var shapeId = nextShapeId++;
            stepShapeIds[step.Id] = shapeId;
            var lane = process.Lanes.FirstOrDefault(candidate =>
                candidate.Id.Equals(step.LaneId, StringComparison.OrdinalIgnoreCase));
            shapes.Add(CreateVisioShape(
                shapeId,
                VisioShapeName(step.Type, step.Id),
                step.Activiteit,
                layout.Steps[step.Id],
                layout.PageHeightPx,
                lane?.Kleur ?? "#9ca3af",
                step.Type,
                "step",
                step.Id,
                "{}"));
        }

        void AddConnector(
            string semanticId,
            string kind,
            int sourceShapeId,
            VisioExportBounds source,
            int targetShapeId,
            VisioExportBounds target,
            string label,
            string color)
        {
            var connectorId = nextShapeId++;
            var (begin, end) = VisioConnectorPoints(source, target);
            shapes.Add(CreateVisioConnector(
                connectorId,
                semanticId,
                kind,
                begin,
                end,
                layout.PageHeightPx,
                label,
                color));
            connects.Add(
                new XElement(
                    VisioNs + "Connect",
                    new XAttribute("FromSheet", connectorId),
                    new XAttribute("FromCell", "BeginX"),
                    new XAttribute("ToSheet", sourceShapeId),
                    new XAttribute("ToCell", "PinX")),
                new XElement(
                    VisioNs + "Connect",
                    new XAttribute("FromSheet", connectorId),
                    new XAttribute("FromCell", "EndX"),
                    new XAttribute("ToSheet", targetShapeId),
                    new XAttribute("ToCell", "PinX")));
        }

        foreach (var step in process.Stappen)
        {
            var sourceShapeId = stepShapeIds[step.Id];
            var sourceBounds = layout.Steps[step.Id];
            if (!string.IsNullOrWhiteSpace(step.NaarStap))
            {
                if (stepShapeIds.TryGetValue(step.NaarStap, out var targetShapeId))
                {
                    AddConnector(
                        $"transition:{step.Id}",
                        "transition",
                        sourceShapeId,
                        sourceBounds,
                        targetShapeId,
                        layout.Steps[step.NaarStap],
                        "",
                        "#6b7280");
                }
                else
                {
                    warnings.Add(new(
                        "unknown-target",
                        $"Stap '{step.Id}' verwijst naar onbekende stap '{step.NaarStap}'; de verbinding is niet geëxporteerd.",
                        step.Id));
                }
            }

            foreach (var route in step.Routes ?? [])
            {
                if (string.IsNullOrWhiteSpace(route.NaarStap)) continue;
                if (stepShapeIds.TryGetValue(route.NaarStap, out var targetShapeId))
                {
                    AddConnector(
                        $"route:{step.Id}:{route.Id}",
                        "route",
                        sourceShapeId,
                        sourceBounds,
                        targetShapeId,
                        layout.Steps[route.NaarStap],
                        route.Label,
                        "#6b7280");
                }
                else
                {
                    warnings.Add(new(
                        "unknown-route-target",
                        $"Route '{route.Id}' verwijst naar onbekende stap '{route.NaarStap}'; de verbinding is niet geëxporteerd.",
                        route.Id));
                }
            }

            if (step.Type.Equals("bericht", StringComparison.OrdinalIgnoreCase) &&
                !string.IsNullOrWhiteSpace(step.DoelLaneId))
            {
                if (laneShapeIds.TryGetValue(step.DoelLaneId, out var targetShapeId))
                {
                    AddConnector(
                        $"message:{step.Id}",
                        "message",
                        sourceShapeId,
                        sourceBounds,
                        targetShapeId,
                        layout.Lanes[step.DoelLaneId],
                        "",
                        "#ea5b0c");
                }
                else
                {
                    warnings.Add(new(
                        "unknown-message-lane",
                        $"Berichtstap '{step.Id}' verwijst naar onbekende doelrol '{step.DoelLaneId}'.",
                        step.Id));
                }
            }
        }

        var pageContents = new XDocument(
            new XDeclaration("1.0", "UTF-8", null),
            new XElement(
                VisioNs + "PageContents",
                new XAttribute(XNamespace.Xml + "space", "preserve"),
                shapes,
                connects.HasElements ? connects : null));
        var pageWidthIn = layout.PageWidthPx / PixelsPerInch;
        var pageHeightIn = layout.PageHeightPx / PixelsPerInch;
        var pages = new XDocument(
            new XDeclaration("1.0", "UTF-8", null),
            new XElement(
                VisioNs + "Pages",
                new XAttribute(XNamespace.Xmlns + "r", OfficeRelationshipNs),
                new XAttribute(XNamespace.Xml + "space", "preserve"),
                new XElement(
                    VisioNs + "Page",
                    new XAttribute("ID", "0"),
                    new XAttribute("NameU", "Process"),
                    new XAttribute("Name", SafeXmlText(process.Detailproces, 255)),
                    new XElement(
                        VisioNs + "PageSheet",
                        new XElement(VisioNs + "Cell", new XAttribute("N", "PageWidth"), new XAttribute("V", Invariant(pageWidthIn))),
                        new XElement(VisioNs + "Cell", new XAttribute("N", "PageHeight"), new XAttribute("V", Invariant(pageHeightIn))),
                        new XElement(VisioNs + "Cell", new XAttribute("N", "PageScale"), new XAttribute("V", "1")),
                        new XElement(VisioNs + "Cell", new XAttribute("N", "DrawingScale"), new XAttribute("V", "1"))),
                    new XElement(
                        VisioNs + "Rel",
                        new XAttribute(OfficeRelationshipNs + "id", "rId1")))));

        var contentTypes = new XDocument(
            new XDeclaration("1.0", "UTF-8", null),
            new XElement(
                ContentTypeNs + "Types",
                new XElement(
                    ContentTypeNs + "Default",
                    new XAttribute("Extension", "rels"),
                    new XAttribute("ContentType", "application/vnd.openxmlformats-package.relationships+xml")),
                new XElement(
                    ContentTypeNs + "Default",
                    new XAttribute("Extension", "xml"),
                    new XAttribute("ContentType", "application/xml")),
                VisioContentType("/visio/document.xml", "application/vnd.ms-visio.drawing.main+xml"),
                VisioContentType("/visio/pages/pages.xml", "application/vnd.ms-visio.pages+xml"),
                VisioContentType("/visio/pages/page1.xml", "application/vnd.ms-visio.page+xml"),
                VisioContentType("/docProps/core.xml", "application/vnd.openxmlformats-package.core-properties+xml"),
                VisioContentType("/docProps/app.xml", "application/vnd.openxmlformats-officedocument.extended-properties+xml")));
        var rootRelationships = Relationships(
            Relationship(
                "rId1",
                "http://schemas.microsoft.com/visio/2010/relationships/document",
                "visio/document.xml"),
            Relationship(
                "rId2",
                "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
                "docProps/core.xml"),
            Relationship(
                "rId3",
                "http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties",
                "docProps/app.xml"));
        var documentRelationships = Relationships(
            Relationship(
                "rId1",
                "http://schemas.microsoft.com/visio/2010/relationships/pages",
                "pages/pages.xml"));
        var pageRelationships = Relationships(
            Relationship(
                "rId1",
                "http://schemas.microsoft.com/visio/2010/relationships/page",
                "page1.xml"));
        var document = new XDocument(
            new XDeclaration("1.0", "UTF-8", null),
            new XElement(
                VisioNs + "VisioDocument",
                new XAttribute(XNamespace.Xml + "space", "preserve")));
        var now = DateTimeOffset.UtcNow;
        XNamespace corePropertiesNs = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties";
        XNamespace dcNs = "http://purl.org/dc/elements/1.1/";
        XNamespace dctermsNs = "http://purl.org/dc/terms/";
        XNamespace xsiNs = "http://www.w3.org/2001/XMLSchema-instance";
        var coreProperties = new XDocument(
            new XDeclaration("1.0", "UTF-8", null),
            new XElement(
                corePropertiesNs + "coreProperties",
                new XAttribute(XNamespace.Xmlns + "dc", dcNs),
                new XAttribute(XNamespace.Xmlns + "dcterms", dctermsNs),
                new XAttribute(XNamespace.Xmlns + "xsi", xsiNs),
                new XElement(dcNs + "title", SafeXmlText(process.Detailproces, 512)),
                new XElement(dcNs + "creator", "Service Procesgids"),
                new XElement(dctermsNs + "created", new XAttribute(xsiNs + "type", "dcterms:W3CDTF"), now.ToString("O")),
                new XElement(dctermsNs + "modified", new XAttribute(xsiNs + "type", "dcterms:W3CDTF"), now.ToString("O"))));
        XNamespace extendedPropertiesNs = "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties";
        XNamespace vtNs = "http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes";
        var appProperties = new XDocument(
            new XDeclaration("1.0", "UTF-8", null),
            new XElement(
                extendedPropertiesNs + "Properties",
                new XAttribute(XNamespace.Xmlns + "vt", vtNs),
                new XElement(extendedPropertiesNs + "Application", "Service Procesgids"),
                new XElement(extendedPropertiesNs + "AppVersion", "1.0")));

        using var output = new MemoryStream();
        using (var archive = new ZipArchive(output, ZipArchiveMode.Create, leaveOpen: true, Encoding.UTF8))
        {
            AddZipXml(archive, "[Content_Types].xml", contentTypes);
            AddZipXml(archive, "_rels/.rels", rootRelationships);
            AddZipXml(archive, "docProps/core.xml", coreProperties);
            AddZipXml(archive, "docProps/app.xml", appProperties);
            AddZipXml(archive, "visio/document.xml", document);
            AddZipXml(archive, "visio/_rels/document.xml.rels", documentRelationships);
            AddZipXml(archive, "visio/pages/pages.xml", pages);
            AddZipXml(archive, "visio/pages/_rels/pages.xml.rels", pageRelationships);
            AddZipXml(archive, "visio/pages/page1.xml", pageContents);
        }

        var content = output.ToArray();
        if (content.Length == 0 || content.Length > _limits.MaxPackageBytes)
        {
            return ExportError("visio-vsdx", "package-size-invalid", "De gemaakte VSDX valt buiten de veilige pakketlimiet.");
        }

        warnings.Add(new(
            "visio-runtime-review-recommended",
            "Het pakket is structureel en via semantische herimport gevalideerd; acceptatie in de gebruikte Visio desktop/web-versie blijft aanbevolen."));
        return new(
            true,
            "visio-vsdx",
            $"{SafeFilePart(process.Id)}.vsdx",
            "application/vnd.ms-visio.drawing",
            content,
            warnings,
            []);
    }

    public DiagramImportResult ImportLucidStandard(ReadOnlyMemory<byte> package)
    {
        var validation = OpenValidatedPackage(package, "lucid-standard");
        if (!validation.Ok)
        {
            return ImportError("lucid-standard", validation.Errors);
        }

        using var archive = validation.Archive!;
        var unexpectedEntry = archive.Entries.FirstOrDefault(entry =>
            !entry.FullName.Equals("document.json", StringComparison.OrdinalIgnoreCase) &&
            !(entry.FullName.StartsWith("data/", StringComparison.OrdinalIgnoreCase) &&
              entry.FullName.EndsWith(".csv", StringComparison.OrdinalIgnoreCase)) &&
            !(entry.FullName.StartsWith("images/", StringComparison.OrdinalIgnoreCase) &&
              (entry.FullName.EndsWith(".png", StringComparison.OrdinalIgnoreCase) ||
               entry.FullName.EndsWith(".jpg", StringComparison.OrdinalIgnoreCase) ||
               entry.FullName.EndsWith(".jpeg", StringComparison.OrdinalIgnoreCase))));
        if (unexpectedEntry is not null)
        {
            return ImportError("lucid-standard", [new(
                "unexpected-entry",
                $"Lucid-package bevat niet-toegestane entry '{unexpectedEntry.FullName}'.")]);
        }
        var documentEntry = archive.GetEntry("document.json");
        if (documentEntry is null)
        {
            return ImportError("lucid-standard", [new("document-missing", "Lucid-package bevat geen document.json.")]);
        }

        try
        {
            var bytes = ReadEntry(documentEntry);
            if (bytes.Length > 2 * 1024 * 1024)
            {
                return ImportError("lucid-standard", [new("document-too-large", "document.json overschrijdt 2 MB.")]);
            }

            using var json = JsonDocument.Parse(bytes, new JsonDocumentOptions
            {
                AllowTrailingCommas = false,
                CommentHandling = JsonCommentHandling.Disallow,
                MaxDepth = 64
            });
            var root = json.RootElement;
            if (!root.TryGetProperty("version", out var version) || version.GetInt32() != 1 ||
                !root.TryGetProperty("pages", out var pages) || pages.ValueKind != JsonValueKind.Array ||
                pages.GetArrayLength() == 0)
            {
                return ImportError("lucid-standard", [new("invalid-document", "Lucid Standard Import v1 met minimaal één pagina vereist.")]);
            }

            var page = pages[0];
            var processJson = CustomDataValue(page, "spgProcess");
            if (CustomDataValue(page, "spgSchema") != SpgSchema || string.IsNullOrWhiteSpace(processJson))
            {
                return ImportError("lucid-standard", [new("spg-metadata-missing", "Service Procesgids-metadata ontbreekt.")]);
            }

            var process = DeserializeMetadata<ProcessDocument>(processJson);
            if (process is null)
            {
                return ImportError("lucid-standard", [new("spg-process-invalid", "spgProcess bevat geen geldig proces.")]);
            }

            var geometry = new List<DiagramElementGeometry>();
            var warnings = new List<DiagramExchangeIssue>();
            var unmapped = new List<DiagramExchangeIssue>();
            var shapeReferences = new Dictionary<string, LucidSemanticReference>(StringComparer.OrdinalIgnoreCase);
            var shapeEdits = new Dictionary<string, List<LucidShapeEdit>>(StringComparer.OrdinalIgnoreCase);
            var mapped = 0;
            var total = 0;
            if (page.TryGetProperty("shapes", out var shapes) && shapes.ValueKind == JsonValueKind.Array)
            {
                if (shapes.GetArrayLength() > _limits.MaxDiagramItems)
                {
                    return ImportError("lucid-standard", [new("too-many-items", "Te veel Lucid-shapes.")]);
                }

                foreach (var shape in shapes.EnumerateArray())
                {
                    total++;
                    var externalId = StringProperty(shape, "id") ?? $"shape-{total}";
                    var kind = CustomDataValue(shape, "spgKind");
                    var id = CustomDataValue(shape, "spgId");
                    if (kind is not ("lane" or "section" or "step") || string.IsNullOrWhiteSpace(id))
                    {
                        unmapped.Add(new("unmapped-shape", "Shape bevat geen ondersteunde SPG-metadata.", externalId));
                        continue;
                    }
                    if (!SemanticElementExists(process, kind, id))
                    {
                        unmapped.Add(new(
                            "unknown-semantic-shape",
                            $"Shape verwijst naar onbekend SPG-{kind} '{id}'; de shape is niet toegepast.",
                            externalId));
                        continue;
                    }
                    if (!shapeReferences.TryAdd(externalId, new(kind, id)))
                    {
                        unmapped.Add(new(
                            "duplicate-shape-id",
                            $"Lucid-shape-ID '{externalId}' komt meerdere keren voor; bewerkingen zijn niet toegepast.",
                            externalId));
                        continue;
                    }

                    mapped++;
                    geometry.Add(GeometryFromLucid(shape, externalId, kind, id));
                    var editKey = $"{kind}\0{id}";
                    if (!shapeEdits.TryGetValue(editKey, out var edits))
                    {
                        edits = [];
                        shapeEdits[editKey] = edits;
                    }
                    edits.Add(new(kind, id, StringProperty(shape, "text") ?? "", externalId));
                }
            }

            process = ApplyLucidShapeEdits(process, shapeEdits, warnings, unmapped);
            if (page.TryGetProperty("lines", out var lines) && lines.ValueKind == JsonValueKind.Array)
            {
                if (total + lines.GetArrayLength() > _limits.MaxDiagramItems)
                {
                    return ImportError("lucid-standard", [new("too-many-items", "Te veel Lucid-items.")]);
                }

                var lineElements = lines.EnumerateArray().ToList();
                var lineIdentityCounts = lineElements
                    .Select(LucidLineIdentity)
                    .Where(identity => identity is not null)
                    .GroupBy(identity => identity!, StringComparer.OrdinalIgnoreCase)
                    .ToDictionary(group => group.Key, group => group.Count(), StringComparer.OrdinalIgnoreCase);
                foreach (var line in lineElements)
                {
                    total++;
                    var externalId = StringProperty(line, "id") ?? $"line-{total}";
                    var kind = CustomDataValue(line, "spgKind");
                    var source = CustomDataValue(line, "spgSourceStepId");
                    if (kind is not ("transition" or "route" or "message") || string.IsNullOrWhiteSpace(source))
                    {
                        unmapped.Add(new("unmapped-line", "Line bevat geen ondersteunde SPG-metadata.", externalId));
                        continue;
                    }
                    var identity = LucidLineIdentity(line);
                    if (identity is null || lineIdentityCounts.GetValueOrDefault(identity) != 1)
                    {
                        unmapped.Add(new(
                            "duplicate-semantic-line",
                            "Meerdere Lucid-lines verwijzen naar dezelfde SPG-relatie; endpointbewerkingen zijn niet toegepast.",
                            externalId));
                        continue;
                    }

                    var sourceShapeId = LucidEndpointShapeId(line, "endpoint1");
                    var targetShapeId = LucidEndpointShapeId(line, "endpoint2");
                    if (sourceShapeId is null || targetShapeId is null ||
                        !shapeReferences.TryGetValue(sourceShapeId, out var sourceReference) ||
                        !shapeReferences.TryGetValue(targetShapeId, out var targetReference))
                    {
                        unmapped.Add(new(
                            "line-endpoint-unmapped",
                            "Bestaande SPG-line heeft geen twee herkende shape-endpoints; de bewerking is niet toegepast.",
                            externalId));
                        continue;
                    }
                    if (sourceReference.Kind != "step" ||
                        !sourceReference.SemanticId.Equals(source, StringComparison.OrdinalIgnoreCase))
                    {
                        unmapped.Add(new(
                            "line-source-change-ambiguous",
                            "Het bron-endpoint van een bestaande SPG-line is gewijzigd; verplaatsing van relatie-eigenaarschap wordt niet gegokt.",
                            externalId));
                        continue;
                    }
                    if (!TryApplyLucidLineEdit(
                            ref process,
                            line,
                            externalId,
                            kind,
                            source,
                            targetReference,
                            warnings,
                            unmapped))
                    {
                        continue;
                    }
                    mapped++;
                }
            }

            return new(
                true,
                "lucid-standard",
                process,
                geometry,
                warnings,
                unmapped,
                [],
                total == 0 ? 0 : (double)mapped / total);
        }
        catch (Exception exception) when (
            exception is InvalidDataException or JsonException or IOException or
            InvalidOperationException or FormatException or ArgumentException)
        {
            return ImportError("lucid-standard", [new("invalid-package", $"Lucid-package is ongeldig: {exception.Message}")]);
        }
    }

    public DiagramImportResult ImportVisioVsdx(ReadOnlyMemory<byte> package, string? pageId = null, string? defaultRole = null)
    {
        var validation = OpenValidatedPackage(package, "visio-vsdx");
        if (!validation.Ok)
        {
            return ImportError("visio-vsdx", validation.Errors);
        }

        using var archive = validation.Archive!;
        try
        {
            var names = archive.Entries.Select(entry => entry.FullName).ToHashSet(StringComparer.OrdinalIgnoreCase);
            if (!names.Contains("[Content_Types].xml") ||
                !names.Contains("_rels/.rels") ||
                !names.Contains("visio/document.xml"))
            {
                return ImportError("visio-vsdx", [new("opc-parts-missing", "VSDX mist verplichte OPC/Visio-parts.")]);
            }

            foreach (var entry in archive.Entries)
            {
                if (IsMacroPart(entry.FullName))
                {
                    return ImportError("visio-vsdx", [new("macro-package-rejected", "Macro-enabled Visio-inhoud is niet toegestaan.")]);
                }

                XDocument? xml = null;
                if (entry.FullName.EndsWith(".xml", StringComparison.OrdinalIgnoreCase) ||
                    entry.FullName.EndsWith(".rels", StringComparison.OrdinalIgnoreCase))
                {
                    xml = ReadXml(entry);
                }

                if (entry.FullName.EndsWith(".rels", StringComparison.OrdinalIgnoreCase))
                {
                    if (xml!.Descendants().Any(element =>
                            element.Name.LocalName == "Relationship" &&
                            string.Equals((string?)element.Attribute("TargetMode"), "External", StringComparison.OrdinalIgnoreCase)))
                    {
                        return ImportError("visio-vsdx", [new("external-relationship-rejected", "Externe OPC-relaties zijn niet toegestaan.")]);
                    }
                }
            }

            var contentTypes = ReadXml(archive.GetEntry("[Content_Types].xml")!);
            if (contentTypes.Descendants().Attributes().Any(attribute =>
                    attribute.Value.Contains("macroEnabled", StringComparison.OrdinalIgnoreCase) ||
                    attribute.Value.Contains("vbaProject", StringComparison.OrdinalIgnoreCase)))
            {
                return ImportError("visio-vsdx", [new("macro-package-rejected", "Macro-enabled Visio-contenttypes zijn niet toegestaan.")]);
            }

            ProcessDocument? process = null;
            var geometry = new List<DiagramElementGeometry>();
            var warnings = new List<DiagramExchangeIssue>();
            var unmapped = new List<DiagramExchangeIssue>();
            var shapeEdits = new Dictionary<string, List<LucidShapeEdit>>(StringComparer.OrdinalIgnoreCase);
            var mapped = 0;
            var total = 0;
            var pageHeights = ReadVisioPageHeights(archive);
            var pageEntries = archive.Entries
                .Where(entry => IsVisioPageEntry(entry.FullName))
                .OrderBy(entry => entry.FullName, StringComparer.OrdinalIgnoreCase)
                .ToList();
            if (pageEntries.Count == 0)
            {
                return ImportError("visio-vsdx", [new("pages-missing", "VSDX bevat geen pagina-parts.")]);
            }

            var pages = ReadVisioPages(archive, pageEntries);
            var foreground = pages.Where(page => !page.Background).ToList();
            var selected = string.IsNullOrWhiteSpace(pageId)
                ? foreground.Count == 1 ? foreground[0] : null
                : foreground.SingleOrDefault(page => page.Id.Equals(pageId, StringComparison.Ordinal));
            if (selected is null)
            {
                return ImportError("visio-vsdx", [new(
                    string.IsNullOrWhiteSpace(pageId) ? "page-selection-required" : "page-selection-invalid",
                    string.IsNullOrWhiteSpace(pageId)
                        ? "Kies de procespagina die je wilt importeren. Elke pagina wordt als afzonderlijk concept gecontroleerd; achtergrondpagina's worden niet geïmporteerd."
                        : "De gekozen procespagina bestaat niet of is een achtergrondpagina.")]) with { Pages = pages };
            }
            if (defaultRole?.Length > 120)
            {
                return ImportError("visio-vsdx", [new("default-role-invalid", "Gebruik maximaal 120 tekens voor de verantwoordelijke rol.")]) with { Pages = pages };
            }
            pageEntries = pageEntries.Where(entry => entry.FullName == selected.Id).ToList();

            foreach (var pageEntry in pageEntries)
            {
                var page = ReadXml(pageEntry);
                var pageHeight = pageHeights.GetValueOrDefault(pageEntry.FullName);
                var shapes = page.Descendants().Where(element => element.Name.LocalName == "Shape").ToList();
                if (total + shapes.Count > _limits.MaxDiagramItems)
                {
                    return ImportError("visio-vsdx", [new("too-many-items", "VSDX bevat te veel shapes.")]);
                }

                foreach (var shape in shapes)
                {
                    total++;
                    var externalId = (string?)shape.Attribute("ID") ?? $"shape-{total}";
                    var metadata = VisioShapeData(shape);
                    if (!metadata.TryGetValue("spgKind", out var kind) ||
                        !metadata.TryGetValue("spgData", out var data))
                    {
                        unmapped.Add(new("unmapped-shape", "Visio-shape bevat geen ondersteunde SPG Shape Data.", externalId));
                        continue;
                    }

                    if (kind == "process")
                    {
                        process = DeserializeMetadata<ProcessDocument>(data);
                        if (process is null)
                        {
                            return ImportError("visio-vsdx", [new("spg-process-invalid", "Procesmetadata in VSDX is ongeldig.", externalId)]);
                        }
                        mapped++;
                        continue;
                    }

                    if (kind is "transition" or "route" or "message" &&
                        metadata.TryGetValue("spgId", out var edgeId) &&
                        !string.IsNullOrWhiteSpace(edgeId))
                    {
                        mapped++;
                        continue;
                    }

                    if (kind is not ("lane" or "section" or "step") ||
                        !metadata.TryGetValue("spgId", out var semanticId) ||
                        string.IsNullOrWhiteSpace(semanticId))
                    {
                        unmapped.Add(new("unsupported-spg-shape", $"SPG-shapetype '{kind}' wordt niet ondersteund.", externalId));
                        continue;
                    }

                    mapped++;
                    geometry.Add(GeometryFromVisio(shape, externalId, kind, semanticId, pageHeight));
                    var editKey = $"{kind}\0{semanticId}";
                    if (!shapeEdits.TryGetValue(editKey, out var edits))
                    {
                        edits = [];
                        shapeEdits[editKey] = edits;
                    }
                    edits.Add(new(
                        kind,
                        semanticId,
                        NormalizeText(string.Join(
                            " ",
                            shape.Descendants()
                                .Where(element => element.Name.LocalName == "Text")
                                .Select(element => element.Value))),
                        externalId));
                }
            }

            if (process is null)
            {
                return ImportOrdinaryVisioFlowchart(archive, pageEntries, package, selected, defaultRole) with { Pages = pages };
            }

            process = ApplyLucidShapeEdits(process, shapeEdits, warnings, unmapped);
            return new(
                true,
                "visio-vsdx",
                process,
                geometry,
                warnings,
                unmapped,
                [],
                total == 0 ? 0 : (double)mapped / total,
                pages);
        }
        catch (Exception exception) when (
            exception is InvalidDataException or XmlException or JsonException or IOException or
            InvalidOperationException or FormatException or ArgumentException)
        {
            return ImportError("visio-vsdx", [new("invalid-package", $"VSDX is ongeldig: {exception.Message}")]);
        }
    }

    private DiagramImportResult ImportOrdinaryVisioFlowchart(
        ZipArchive archive,
        IReadOnlyList<ZipArchiveEntry> pageEntries,
        ReadOnlyMemory<byte> package,
        VisioImportPage selectedPage,
        string? defaultRole)
    {
        var errors = new List<DiagramExchangeIssue>();
        var warnings = new List<DiagramExchangeIssue>
        {
            new(
                "visio-header-generated",
                "Proces-id, hoofdproces en versie zijn gegenereerd; laat de gebruiker deze vóór commit bevestigen.")
        };
        var unmapped = new List<DiagramExchangeIssue>();
        var masterHints = ReadVisioMasterHints(archive);
        var page = ReadXml(pageEntries[0]);
        ApplyVisioMasterDefaults(archive, page);
        var shapeElements = page.Descendants()
            .Where(element => element.Name.LocalName == "Shape")
            .ToList();
        var connects = page.Descendants()
            .Where(element => element.Name.LocalName == "Connect")
            .ToList();
        if (shapeElements.Count == 0)
        {
            return ImportError("visio-vsdx", [new("shapes-missing", "De Visio-pagina bevat geen shapes.")]);
        }
        if (shapeElements.Count > _limits.MaxDiagramItems || connects.Count > _limits.MaxDiagramItems * 2)
        {
            return ImportError("visio-vsdx", [new("too-many-items", "De Visio-flowchart bevat te veel shapes of connects.")]);
        }

        var shapeInfos = shapeElements
            .Select(element => CreateVisioShapeInfo(element, masterHints))
            .ToList();
        var missingIds = shapeInfos.Where(shape => string.IsNullOrWhiteSpace(shape.ExternalId)).ToList();
        if (missingIds.Count > 0)
        {
            return ImportError("visio-vsdx", [new(
                "shape-id-missing",
                $"{missingIds.Count} Visio-shape(s) missen een ID; connectors kunnen daardoor niet veilig worden gekoppeld.")]);
        }
        var duplicateId = shapeInfos
            .GroupBy(shape => shape.ExternalId, StringComparer.OrdinalIgnoreCase)
            .FirstOrDefault(group => group.Count() > 1);
        if (duplicateId is not null)
        {
            return ImportError("visio-vsdx", [new(
                "shape-id-duplicate",
                $"Visio-shape-ID '{duplicateId.Key}' komt meerdere keren voor.",
                duplicateId.Key)]);
        }
        var shapes = shapeInfos.ToDictionary(shape => shape.ExternalId, StringComparer.OrdinalIgnoreCase);
        var explicitLanes = shapes.Values.Where(shape => IsExplicitLaneHint(shape.Hint)).ToList();
        var laneCandidates = explicitLanes.Count > 0
            ? explicitLanes
            : shapes.Values.Where(shape => IsExplicitContainerHint(shape.Hint) && !string.IsNullOrWhiteSpace(shape.Text)).ToList();
        if (laneCandidates.Count == 0 && !string.IsNullOrWhiteSpace(defaultRole))
        {
            var bounds = shapes.Values.Where(shape => shape.Bounds is not null).Select(shape => shape.Bounds!).ToList();
            if (bounds.Count > 0)
            {
                var left = bounds.Min(item => item.Left) - 0.25;
                var bottom = bounds.Min(item => item.Bottom) - 0.25;
                var width = bounds.Max(item => item.Left + item.Width) - left + 0.25;
                var height = bounds.Max(item => item.Bottom + item.Height) - bottom + 0.25;
                var lane = new XElement(VisioNs + "Shape", new XAttribute("ID", "assigned-role"),
                    new XAttribute("NameU", "Swimlane"),
                    VisioCell("PinX", left + width / 2), VisioCell("PinY", bottom + height / 2),
                    VisioCell("Width", width), VisioCell("Height", height),
                    new XElement(VisioNs + "Text", defaultRole.Trim()));
                laneCandidates.Add(CreateVisioShapeInfo(lane, masterHints));
                warnings.Add(new("role-assigned-by-user", $"Alle stappen zijn toegewezen aan de door jou opgegeven rol '{defaultRole.Trim()}'. Controleer verantwoordelijkheden per stap in de editor."));
            }
        }
        if (laneCandidates.Count == 0)
        {
            errors.Add(new(
                "roles-missing",
                "Geen benoemde zwembanen gevonden. Vul een verantwoordelijke rol in om te importeren; daarna kun je rollen per stap aanpassen."));
        }

        foreach (var lane in laneCandidates)
        {
            if (lane.Bounds is null || string.IsNullOrWhiteSpace(lane.Text))
            {
                errors.Add(new(
                    "lane-ambiguous",
                    $"Lane/container '{lane.ExternalId}' mist geometry of een expliciete rolnaam.",
                    lane.ExternalId));
            }
            if (lane.Element.Ancestors().Any(element => element.Name.LocalName == "Shape") ||
                Math.Abs(VisioCellNumber(lane.Element, "Angle") ?? 0) > 0.00001)
                errors.Add(new("lane-transform-unsupported", "Deze zwembaan staat in een groep of is gedraaid. Hef de groepering/draaiing in Visio op voor een betrouwbare roltoewijzing.", lane.ExternalId));
        }

        var connectorIds = connects
            .Select(connect => (string?)connect.Attribute("FromSheet"))
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var connectorShapes = shapes.Values
            .Where(shape => connectorIds.Contains(shape.ExternalId) || IsConnectorHint(shape.Hint) || shape.OneDimensional)
            .ToDictionary(shape => shape.ExternalId, StringComparer.OrdinalIgnoreCase);
        var candidateSteps = shapes.Values
            .Where(shape => !laneCandidates.Contains(shape) && !connectorShapes.ContainsKey(shape.ExternalId))
            .ToList();

        var classified = new List<(VisioShapeInfo Shape, string Type)>();
        foreach (var shape in candidateSteps)
        {
            var type = ClassifyFlowShape(shape);
            if (type == "terminator")
            {
                // The stencil marks a terminal; the glued connectors establish its direction.
                var incoming = connects.Count(connect => (string?)connect.Attribute("ToSheet") == shape.ExternalId &&
                    ((string?)connect.Attribute("FromCell"))?.StartsWith("End", StringComparison.OrdinalIgnoreCase) == true);
                var outgoing = connects.Count(connect => (string?)connect.Attribute("ToSheet") == shape.ExternalId &&
                    ((string?)connect.Attribute("FromCell"))?.StartsWith("Begin", StringComparison.OrdinalIgnoreCase) == true);
                type = incoming == 0 && outgoing > 0 ? "start" : incoming > 0 && outgoing == 0 ? "eind" : null;
                if (type is not null)
                    warnings.Add(new("terminal-direction-inferred", $"'{shape.Text}' is als {(type == "start" ? "start" : "einde")} herkend op basis van de terminalvorm en verbonden pijlen.", shape.ExternalId));
            }
            if (type is null)
            {
                if (!string.IsNullOrWhiteSpace(shape.Text))
                {
                    errors.Add(new(
                        "shape-classification-required",
                        $"Shape '{shape.ExternalId}' met tekst '{shape.Text}' heeft geen ondubbelzinnige flowchartmaster (Start/End, Process, Decision).",
                        shape.ExternalId));
                }
                unmapped.Add(new(
                    "unmapped-shape",
                    string.IsNullOrWhiteSpace(shape.Text)
                        ? "Decoratieve/onbenoemde shape is niet geïmporteerd."
                        : "Shape vereist handmatige classificatie.",
                    shape.ExternalId));
                continue;
            }
            if (shape.Bounds is null || string.IsNullOrWhiteSpace(shape.Text))
            {
                errors.Add(new(
                    "step-content-ambiguous",
                    $"Flowchartshape '{shape.ExternalId}' mist geometry of tekst.",
                    shape.ExternalId));
                continue;
            }
            if (shape.Element.Ancestors().Any(element => element.Name.LocalName == "Shape") ||
                Math.Abs(VisioCellNumber(shape.Element, "Angle") ?? 0) > 0.00001)
            {
                errors.Add(new("shape-transform-unsupported", $"Stap '{shape.Text}' staat in een groep of is gedraaid. Hef de groepering/draaiing in Visio op zodat de verantwoordelijkheid en positie betrouwbaar kunnen worden overgenomen.", shape.ExternalId));
                continue;
            }
            classified.Add((shape, type));
        }

        var starts = classified.Where(item => item.Type == "start").ToList();
        var ends = classified.Where(item => item.Type == "eind").ToList();
        if (starts.Count != 1)
        {
            errors.Add(new("start-ambiguous", $"Exact één expliciete startshape vereist; gevonden: {starts.Count}."));
        }
        if (ends.Count == 0)
        {
            errors.Add(new("end-missing", "Minimaal één expliciete eindshape vereist."));
        }

        var laneByShape = new Dictionary<string, VisioShapeInfo>(StringComparer.OrdinalIgnoreCase);
        foreach (var (shape, _) in classified)
        {
            var containing = laneCandidates
                .Where(lane => lane.Bounds?.Contains(shape.Bounds!.CenterX, shape.Bounds.CenterY) == true)
                .ToList();
            if (containing.Count != 1)
            {
                errors.Add(new(
                    "role-assignment-ambiguous",
                    $"Shape '{shape.ExternalId}' valt in {containing.Count} lanes/containers; exact één rol is vereist.",
                    shape.ExternalId));
                continue;
            }
            laneByShape[shape.ExternalId] = containing[0];
        }

        var flowShapeIds = classified.Select(item => item.Shape.ExternalId).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var connections = new List<VisioFlowConnection>();
        foreach (var group in connects.GroupBy(
                     connect => (string?)connect.Attribute("FromSheet") ?? "",
                     StringComparer.OrdinalIgnoreCase))
        {
            if (string.IsNullOrWhiteSpace(group.Key)) continue;
            var connector = connectorShapes.GetValueOrDefault(group.Key);
            if (connector is null)
            {
                errors.Add(new("connector-shape-missing", $"Connect-record verwijst naar onbekende connector '{group.Key}'.", group.Key));
                continue;
            }

            var beginTargets = group
                .Where(connect => ((string?)connect.Attribute("FromCell"))?.Contains("Begin", StringComparison.OrdinalIgnoreCase) == true)
                .Select(connect => (string?)connect.Attribute("ToSheet"))
                .Where(target => !string.IsNullOrWhiteSpace(target))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
            var endTargets = group
                .Where(connect => ((string?)connect.Attribute("FromCell"))?.Contains("End", StringComparison.OrdinalIgnoreCase) == true)
                .Select(connect => (string?)connect.Attribute("ToSheet"))
                .Where(target => !string.IsNullOrWhiteSpace(target))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
            if (beginTargets.Count != 1 || endTargets.Count != 1)
            {
                errors.Add(new(
                    "connector-endpoints-ambiguous",
                    $"Connector '{group.Key}' moet exact één gelijmd BeginX- en één EndX-doel hebben.",
                    group.Key));
                continue;
            }
            var source = beginTargets[0]!;
            var target = endTargets[0]!;
            if ((VisioCellNumber(connector.Element, "BeginArrow") ?? 0) != 0)
            {
                errors.Add(new("connector-direction-unsupported", "Deze connector heeft een pijl aan het begin of aan beide kanten. Gebruik een gerichte connector met de pijl aan het einde om de procesvolgorde eenduidig over te nemen.", group.Key));
                continue;
            }
            if (!flowShapeIds.Contains(source) || !flowShapeIds.Contains(target))
            {
                errors.Add(new(
                    "connector-target-unsupported",
                    $"Connector '{group.Key}' verbindt geen twee herkende flowchartstappen.",
                    group.Key));
                continue;
            }
            connections.Add(new(group.Key, source, target, connector.Text.Trim()));
        }
        foreach (var duplicate in connections
                     .GroupBy(connection => (connection.SourceId, connection.TargetId))
                     .Where(group => group.Count() > 1))
        {
            errors.Add(new(
                "duplicate-connectors-ambiguous",
                $"Meerdere connectors verbinden shape '{duplicate.Key.SourceId}' met '{duplicate.Key.TargetId}'.",
                duplicate.First().ExternalId));
        }
        if (connections.Count == 0)
        {
            errors.Add(new(
                "connectors-missing",
                "Geen ondubbelzinnige gelijmde Visio-connectors gevonden; visuele nabijheid wordt niet als procesvolgorde gebruikt."));
        }

        foreach (var (shape, type) in classified)
        {
            var outgoing = connections.Where(connection => connection.SourceId == shape.ExternalId).ToList();
            var incoming = connections.Where(connection => connection.TargetId == shape.ExternalId).ToList();
            if (type == "start" && incoming.Count > 0)
            {
                errors.Add(new(
                    "start-has-incoming",
                    $"Startshape '{shape.Text}' heeft een inkomende connector.",
                    shape.ExternalId));
            }
            else if (type != "start" && incoming.Count == 0)
            {
                errors.Add(new(
                    "step-unreachable",
                    $"Shape '{shape.Text}' heeft geen inkomende connector.",
                    shape.ExternalId));
            }
            if (type == "beslissing")
            {
                if (outgoing.Count < 2)
                {
                    errors.Add(new(
                        "decision-routes-missing",
                        $"Beslissing '{shape.Text}' vereist minimaal twee uitgaande connectors.",
                        shape.ExternalId));
                }
                if (outgoing.Any(connection => string.IsNullOrWhiteSpace(connection.Label)) ||
                    outgoing.Select(connection => connection.Label).Distinct(StringComparer.OrdinalIgnoreCase).Count() != outgoing.Count)
                {
                    errors.Add(new(
                        "decision-labels-ambiguous",
                        $"Alle uitgaande routes van beslissing '{shape.Text}' moeten een uniek, niet-leeg connectorlabel hebben.",
                        shape.ExternalId));
                }
            }
            else if (type == "eind" && outgoing.Count > 0)
            {
                errors.Add(new("end-has-outgoing", $"Eindshape '{shape.Text}' heeft een uitgaande connector.", shape.ExternalId));
            }
            else if (type != "eind" && outgoing.Count != 1)
            {
                errors.Add(new(
                    "step-flow-ambiguous",
                    $"Stap '{shape.Text}' moet exact één uitgaande connector hebben; gevonden: {outgoing.Count}.",
                    shape.ExternalId));
            }
        }
        if (starts.Count == 1)
        {
            var reachable = TraverseConnections(
                [starts[0].Shape.ExternalId],
                connections,
                connection => connection.SourceId,
                connection => connection.TargetId);
            foreach (var missing in classified.Where(item => !reachable.Contains(item.Shape.ExternalId)))
            {
                errors.Add(new(
                    "step-not-reachable-from-start",
                    $"Shape '{missing.Shape.Text}' is niet bereikbaar vanaf de expliciete start.",
                    missing.Shape.ExternalId));
            }
        }
        if (ends.Count > 0)
        {
            var canReachEnd = TraverseConnections(
                ends.Select(item => item.Shape.ExternalId),
                connections,
                connection => connection.TargetId,
                connection => connection.SourceId);
            foreach (var deadEnd in classified.Where(item => !canReachEnd.Contains(item.Shape.ExternalId)))
            {
                errors.Add(new(
                    "step-cannot-reach-end",
                    $"Shape '{deadEnd.Shape.Text}' heeft geen connectorpad naar een expliciet einde.",
                    deadEnd.Shape.ExternalId));
            }
        }

        if (errors.Count > 0)
        {
            return new(false, "visio-vsdx", null, [], warnings, unmapped, errors, 0);
        }

        var ordered = classified
            .OrderByDescending(item => item.Shape.Bounds!.CenterY)
            .ThenBy(item => item.Shape.Bounds!.CenterX)
            .ToList();
        var semanticIds = ordered.ToDictionary(
            item => item.Shape.ExternalId,
            item => $"visio-step-{StableExternalId("shape", item.Shape.ExternalId)[^16..]}",
            StringComparer.OrdinalIgnoreCase);
        var lanes = laneCandidates
            .OrderBy(lane => lane.Bounds!.Left)
            .Select((lane, index) => new Lane(
                $"visio-lane-{StableExternalId("lane", lane.ExternalId)[^16..]}",
                lane.Text.Trim(),
                LanePalette[index % LanePalette.Length]))
            .ToList();
        var laneIds = laneCandidates
            .OrderBy(lane => lane.Bounds!.Left)
            .Zip(lanes)
            .ToDictionary(pair => pair.First.ExternalId, pair => pair.Second.Id, StringComparer.OrdinalIgnoreCase);
        var steps = new List<Step>();
        for (var index = 0; index < ordered.Count; index++)
        {
            var (shape, type) = ordered[index];
            var outgoing = connections.Where(connection => connection.SourceId == shape.ExternalId).ToList();
            IReadOnlyList<StepRoute>? routes = null;
            string? nextStep = null;
            if (type == "beslissing")
            {
                routes = outgoing.Select((connection, routeIndex) => new StepRoute(
                    $"route-{semanticIds[shape.ExternalId]}-{routeIndex + 1}",
                    connection.Label,
                    connection.Label,
                    semanticIds[connection.TargetId],
                    null,
                    null)).ToList();
            }
            else if (type != "eind")
            {
                nextStep = semanticIds[outgoing[0].TargetId];
            }

            steps.Add(new Step(
                semanticIds[shape.ExternalId],
                type == "start" ? "S" : type == "eind" ? "E" : (index + 1).ToString(System.Globalization.CultureInfo.InvariantCulture),
                laneIds[laneByShape[shape.ExternalId].ExternalId],
                type,
                shape.Text.Trim(),
                null,
                null,
                null,
                null,
                null,
                type == "beslissing" ? shape.Text.Trim() : null,
                null,
                null,
                null,
                null,
                null,
                nextStep,
                routes,
                null,
                null));
        }

        var packageHash = Convert.ToHexString(SHA256.HashData(package.Span)).ToLowerInvariant()[..16];
        var pageSuffix = StableExternalId("page", selectedPage.Id)[^8..];
        var process = new ProcessDocument(
            $"visio-import-{packageHash}-{pageSuffix}",
            "Visio-import",
            selectedPage.Name,
            "V1.0",
            "concept",
            DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd"),
            1,
            new ProcessSource("visio-import", null, [selectedPage.Number], DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd"), null),
            lanes,
            [],
            steps);
        var pageHeight = ReadVisioPageHeights(archive).GetValueOrDefault(selectedPage.Id)
            ?? laneCandidates.Max(lane => lane.Bounds!.Bottom + lane.Bounds.Height);
        var geometry = classified.Select(item => GeometryFromVisio(
            item.Shape.Element,
            item.Shape.ExternalId,
            "step",
            semanticIds[item.Shape.ExternalId], pageHeight)).Concat(
            laneCandidates.Select(lane => GeometryFromVisio(
                lane.Element,
                lane.ExternalId,
                "lane",
                laneIds[lane.ExternalId], pageHeight))).ToList();
        var totalItems = shapeElements.Count + (laneCandidates.Any(lane => lane.ExternalId == "assigned-role") ? 1 : 0);
        var mappedItems = classified.Count + laneCandidates.Count + connections.Count;
        return new(
            true,
            "visio-vsdx",
            process,
            geometry,
            warnings,
            unmapped,
            [],
            totalItems == 0 ? 0 : (double)mappedItems / totalItems);
    }

    public DiagramExportBlocker GetVisioExportBlocker() => new(
        "visio-vsdx",
        "native-opc-export-available",
        "Macro-vrije VSDX-export is beschikbaar. Het pakket wordt structureel en via semantische herimport gecontroleerd; voer voor productieacceptatie nog eenmalig een open/bewerk/opslaan-test uit in de gebruikte Visio desktop- en webversie.",
        false);

    public DiagramPackageSelfTestResult SelfTestLucidRoundTrip(ProcessDocument process)
    {
        var exported = ExportLucidStandard(process);
        var imported = exported.Content is null ? null : ImportLucidStandard(exported.Content);
        var original = JsonSerializer.Serialize(process, ProcessJson.Options);
        var returned = imported?.Process is null
            ? null
            : JsonSerializer.Serialize(imported.Process, ProcessJson.Options);
        var checks = new Dictionary<string, bool>
        {
            ["export-succeeded"] = exported.Ok && exported.Content is { Length: > 0 },
            ["import-succeeded"] = imported?.Ok == true,
            ["semantic-round-trip"] = original == returned,
            ["no-import-errors"] = imported?.Errors.Count == 0,
            ["geometry-present"] = (imported?.Geometry.Count ?? 0) >= process.Lanes.Count + process.Stappen.Count
        };
        return new(
            checks.Values.All(value => value),
            checks,
            exported.Errors.Concat(imported?.Errors ?? []).Select(issue => $"{issue.Code}: {issue.Message}").ToList());
    }

    public DiagramPackageSelfTestResult SelfTestOrdinaryVisioImport()
    {
        var imported = ImportVisioVsdx(CreateMinimalOrdinaryVisioFixture());
        var decision = imported.Process?.Stappen.SingleOrDefault(step => step.Type == "beslissing");
        var checks = new Dictionary<string, bool>
        {
            ["import-succeeded"] = imported.Ok,
            ["no-spg-metadata-required"] = imported.Errors.All(issue => issue.Code != "spg-metadata-missing"),
            ["one-explicit-lane"] = imported.Process?.Lanes.Count == 1,
            ["five-flowchart-steps"] = imported.Process?.Stappen.Count == 5,
            ["start-and-end-recognized"] =
                imported.Process?.Stappen.Count(step => step.Type == "start") == 1 &&
                imported.Process.Stappen.Count(step => step.Type == "eind") == 1,
            ["decision-routes-recognized"] =
                decision?.Routes?.Count == 2 &&
                decision.Routes.Select(route => route.Label).ToHashSet(StringComparer.OrdinalIgnoreCase)
                    .SetEquals(["Ja", "Nee"]),
            ["no-import-errors"] = imported.Errors.Count == 0
        };
        return new(
            checks.Values.All(value => value),
            checks,
            imported.Errors.Concat(imported.Unmapped).Select(issue => $"{issue.Code}: {issue.Message}").ToList());
    }

    public DiagramPackageSelfTestResult SelfTestVisioRoundTrip(ProcessDocument process)
    {
        var exported = ExportVisioVsdx(process);
        var imported = exported.Content is null ? null : ImportVisioVsdx(exported.Content);
        var original = JsonSerializer.Serialize(process, ProcessJson.Options);
        var returned = imported?.Process is null
            ? null
            : JsonSerializer.Serialize(imported.Process, ProcessJson.Options);
        var expectedConnections = process.Stappen.Sum(step =>
            (!string.IsNullOrWhiteSpace(step.NaarStap) ? 1 : 0) +
            (step.Routes?.Count(route => !string.IsNullOrWhiteSpace(route.NaarStap)) ?? 0) +
            (step.Type.Equals("bericht", StringComparison.OrdinalIgnoreCase) &&
             !string.IsNullOrWhiteSpace(step.DoelLaneId) ? 1 : 0));
        var requiredParts = new[]
        {
            "[Content_Types].xml",
            "_rels/.rels",
            "visio/document.xml",
            "visio/_rels/document.xml.rels",
            "visio/pages/pages.xml",
            "visio/pages/_rels/pages.xml.rels",
            "visio/pages/page1.xml"
        };
        var packagePartsComplete = false;
        var relationshipsInternal = false;
        var macroFree = false;
        var gluedConnectorCount = 0;
        if (exported.Content is { Length: > 0 })
        {
            using var archive = new ZipArchive(
                new MemoryStream(exported.Content, writable: false),
                ZipArchiveMode.Read,
                leaveOpen: false,
                Encoding.UTF8);
            var names = archive.Entries.Select(entry => entry.FullName)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
            packagePartsComplete = requiredParts.All(names.Contains);
            macroFree = archive.Entries.All(entry => !IsMacroPart(entry.FullName));
            relationshipsInternal = archive.Entries
                .Where(entry => entry.FullName.EndsWith(".rels", StringComparison.OrdinalIgnoreCase))
                .Select(ReadXml)
                .SelectMany(document => document.Descendants()
                    .Where(element => element.Name.LocalName == "Relationship"))
                .All(relationship =>
                    !string.Equals(
                        (string?)relationship.Attribute("TargetMode"),
                        "External",
                        StringComparison.OrdinalIgnoreCase));
            var page = ReadXml(archive.GetEntry("visio/pages/page1.xml")!);
            gluedConnectorCount = page.Descendants()
                .Count(element =>
                    element.Name.LocalName == "Connect" &&
                    string.Equals((string?)element.Attribute("FromCell"), "BeginX", StringComparison.OrdinalIgnoreCase));
        }
        var checks = new Dictionary<string, bool>
        {
            ["export-succeeded"] = exported.Ok && exported.Content is { Length: > 0 },
            ["required-opc-parts-present"] = packagePartsComplete,
            ["relationships-internal"] = relationshipsInternal,
            ["macro-free"] = macroFree,
            ["connectors-glued"] = gluedConnectorCount == expectedConnections,
            ["import-succeeded"] = imported?.Ok == true,
            ["semantic-round-trip"] = original == returned,
            ["no-import-errors"] = imported?.Errors.Count == 0,
            ["all-own-shapes-mapped"] = imported?.Unmapped.Count == 0,
            ["geometry-present"] =
                (imported?.Geometry.Count ?? 0) ==
                process.Lanes.Count + process.Secties.Count + process.Stappen.Count
        };
        return new(
            checks.Values.All(value => value),
            checks,
            exported.Errors
                .Concat(imported?.Errors ?? [])
                .Concat(imported?.Unmapped ?? [])
                .Select(issue => $"{issue.Code}: {issue.Message}")
                .ToList());
    }

    private PackageValidation OpenValidatedPackage(ReadOnlyMemory<byte> package, string format)
    {
        var errors = new List<DiagramExchangeIssue>();
        if (package.Length == 0 || package.Length > _limits.MaxPackageBytes)
        {
            errors.Add(new("package-size-invalid", $"Packagegrootte voor {format} valt buiten de veilige limiet."));
            return new(null, errors);
        }

        try
        {
            var stream = new MemoryStream(package.ToArray(), writable: false);
            var archive = new ZipArchive(stream, ZipArchiveMode.Read, leaveOpen: false, Encoding.UTF8);
            if (archive.Entries.Count == 0 || archive.Entries.Count > _limits.MaxEntries)
            {
                archive.Dispose();
                errors.Add(new("entry-count-invalid", "ZIP bevat geen of te veel entries."));
                return new(null, errors);
            }

            long total = 0;
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var entry in archive.Entries)
            {
                if (!IsSafeEntryName(entry.FullName) || !seen.Add(entry.FullName))
                {
                    archive.Dispose();
                    errors.Add(new("unsafe-entry-name", $"Onveilig of dubbel ZIP-pad '{entry.FullName}'."));
                    return new(null, errors);
                }
                if (entry.Length < 0 || entry.Length > _limits.MaxEntryBytes)
                {
                    archive.Dispose();
                    errors.Add(new("entry-too-large", $"ZIP-entry '{entry.FullName}' is te groot."));
                    return new(null, errors);
                }
                total = checked(total + entry.Length);
                if (total > _limits.MaxUncompressedBytes)
                {
                    archive.Dispose();
                    errors.Add(new("package-expanded-too-large", "Gedecomprimeerde ZIP-inhoud is te groot."));
                    return new(null, errors);
                }
                if (entry.CompressedLength > 0 &&
                    entry.Length / (double)entry.CompressedLength > _limits.MaxCompressionRatio)
                {
                    archive.Dispose();
                    errors.Add(new("compression-ratio-invalid", $"ZIP-entry '{entry.FullName}' heeft een verdachte compressieratio."));
                    return new(null, errors);
                }
            }

            return new(archive, errors);
        }
        catch (Exception exception) when (
            exception is InvalidDataException or IOException or OverflowException or ArgumentException)
        {
            errors.Add(new("invalid-zip", $"Package is geen geldige begrensde ZIP: {exception.Message}"));
            return new(null, errors);
        }
    }

    private byte[] ReadEntry(ZipArchiveEntry entry)
    {
        using var source = entry.Open();
        using var output = new MemoryStream();
        var buffer = new byte[81920];
        long total = 0;
        while (true)
        {
            var read = source.Read(buffer, 0, buffer.Length);
            if (read == 0) break;
            total += read;
            if (total > _limits.MaxEntryBytes || total > entry.Length + 1)
            {
                throw new InvalidDataException($"ZIP-entry '{entry.FullName}' overschrijdt de leeslimiet.");
            }
            output.Write(buffer, 0, read);
        }
        return output.ToArray();
    }

    private XDocument ReadXml(ZipArchiveEntry entry)
    {
        using var stream = new MemoryStream(ReadEntry(entry), writable: false);
        var settings = new XmlReaderSettings
        {
            DtdProcessing = DtdProcessing.Prohibit,
            XmlResolver = null,
            MaxCharactersInDocument = _limits.MaxXmlCharacters,
            MaxCharactersFromEntities = 0,
            IgnoreComments = true,
            IgnoreProcessingInstructions = true
        };
        using var reader = XmlReader.Create(stream, settings);
        var document = XDocument.Load(reader, LoadOptions.None);
        var maxDepth = document.Descendants().Select(Depth).DefaultIfEmpty(0).Max();
        if (maxDepth > _limits.MaxXmlDepth)
        {
            throw new XmlException("XML-nesting is te diep.");
        }
        return document;
    }

    private static int Depth(XElement element)
    {
        var depth = 0;
        for (var current = element.Parent; current is not null; current = current.Parent) depth++;
        return depth;
    }

    private static bool IsSafeEntryName(string name)
    {
        if (string.IsNullOrWhiteSpace(name) ||
            name.StartsWith('/') ||
            name.StartsWith('\\') ||
            name.Contains('\\') ||
            name.Contains('\0'))
        {
            return false;
        }
        var normalized = name.EndsWith('/') ? name[..^1] : name;
        return normalized.Length > 0 && !normalized.Split('/').Any(part => part is "" or "." or "..");
    }

    private static bool IsMacroPart(string name) =>
        name.EndsWith(".bin", StringComparison.OrdinalIgnoreCase) ||
        name.Contains("vbaProject", StringComparison.OrdinalIgnoreCase) ||
        name.Contains("macros", StringComparison.OrdinalIgnoreCase) ||
        name.EndsWith(".vsdm", StringComparison.OrdinalIgnoreCase);

    private static bool IsVisioPageEntry(string name)
    {
        const string prefix = "visio/pages/page";
        const string suffix = ".xml";
        if (!name.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) ||
            !name.EndsWith(suffix, StringComparison.OrdinalIgnoreCase) ||
            name.Contains("/_rels/", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }
        var number = name[prefix.Length..^suffix.Length];
        return number.Length > 0 && number.All(char.IsAsciiDigit);
    }

    private IReadOnlyList<VisioImportPage> ReadVisioPages(ZipArchive archive, IReadOnlyList<ZipArchiveEntry> entries)
    {
        var result = new List<VisioImportPage>();
        var pagesEntry = archive.GetEntry("visio/pages/pages.xml");
        var relsEntry = archive.GetEntry("visio/pages/_rels/pages.xml.rels");
        if (pagesEntry is not null && relsEntry is not null)
        {
            var relationships = ReadXml(relsEntry).Descendants()
                .Where(element => element.Name.LocalName == "Relationship")
                .Where(element => (string?)element.Attribute("Id") is not null)
                .ToDictionary(element => (string)element.Attribute("Id")!, element => (string?)element.Attribute("Target") ?? "");
            var number = 0;
            foreach (var page in ReadXml(pagesEntry).Descendants().Where(element => element.Name.LocalName == "Page"))
            {
                number++;
                var relationship = page.Elements().FirstOrDefault(element => element.Name.LocalName == "Rel")?
                    .Attributes().FirstOrDefault(attribute => attribute.Name.LocalName == "id")?.Value;
                if (relationship is null || !relationships.TryGetValue(relationship, out var target)) continue;
                var path = target.StartsWith("/visio/pages/", StringComparison.Ordinal) ? target[1..]
                    : target.StartsWith("visio/pages/", StringComparison.Ordinal) ? target : $"visio/pages/{target}";
                if (!entries.Any(entry => entry.FullName == path)) continue;
                if (result.Any(item => item.Id == path)) throw new InvalidDataException("Een pagina-part is meerdere keren opgenomen in de paginalijst.");
                var name = NormalizeText((string?)page.Attribute("Name") ?? (string?)page.Attribute("NameU"));
                result.Add(new(path, string.IsNullOrWhiteSpace(name) ? $"Pagina {number}" : name,
                    number, (string?)page.Attribute("Background") is "1" or "true"));
            }
        }
        foreach (var entry in entries.Where(entry => result.All(item => item.Id != entry.FullName)))
        {
            // Older/simple packages can omit the page manifest relationships.
            result.Add(new(entry.FullName, $"Pagina {result.Count + 1}", result.Count + 1, false));
        }
        return result;
    }

    private void ApplyVisioMasterDefaults(ZipArchive archive, XDocument page)
    {
        var mastersEntry = archive.GetEntry("visio/masters/masters.xml");
        var relsEntry = archive.GetEntry("visio/masters/_rels/masters.xml.rels");
        if (mastersEntry is null || relsEntry is null) return;
        var rels = ReadXml(relsEntry).Descendants().Where(element => element.Name.LocalName == "Relationship")
            .Where(element => (string?)element.Attribute("Id") is not null)
            .ToDictionary(element => (string)element.Attribute("Id")!, element => (string?)element.Attribute("Target") ?? "");
        var templates = new Dictionary<string, XElement>(StringComparer.Ordinal);
        foreach (var master in ReadXml(mastersEntry).Descendants().Where(element => element.Name.LocalName == "Master"))
        {
            var id = (string?)master.Attribute("ID");
            var relationship = master.Elements().FirstOrDefault(element => element.Name.LocalName == "Rel")?
                .Attributes().FirstOrDefault(attribute => attribute.Name.LocalName == "id")?.Value;
            if (id is null || relationship is null || !rels.TryGetValue(relationship, out var target)) continue;
            if (target.Contains('\\') || target.Split('/').Any(part => part is "" or "." or "..")) continue;
            var path = target.StartsWith("visio/masters/", StringComparison.Ordinal) ? target : $"visio/masters/{target}";
            var entry = archive.GetEntry(path);
            if (entry is null) continue;
            var roots = ReadXml(entry).Root?.Elements().FirstOrDefault(element => element.Name.LocalName == "Shapes")?
                .Elements().Where(element => element.Name.LocalName == "Shape").ToList();
            if (roots?.Count == 1) templates[id] = roots[0];
        }
        foreach (var shape in page.Descendants().Where(element => element.Name.LocalName == "Shape").ToList())
        {
            var masterId = (string?)shape.Attribute("Master");
            if (masterId is null || !templates.TryGetValue(masterId, out var template)) continue;
            foreach (var cell in template.Elements().Where(element => element.Name.LocalName == "Cell"))
            {
                var name = (string?)cell.Attribute("N");
                if (name is null) continue;
                var local = shape.Elements().FirstOrDefault(element => element.Name.LocalName == "Cell" && (string?)element.Attribute("N") == name);
                if (local is null) shape.Add(new XElement(cell));
                else if ((string?)local.Attribute("V") is null && (string?)cell.Attribute("V") is string cached)
                    local.SetAttributeValue("V", cached);
            }
            if (shape.Attribute("OneD") is null && template.Attribute("OneD") is { } oneD)
                shape.SetAttributeValue("OneD", oneD.Value);
        }
    }

    private static double? VisioCellNumber(XElement shape, string name) => ParseVisioNumber(
        (string?)shape.Elements().FirstOrDefault(element => element.Name.LocalName == "Cell" &&
            string.Equals((string?)element.Attribute("N"), name, StringComparison.OrdinalIgnoreCase))?.Attribute("V"));

    private Dictionary<string, string> ReadVisioMasterHints(ZipArchive archive)
    {
        var entry = archive.GetEntry("visio/masters/masters.xml");
        if (entry is null) return new(StringComparer.OrdinalIgnoreCase);

        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var master in ReadXml(entry).Descendants().Where(element => element.Name.LocalName == "Master"))
        {
            var id = (string?)master.Attribute("ID");
            if (string.IsNullOrWhiteSpace(id)) continue;
            result[id] = NormalizeText(string.Join(
                " ",
                (string?)master.Attribute("NameU"),
                (string?)master.Attribute("Name")));
        }
        return result;
    }

    private Dictionary<string, double?> ReadVisioPageHeights(ZipArchive archive)
    {
        var result = new Dictionary<string, double?>(StringComparer.OrdinalIgnoreCase);
        var pagesEntry = archive.GetEntry("visio/pages/pages.xml");
        var relationshipsEntry = archive.GetEntry("visio/pages/_rels/pages.xml.rels");
        if (pagesEntry is null || relationshipsEntry is null) return result;

        var relationships = ReadXml(relationshipsEntry)
            .Descendants()
            .Where(element => element.Name.LocalName == "Relationship")
            .Select(element => (
                Id: (string?)element.Attribute("Id"),
                Target: (string?)element.Attribute("Target")))
            .Where(item => !string.IsNullOrWhiteSpace(item.Id) && !string.IsNullOrWhiteSpace(item.Target))
            .ToDictionary(item => item.Id!, item => item.Target!, StringComparer.OrdinalIgnoreCase);
        foreach (var page in ReadXml(pagesEntry).Descendants().Where(element => element.Name.LocalName == "Page"))
        {
            var relationshipId = page.Elements()
                .FirstOrDefault(element => element.Name.LocalName == "Rel")?.Attributes()
                .FirstOrDefault(attribute => attribute.Name.LocalName == "id")?.Value;
            if (string.IsNullOrWhiteSpace(relationshipId) ||
                !relationships.TryGetValue(relationshipId, out var target) ||
                target.Contains('\\') ||
                target.Split('/').Any(part => part is "" or "." or ".."))
            {
                continue;
            }
            var pageHeight = page.Elements()
                .FirstOrDefault(element => element.Name.LocalName == "PageSheet")?.Elements()
                .FirstOrDefault(element =>
                    element.Name.LocalName == "Cell" &&
                    string.Equals((string?)element.Attribute("N"), "PageHeight", StringComparison.OrdinalIgnoreCase))?.Attribute("V")?.Value;
            var normalizedTarget = target.StartsWith("visio/", StringComparison.OrdinalIgnoreCase)
                ? target
                : $"visio/pages/{target}";
            result[normalizedTarget] = ParseVisioNumber(pageHeight);
        }
        return result;
    }

    private static VisioShapeInfo CreateVisioShapeInfo(
        XElement shape,
        IReadOnlyDictionary<string, string> masterHints)
    {
        var externalId = (string?)shape.Attribute("ID") ?? "";
        var masterId = (string?)shape.Attribute("Master");
        var masterHint = !string.IsNullOrWhiteSpace(masterId) && masterHints.TryGetValue(masterId, out var value)
            ? value
            : "";
        var hint = NormalizeText(string.Join(
            " ",
            (string?)shape.Attribute("NameU"),
            (string?)shape.Attribute("Name"),
            masterHint));
        var text = NormalizeText(string.Join(
            " ",
            shape.Descendants().Where(element => element.Name.LocalName == "Text").Select(element => element.Value)));
        var oneDimensional =
            string.Equals((string?)shape.Attribute("OneD"), "1", StringComparison.OrdinalIgnoreCase) ||
            shape.Elements().Any(element =>
                element.Name.LocalName == "Cell" &&
                string.Equals((string?)element.Attribute("N"), "OneD", StringComparison.OrdinalIgnoreCase) &&
                string.Equals((string?)element.Attribute("V"), "1", StringComparison.OrdinalIgnoreCase));
        return new(shape, externalId, text, hint, ReadVisioBounds(shape), oneDimensional);
    }

    private static VisioBounds? ReadVisioBounds(XElement shape)
    {
        var cells = shape.Elements()
            .Where(element => element.Name.LocalName == "Cell")
            .Select(element => (
                Name: (string?)element.Attribute("N"),
                Value: ParseVisioNumber((string?)element.Attribute("V"))))
            .Where(cell => !string.IsNullOrWhiteSpace(cell.Name))
            .GroupBy(cell => cell.Name!, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.First().Value, StringComparer.OrdinalIgnoreCase);
        var pinX = cells.GetValueOrDefault("PinX");
        var pinY = cells.GetValueOrDefault("PinY");
        var width = cells.GetValueOrDefault("Width");
        var height = cells.GetValueOrDefault("Height");
        if (pinX is null || pinY is null || width is null || height is null || width <= 0 || height <= 0)
        {
            return null;
        }
        return new(pinX.Value - (cells.GetValueOrDefault("LocPinX") ?? width.Value / 2),
            pinY.Value - (cells.GetValueOrDefault("LocPinY") ?? height.Value / 2), width.Value, height.Value);
    }

    private static bool IsExplicitLaneHint(string hint) =>
        ContainsHintToken(hint, "swimlane") ||
        ContainsHintToken(hint, "lane") ||
        hint.Contains("functional band", StringComparison.OrdinalIgnoreCase) ||
        hint.Contains("functionalband", StringComparison.OrdinalIgnoreCase);

    private static bool IsExplicitContainerHint(string hint) =>
        ContainsHintToken(hint, "container");

    private static bool IsConnectorHint(string hint) =>
        ContainsHintToken(hint, "connector") ||
        hint.Contains("dynamic connector", StringComparison.OrdinalIgnoreCase);

    private static string? ClassifyFlowShape(VisioShapeInfo shape)
    {
        var hint = shape.Hint.ToLowerInvariant();
        var text = shape.Text.ToLowerInvariant();
        if (ContainsHintToken(hint, "decision") ||
            ContainsHintToken(hint, "diamond") ||
            ContainsHintToken(hint, "gateway") ||
            ContainsHintToken(hint, "beslissing"))
        {
            return "beslissing";
        }
        if (ContainsHintToken(hint, "process") ||
            ContainsHintToken(hint, "subprocess") ||
            ContainsHintToken(hint, "activity") ||
            ContainsHintToken(hint, "task") ||
            ContainsHintToken(hint, "proces") ||
            ContainsHintToken(hint, "actie"))
        {
            return "actie";
        }
        if (IsExplicitStartLabel(text) &&
            (ContainsHintToken(hint, "start") || ContainsHintToken(hint, "terminator")))
        {
            return "start";
        }
        if (IsExplicitEndLabel(text) &&
            (ContainsHintToken(hint, "end") || ContainsHintToken(hint, "terminator")))
        {
            return "eind";
        }
        if (ContainsHintToken(hint, "terminator") ||
            ContainsHintToken(hint, "start") && ContainsHintToken(hint, "end"))
        {
            return "terminator";
        }
        return null;
    }

    private static bool IsExplicitStartLabel(string text) =>
        text is "start" or "begin" or "beginnen" ||
        text.StartsWith("start:", StringComparison.Ordinal) ||
        text.StartsWith("begin:", StringComparison.Ordinal);

    private static bool IsExplicitEndLabel(string text) =>
        text is "end" or "eind" or "einde" or "stop" ||
        text.StartsWith("end:", StringComparison.Ordinal) ||
        text.StartsWith("eind:", StringComparison.Ordinal) ||
        text.StartsWith("einde:", StringComparison.Ordinal);

    private static bool ContainsHintToken(string value, string token) =>
        value.Split(
                [' ', '\t', '\r', '\n', '-', '_', '/', '\\', '.', ':', ';', '(', ')', '[', ']'],
                StringSplitOptions.RemoveEmptyEntries)
            .Contains(token, StringComparer.OrdinalIgnoreCase);

    private static string NormalizeText(string? value) =>
        string.IsNullOrWhiteSpace(value)
            ? ""
            : string.Join(" ", value.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));

    private static HashSet<string> TraverseConnections(
        IEnumerable<string> startingIds,
        IReadOnlyList<VisioFlowConnection> connections,
        Func<VisioFlowConnection, string> from,
        Func<VisioFlowConnection, string> to)
    {
        var visited = new HashSet<string>(startingIds, StringComparer.OrdinalIgnoreCase);
        var pending = new Queue<string>(visited);
        while (pending.TryDequeue(out var current))
        {
            foreach (var target in connections.Where(connection =>
                         from(connection).Equals(current, StringComparison.OrdinalIgnoreCase)).Select(to))
            {
                if (visited.Add(target)) pending.Enqueue(target);
            }
        }
        return visited;
    }

    private static object LucidShape(
        string id,
        string type,
        string text,
        double x,
        double y,
        double width,
        double height,
        string color,
        string kind,
        string semanticId,
        object data) => new
    {
        id,
        type,
        boundingBox = new { x, y, w = width, h = height },
        style = new
        {
            fill = new { type = "color", color = "#ffffff" },
            stroke = new { color, width = 2, style = "solid" },
            rounding = 8,
            textColor = "#1f2937"
        },
        text,
        customData = new[]
        {
            Datum("spgSchema", SpgSchema),
            Datum("spgKind", kind),
            Datum("spgId", semanticId),
            Datum("spgData", JsonSerializer.Serialize(data, ProcessJson.Options))
        },
        zIndex = kind == "lane" ? 0 : kind == "section" ? 1 : 2
    };

    private static object LucidLine(
        string id,
        string sourceShapeId,
        string targetShapeId,
        string label,
        string kind,
        string sourceStepId,
        string? routeId) => new
    {
        id,
        lineType = "elbow",
        endpoint1 = new { type = "shapeEndpoint", style = "none", shapeId = sourceShapeId },
        endpoint2 = new { type = "shapeEndpoint", style = "arrow", shapeId = targetShapeId },
        stroke = new { color = kind == "message" ? "#ea5b0c" : "#8b8b95", width = 2, style = "solid" },
        text = string.IsNullOrWhiteSpace(label)
            ? Array.Empty<object>()
            : new object[] { new { text = label, position = 0.5, side = "middle" } },
        customData = new[]
        {
            Datum("spgSchema", SpgSchema),
            Datum("spgKind", kind),
            Datum("spgSourceStepId", sourceStepId),
            Datum("spgRouteId", routeId ?? "")
        },
        zIndex = 3
    };

    private static object Datum(string key, string value) => new { key, value };

    private static Dictionary<string, int> BuildStepPositions(ProcessDocument process)
    {
        var result = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var y = StartY;
        foreach (var section in process.Secties)
        {
            y += SectionHeight;
            foreach (var step in process.Stappen.Where(step => step.SectieId == section.Id))
            {
                result[step.Id] = y;
                y += RowHeight;
            }
            y += 12;
        }
        foreach (var step in process.Stappen.Where(step =>
                     string.IsNullOrWhiteSpace(step.SectieId) ||
                     !process.Secties.Any(section => section.Id == step.SectieId)))
        {
            result[step.Id] = y;
            y += RowHeight;
        }
        return result;
    }

    private static VisioExportLayout BuildVisioExportLayout(
        ProcessDocument process,
        ICollection<DiagramExchangeIssue> warnings)
    {
        var automaticY = BuildStepPositions(process);
        var steps = new Dictionary<string, VisioExportBounds>(StringComparer.OrdinalIgnoreCase);
        foreach (var step in process.Stappen)
        {
            var laneIndex = IndexOfLane(process.Lanes, step.LaneId);
            if (laneIndex < 0)
            {
                warnings.Add(new(
                    "unknown-lane",
                    $"Stap '{step.Id}' verwijst naar een onbekende rol en is in de eerste lane geplaatst.",
                    step.Id));
                laneIndex = 0;
            }
            var fallback = new VisioExportBounds(
                laneIndex * LaneWidth + (LaneWidth - StepWidth) / 2d,
                automaticY.GetValueOrDefault(step.Id, StartY),
                StepWidth,
                StepHeight);
            var placement = DiagramPlacement(process, $"step:{step.Id}");
            if (placement is not null &&
                ValidVisioCoordinate(placement.X) &&
                ValidVisioCoordinate(placement.Y) &&
                ValidVisioSize(placement.Width) &&
                ValidVisioSize(placement.Height))
            {
                steps[step.Id] = new(
                    placement.X,
                    placement.Y,
                    placement.Width ?? StepWidth,
                    placement.Height ?? StepHeight);
            }
            else
            {
                if (placement is not null)
                {
                    warnings.Add(new(
                        "invalid-manual-geometry",
                        $"Ongeldige handmatige geometrie van stap '{step.Id}' is vervangen door auto-layout.",
                        step.Id));
                }
                steps[step.Id] = fallback;
            }
        }

        var laneSpan = Math.Max(LaneWidth, process.Lanes.Count * LaneWidth);
        var sections = new Dictionary<string, VisioExportBounds>(StringComparer.OrdinalIgnoreCase);
        foreach (var section in process.Secties)
        {
            var firstStepY = process.Stappen
                .Where(step => string.Equals(step.SectieId, section.Id, StringComparison.OrdinalIgnoreCase))
                .Select(step => steps[step.Id].Y)
                .DefaultIfEmpty(StartY + SectionHeight)
                .Min();
            sections[section.Id] = new(0, Math.Max(0, firstStepY - SectionHeight), laneSpan, 32);
        }

        var contentRight = Math.Max(
            laneSpan,
            steps.Values.Select(bounds => bounds.Right).DefaultIfEmpty(laneSpan).Max());
        var contentBottom = Math.Max(
            520,
            steps.Values.Select(bounds => bounds.Bottom).DefaultIfEmpty(0).Concat(
                sections.Values.Select(bounds => bounds.Bottom)).DefaultIfEmpty(0).Max() + 40);
        var pageWidth = Math.Max(800, contentRight + 40);
        var pageHeight = Math.Max(600, contentBottom + 40);
        var lanes = new Dictionary<string, VisioExportBounds>(StringComparer.OrdinalIgnoreCase);
        for (var index = 0; index < process.Lanes.Count; index++)
        {
            lanes[process.Lanes[index].Id] = new(index * LaneWidth, 0, LaneWidth, pageHeight - 40);
        }

        return new(pageWidth, pageHeight, lanes, sections, steps);
    }

    private static ProcessNodePlacement? DiagramPlacement(ProcessDocument process, string key)
    {
        var diagram = process.DiagramLayout;
        if (diagram is null ||
            diagram.Version != 1 ||
            !diagram.CoordinateSystem.Equals("px96-y-down", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }
        if (diagram.Nodes.TryGetValue(key, out var exact)) return exact;
        return diagram.Nodes.FirstOrDefault(pair =>
            pair.Key.Equals(key, StringComparison.OrdinalIgnoreCase)).Value;
    }

    private static bool ValidVisioCoordinate(double value) =>
        double.IsFinite(value) && value >= 0 && value <= 1_000_000;

    private static bool ValidVisioSize(double? value) =>
        value is null || double.IsFinite(value.Value) && value.Value > 0 && value.Value <= 1_000_000;

    private static XElement CreateVisioShape(
        int shapeId,
        string name,
        string text,
        VisioExportBounds bounds,
        double pageHeightPx,
        string color,
        string visualKind,
        string semanticKind,
        string semanticId,
        string semanticData,
        bool hidden = false)
    {
        var width = bounds.Width / PixelsPerInch;
        var height = bounds.Height / PixelsPerInch;
        var pinX = (bounds.X + bounds.Width / 2) / PixelsPerInch;
        var pinY = (pageHeightPx - bounds.Y - bounds.Height / 2) / PixelsPerInch;
        var shape = new XElement(
            VisioNs + "Shape",
            new XAttribute("ID", shapeId),
            new XAttribute("NameU", SafeXmlText(name, 255)),
            new XAttribute("Type", "Shape"),
            VisioCell("PinX", pinX),
            VisioCell("PinY", pinY),
            VisioCell("Width", width),
            VisioCell("Height", height),
            VisioCell("LocPinX", width / 2, "Width*0.5"),
            VisioCell("LocPinY", height / 2, "Height*0.5"),
            VisioCell("Angle", 0),
            VisioCell("FlipX", 0),
            VisioCell("FlipY", 0),
            VisioCell("ResizeMode", 0),
            VisioCell("FillForegnd", 1, VisioColorFormula(hidden ? "#ffffff" : LightVisioFill(color, visualKind))),
            VisioCell("FillPattern", hidden ? 0 : 1),
            VisioCell("LineColor", 0, VisioColorFormula(color)),
            VisioCell("LinePattern", hidden ? 0 : 1),
            VisioCell("LineWeight", hidden ? 0 : 1.5 / 72),
            VisioCell(
                "Rounding",
                visualKind is "start" or "eind" or "marker"
                    ? Math.Min(width, height) / 2
                    : visualKind is "actie" or "bericht" or "subproces"
                        ? 0.08
                        : 0),
            VisioTextCells(width, height, visualKind),
            VisioMetadata(semanticKind, semanticId, semanticData));

        if (!hidden)
        {
            shape.Add(VisioGeometry(width, height, visualKind));
            shape.Add(VisioTextFormatting());
            shape.Add(new XElement(VisioNs + "Text", SafeXmlText(text, 4_000)));
        }
        return shape;
    }

    private static XElement CreateVisioConnector(
        int shapeId,
        string semanticId,
        string kind,
        VisioExportPoint begin,
        VisioExportPoint end,
        double pageHeightPx,
        string label,
        string color)
    {
        var beginX = begin.X / PixelsPerInch;
        var beginY = (pageHeightPx - begin.Y) / PixelsPerInch;
        var endX = end.X / PixelsPerInch;
        var endY = (pageHeightPx - end.Y) / PixelsPerInch;
        var deltaX = endX - beginX;
        var deltaY = endY - beginY;
        var shape = new XElement(
            VisioNs + "Shape",
            new XAttribute("ID", shapeId),
            new XAttribute("NameU", $"Dynamic connector {SafeVisioName(semanticId)}"),
            new XAttribute("Type", "Shape"),
            new XAttribute("OneD", "1"),
            VisioCell("BeginX", beginX),
            VisioCell("BeginY", beginY),
            VisioCell("EndX", endX),
            VisioCell("EndY", endY),
            VisioCell("Width", deltaX),
            VisioCell("Height", deltaY),
            VisioCell("LocPinX", deltaX / 2),
            VisioCell("LocPinY", deltaY / 2),
            VisioCell("LineColor", 0, VisioColorFormula(color)),
            VisioCell("LinePattern", 1),
            VisioCell("LineWeight", 1.4 / 72),
            VisioCell("BeginArrow", 0),
            VisioCell("EndArrow", 13),
            VisioCell("EndArrowSize", 2),
            VisioMetadata(kind, semanticId, "{}"),
            new XElement(
                VisioNs + "Section",
                new XAttribute("N", "Geometry"),
                new XAttribute("IX", "0"),
                new XElement(
                    VisioNs + "Row",
                    new XAttribute("T", "MoveTo"),
                    new XAttribute("IX", "1"),
                    VisioCell("X", 0),
                    VisioCell("Y", 0)),
                new XElement(
                    VisioNs + "Row",
                    new XAttribute("T", "LineTo"),
                    new XAttribute("IX", "2"),
                    VisioCell("X", deltaX, "Width"),
                    VisioCell("Y", deltaY, "Height"))),
            VisioTextFormatting());
        if (!string.IsNullOrWhiteSpace(label))
        {
            shape.Add(new XElement(VisioNs + "Text", SafeXmlText(label, 512)));
        }
        return shape;
    }

    private static IEnumerable<XElement> VisioTextCells(double width, double height, string visualKind)
    {
        var textHeight = visualKind == "lane" ? Math.Min(0.42, height) : Math.Max(0.1, height - 0.12);
        var textPinY = visualKind == "lane" ? Math.Max(textHeight / 2, height - textHeight / 2) : height / 2;
        return
        [
            VisioCell("TxtPinX", width / 2),
            VisioCell("TxtPinY", textPinY),
            VisioCell("TxtWidth", Math.Max(0.1, width - 0.12)),
            VisioCell("TxtHeight", textHeight),
            VisioCell("TxtLocPinX", Math.Max(0.05, width - 0.12) / 2),
            VisioCell("TxtLocPinY", textHeight / 2),
            VisioCell("LeftMargin", 0.06),
            VisioCell("RightMargin", 0.06),
            VisioCell("TopMargin", 0.03),
            VisioCell("BottomMargin", 0.03)
        ];
    }

    private static XElement VisioTextFormatting() =>
        new(
            VisioNs + "Section",
            new XAttribute("N", "Paragraph"),
            new XElement(
                VisioNs + "Row",
                new XAttribute("IX", "0"),
                VisioCell("HorzAlign", 1),
                VisioCell("SpBefore", 0),
                VisioCell("SpAfter", 0),
                VisioCell("SpLine", -1)),
            new XElement(
                VisioNs + "Row",
                new XAttribute("IX", "1"),
                VisioCell("HorzAlign", 1)));

    private static XElement VisioGeometry(double width, double height, string visualKind)
    {
        var points = visualKind == "beslissing"
            ? new[]
            {
                new VisioExportPoint(width / 2, 0),
                new VisioExportPoint(width, height / 2),
                new VisioExportPoint(width / 2, height),
                new VisioExportPoint(0, height / 2),
                new VisioExportPoint(width / 2, 0)
            }
            : new[]
            {
                new VisioExportPoint(0, 0),
                new VisioExportPoint(width, 0),
                new VisioExportPoint(width, height),
                new VisioExportPoint(0, height),
                new VisioExportPoint(0, 0)
            };
        return new XElement(
            VisioNs + "Section",
            new XAttribute("N", "Geometry"),
            new XAttribute("IX", "0"),
            points.Select((point, index) =>
                new XElement(
                    VisioNs + "Row",
                    new XAttribute("T", index == 0 ? "MoveTo" : "LineTo"),
                    new XAttribute("IX", index + 1),
                    VisioCell("X", point.X),
                    VisioCell("Y", point.Y))));
    }

    private static XElement VisioMetadata(string kind, string semanticId, string semanticData) =>
        new(
            VisioNs + "Section",
            new XAttribute("N", "Property"),
            VisioProperty("spgSchema", SpgSchema),
            VisioProperty("spgKind", kind),
            VisioProperty("spgId", semanticId),
            VisioProperty("spgData", semanticData));

    private static XElement VisioProperty(string name, string value) =>
        new(
            VisioNs + "Row",
            new XAttribute("N", $"Prop.{SafeVisioName(name)}"),
            VisioCell("Value", VisioStringFormula(value), null, "STR"));

    private static XElement VisioCell(
        string name,
        double value,
        string? formula = null,
        string? unit = null) =>
        VisioCell(name, Invariant(value), formula, unit);

    private static XElement VisioCell(
        string name,
        string value,
        string? formula = null,
        string? unit = null)
    {
        var element = new XElement(
            VisioNs + "Cell",
            new XAttribute("N", name),
            new XAttribute("V", value));
        if (!string.IsNullOrWhiteSpace(formula)) element.Add(new XAttribute("F", formula));
        if (!string.IsNullOrWhiteSpace(unit)) element.Add(new XAttribute("U", unit));
        return element;
    }

    private static string VisioStringFormula(string value) =>
        $"\"{value.Replace("\"", "\"\"", StringComparison.Ordinal)}\"";

    private static string Invariant(double value) =>
        value.ToString("0.##########", System.Globalization.CultureInfo.InvariantCulture);

    private static string VisioColorFormula(string color)
    {
        var normalized = color.Trim().TrimStart('#');
        if (normalized.Length != 6 ||
            !int.TryParse(normalized[..2], System.Globalization.NumberStyles.HexNumber, null, out var red) ||
            !int.TryParse(normalized[2..4], System.Globalization.NumberStyles.HexNumber, null, out var green) ||
            !int.TryParse(normalized[4..], System.Globalization.NumberStyles.HexNumber, null, out var blue))
        {
            return "RGB(156,163,175)";
        }
        return $"RGB({red},{green},{blue})";
    }

    private static string LightVisioFill(string color, string visualKind)
    {
        if (visualKind == "section") return "#f3f4f6";
        var normalized = color.Trim().TrimStart('#');
        if (normalized.Length != 6 ||
            !int.TryParse(normalized[..2], System.Globalization.NumberStyles.HexNumber, null, out var red) ||
            !int.TryParse(normalized[2..4], System.Globalization.NumberStyles.HexNumber, null, out var green) ||
            !int.TryParse(normalized[4..], System.Globalization.NumberStyles.HexNumber, null, out var blue))
        {
            return "#f3f4f6";
        }
        var ratio = visualKind == "lane" ? 0.88 : 0.82;
        red = (int)Math.Round(red + (255 - red) * ratio);
        green = (int)Math.Round(green + (255 - green) * ratio);
        blue = (int)Math.Round(blue + (255 - blue) * ratio);
        return $"#{red:X2}{green:X2}{blue:X2}";
    }

    private static string VisioShapeName(string type, string id) =>
        type.ToLowerInvariant() switch
        {
            "beslissing" => $"Decision {SafeVisioName(id)}",
            "start" => $"Start {SafeVisioName(id)}",
            "eind" => $"End {SafeVisioName(id)}",
            "subproces" => $"Subprocess {SafeVisioName(id)}",
            "bericht" => $"Message {SafeVisioName(id)}",
            "marker" => $"Marker {SafeVisioName(id)}",
            _ => $"Process {SafeVisioName(id)}"
        };

    private static string SafeVisioName(string value)
    {
        var chars = value.Select(character =>
            char.IsAsciiLetterOrDigit(character) || character is '-' or '_' ? character : '-').ToArray();
        var result = new string(chars).Trim('-');
        return string.IsNullOrWhiteSpace(result) ? "item" : result[..Math.Min(result.Length, 96)];
    }

    private static string SafeXmlText(string value, int maxLength)
    {
        var sanitized = new string(value
            .Where(character =>
                character is '\t' or '\n' or '\r' ||
                character >= ' ' && character is not '\uFFFE' and not '\uFFFF')
            .Take(maxLength)
            .ToArray());
        return sanitized;
    }

    private static (VisioExportPoint Begin, VisioExportPoint End) VisioConnectorPoints(
        VisioExportBounds source,
        VisioExportBounds target)
    {
        var deltaX = target.CenterX - source.CenterX;
        var deltaY = target.CenterY - source.CenterY;
        if (Math.Abs(deltaY) >= Math.Abs(deltaX))
        {
            return deltaY >= 0
                ? (new(source.CenterX, source.Bottom), new(target.CenterX, target.Y))
                : (new(source.CenterX, source.Y), new(target.CenterX, target.Bottom));
        }
        return deltaX >= 0
            ? (new(source.Right, source.CenterY), new(target.X, target.CenterY))
            : (new(source.X, source.CenterY), new(target.Right, target.CenterY));
    }

    private static XElement VisioContentType(string partName, string contentType) =>
        new(
            ContentTypeNs + "Override",
            new XAttribute("PartName", partName),
            new XAttribute("ContentType", contentType));

    private static XDocument Relationships(params XElement[] relationships) =>
        new(
            new XDeclaration("1.0", "UTF-8", null),
            new XElement(RelationshipNs + "Relationships", relationships));

    private static XElement Relationship(string id, string type, string target) =>
        new(
            RelationshipNs + "Relationship",
            new XAttribute("Id", id),
            new XAttribute("Type", type),
            new XAttribute("Target", target));

    private static void AddZipXml(ZipArchive archive, string name, XDocument document)
    {
        var entry = archive.CreateEntry(name, CompressionLevel.Optimal);
        entry.LastWriteTime = new DateTimeOffset(1980, 1, 1, 0, 0, 0, TimeSpan.Zero);
        using var stream = entry.Open();
        using var writer = XmlWriter.Create(stream, new XmlWriterSettings
        {
            Encoding = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false),
            Indent = false,
            CloseOutput = false,
            OmitXmlDeclaration = false
        });
        document.Save(writer);
    }

    private static int IndexOfLane(IReadOnlyList<Lane> lanes, string id)
    {
        for (var index = 0; index < lanes.Count; index++)
        {
            if (lanes[index].Id.Equals(id, StringComparison.OrdinalIgnoreCase)) return index;
        }
        return -1;
    }

    private static string LucidShapeType(string type) => type.ToLowerInvariant() switch
    {
        "beslissing" => "decision",
        "start" or "eind" => "terminator",
        _ => "process"
    };

    private static string StableExternalId(string kind, string semanticId)
    {
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"{kind}:{semanticId}")))
            .ToLowerInvariant()[..16];
        return $"spg-{kind[..Math.Min(kind.Length, 8)]}-{hash}";
    }

    private static string SafeFilePart(string value)
    {
        var chars = value.Select(character =>
            char.IsAsciiLetterOrDigit(character) || character is '-' or '_' ? char.ToLowerInvariant(character) : '-').ToArray();
        var result = new string(chars).Trim('-');
        return string.IsNullOrWhiteSpace(result) ? "proces" : result;
    }

    private static string? CustomDataValue(JsonElement element, string key)
    {
        if (!element.TryGetProperty("customData", out var data) || data.ValueKind != JsonValueKind.Array) return null;
        foreach (var item in data.EnumerateArray())
        {
            if (StringProperty(item, "key") == key) return StringProperty(item, "value");
        }
        return null;
    }

    private static string? StringProperty(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static bool SemanticElementExists(ProcessDocument process, string kind, string id) => kind switch
    {
        "lane" => process.Lanes.Any(lane => lane.Id.Equals(id, StringComparison.OrdinalIgnoreCase)),
        "section" => process.Secties.Any(section => section.Id.Equals(id, StringComparison.OrdinalIgnoreCase)),
        "step" => process.Stappen.Any(step => step.Id.Equals(id, StringComparison.OrdinalIgnoreCase)),
        _ => false
    };

    private static ProcessDocument ApplyLucidShapeEdits(
        ProcessDocument process,
        IReadOnlyDictionary<string, List<LucidShapeEdit>> editsBySemanticId,
        ICollection<DiagramExchangeIssue> warnings,
        ICollection<DiagramExchangeIssue> unmapped)
    {
        foreach (var edits in editsBySemanticId.Values)
        {
            var edit = edits[0];
            if (edits.Count != 1)
            {
                unmapped.Add(new(
                    "duplicate-semantic-shape",
                    $"Meerdere Lucid-shapes verwijzen naar SPG-{edit.Kind} '{edit.SemanticId}'; labels zijn niet toegepast.",
                    edit.ExternalId));
                continue;
            }
            if (string.IsNullOrWhiteSpace(edit.Text))
            {
                warnings.Add(new(
                    "empty-label-not-applied",
                    $"Een leeg label voor SPG-{edit.Kind} '{edit.SemanticId}' is niet toegepast.",
                    edit.ExternalId));
                continue;
            }

            process = edit.Kind switch
            {
                "lane" => process with
                {
                    Lanes = process.Lanes.Select(lane =>
                        lane.Id.Equals(edit.SemanticId, StringComparison.OrdinalIgnoreCase)
                            ? lane with { Naam = edit.Text }
                            : lane).ToList()
                },
                "section" => process with
                {
                    Secties = process.Secties.Select(section =>
                        section.Id.Equals(edit.SemanticId, StringComparison.OrdinalIgnoreCase)
                            ? section with { Naam = edit.Text }
                            : section).ToList()
                },
                "step" => process with
                {
                    Stappen = process.Stappen.Select(step =>
                        step.Id.Equals(edit.SemanticId, StringComparison.OrdinalIgnoreCase)
                            ? step with { Activiteit = edit.Text }
                            : step).ToList()
                },
                _ => process
            };
        }
        return process;
    }

    private static bool TryApplyLucidLineEdit(
        ref ProcessDocument process,
        JsonElement line,
        string externalId,
        string kind,
        string sourceStepId,
        LucidSemanticReference target,
        ICollection<DiagramExchangeIssue> warnings,
        ICollection<DiagramExchangeIssue> unmapped)
    {
        var sourceStep = process.Stappen.SingleOrDefault(step =>
            step.Id.Equals(sourceStepId, StringComparison.OrdinalIgnoreCase));
        if (sourceStep is null)
        {
            unmapped.Add(new("line-source-unknown", $"SPG-line verwijst naar onbekende bronstap '{sourceStepId}'.", externalId));
            return false;
        }

        if (kind == "transition")
        {
            if (target.Kind != "step" || string.IsNullOrWhiteSpace(sourceStep.NaarStap))
            {
                unmapped.Add(new(
                    "transition-edit-invalid",
                    "Alleen het doel van een bestaande SPG-transition naar een herkende stap kan worden gewijzigd.",
                    externalId));
                return false;
            }
            process = ReplaceStep(process, sourceStep with { NaarStap = target.SemanticId });
            return true;
        }

        if (kind == "message")
        {
            if (target.Kind != "lane" ||
                !sourceStep.Type.Equals("bericht", StringComparison.OrdinalIgnoreCase) ||
                string.IsNullOrWhiteSpace(sourceStep.DoelLaneId))
            {
                unmapped.Add(new(
                    "message-edit-invalid",
                    "Alleen het doel van een bestaande berichtlijn naar een herkende lane kan worden gewijzigd.",
                    externalId));
                return false;
            }
            process = ReplaceStep(process, sourceStep with { DoelLaneId = target.SemanticId });
            return true;
        }

        var routeId = CustomDataValue(line, "spgRouteId");
        var matchingRoutes = (sourceStep.Routes ?? [])
            .Where(route => route.Id.Equals(routeId, StringComparison.OrdinalIgnoreCase))
            .ToList();
        if (target.Kind != "step" || string.IsNullOrWhiteSpace(routeId) || matchingRoutes.Count != 1)
        {
            unmapped.Add(new(
                "route-edit-invalid",
                "Bestaande SPG-route kon niet eenduidig aan een route en doelstap worden gekoppeld.",
                externalId));
            return false;
        }

        var label = LucidLineLabel(line);
        if (string.IsNullOrWhiteSpace(label))
        {
            label = matchingRoutes[0].Label;
            warnings.Add(new(
                "empty-route-label-not-applied",
                $"Leeg label op route '{routeId}' is niet toegepast.",
                externalId));
        }
        var routes = sourceStep.Routes!.Select(route =>
            route.Id.Equals(routeId, StringComparison.OrdinalIgnoreCase)
                ? route with { Label = label, NaarStap = target.SemanticId }
                : route).ToList();
        process = ReplaceStep(process, sourceStep with { Routes = routes });
        return true;
    }

    private static ProcessDocument ReplaceStep(ProcessDocument process, Step replacement) =>
        process with
        {
            Stappen = process.Stappen.Select(step =>
                step.Id.Equals(replacement.Id, StringComparison.OrdinalIgnoreCase) ? replacement : step).ToList()
        };

    private static string? LucidEndpointShapeId(JsonElement line, string endpointName) =>
        line.TryGetProperty(endpointName, out var endpoint) &&
        endpoint.ValueKind == JsonValueKind.Object
            ? StringProperty(endpoint, "shapeId")
            : null;

    private static string? LucidLineIdentity(JsonElement line)
    {
        var kind = CustomDataValue(line, "spgKind");
        var source = CustomDataValue(line, "spgSourceStepId");
        if (kind is not ("transition" or "route" or "message") || string.IsNullOrWhiteSpace(source))
        {
            return null;
        }
        var route = kind == "route" ? CustomDataValue(line, "spgRouteId") : "";
        return kind == "route" && string.IsNullOrWhiteSpace(route)
            ? null
            : $"{kind}\0{source}\0{route}";
    }

    private static string? LucidLineLabel(JsonElement line)
    {
        if (!line.TryGetProperty("text", out var text)) return null;
        if (text.ValueKind == JsonValueKind.String) return text.GetString();
        if (text.ValueKind != JsonValueKind.Array) return null;
        return string.Join(
            " ",
            text.EnumerateArray()
                .Select(item => item.ValueKind == JsonValueKind.Object ? StringProperty(item, "text") : null)
                .Where(value => !string.IsNullOrWhiteSpace(value)));
    }

    private T? DeserializeMetadata<T>(string json)
    {
        if (json.Length > _limits.MaxMetadataCharacters) return default;
        return JsonSerializer.Deserialize<T>(json, ProcessJson.Options);
    }

    private static DiagramElementGeometry GeometryFromLucid(
        JsonElement shape,
        string externalId,
        string kind,
        string semanticId)
    {
        if (!shape.TryGetProperty("boundingBox", out var box)) return new(externalId, kind, semanticId, null, null, null, null, "px");
        return new(
            externalId,
            kind,
            semanticId,
            Finite(box, "x"),
            Finite(box, "y"),
            Finite(box, "w"),
            Finite(box, "h"),
            "px");
    }

    private static double? Finite(JsonElement element, string property)
    {
        if (!element.TryGetProperty(property, out var value) || !value.TryGetDouble(out var number)) return null;
        return double.IsFinite(number) && Math.Abs(number) <= 1_000_000 ? number : null;
    }

    private Dictionary<string, string> VisioShapeData(XElement shape)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var section in shape.Elements().Where(element =>
                     element.Name.LocalName == "Section" &&
                     string.Equals((string?)element.Attribute("N"), "Property", StringComparison.OrdinalIgnoreCase)))
        {
            foreach (var row in section.Elements().Where(element => element.Name.LocalName == "Row"))
            {
                var rowName = (string?)row.Attribute("N");
                var label = row.Elements().FirstOrDefault(element =>
                    element.Name.LocalName == "Cell" &&
                    string.Equals((string?)element.Attribute("N"), "Label", StringComparison.OrdinalIgnoreCase))?.Attribute("V")?.Value;
                var name = string.IsNullOrWhiteSpace(label) ? rowName : UnquoteVisioValue(label);
                if (name?.StartsWith("Prop.", StringComparison.OrdinalIgnoreCase) == true)
                {
                    name = name["Prop.".Length..];
                }
                var value = row.Elements().FirstOrDefault(element =>
                    element.Name.LocalName == "Cell" &&
                    string.Equals((string?)element.Attribute("N"), "Value", StringComparison.OrdinalIgnoreCase))?.Attribute("V")?.Value;
                if (!string.IsNullOrWhiteSpace(name) && value is not null && value.Length <= _limits.MaxMetadataCharacters)
                {
                    result[name] = UnquoteVisioValue(value);
                }
            }
        }
        return result;
    }

    private static string UnquoteVisioValue(string value)
    {
        if (value.Length >= 2 && value[0] == '"' && value[^1] == '"')
        {
            return value[1..^1].Replace("\"\"", "\"", StringComparison.Ordinal);
        }
        return value;
    }

    private static DiagramElementGeometry GeometryFromVisio(
        XElement shape,
        string externalId,
        string kind,
        string semanticId,
        double? pageHeight = null)
    {
        var cells = shape.Elements()
            .Where(element => element.Name.LocalName == "Cell")
            .Select(element => new
            {
                Name = (string?)element.Attribute("N"),
                Value = ParseVisioNumber((string?)element.Attribute("V"))
            })
            .Where(cell => cell.Name is not null)
            .ToDictionary(cell => cell.Name!, cell => cell.Value, StringComparer.OrdinalIgnoreCase);
        var pinX = cells.GetValueOrDefault("PinX");
        var pinY = cells.GetValueOrDefault("PinY");
        var width = cells.GetValueOrDefault("Width");
        var height = cells.GetValueOrDefault("Height");
        var left = pinX - (cells.GetValueOrDefault("LocPinX") ?? width / 2);
        var bottom = pinY - (cells.GetValueOrDefault("LocPinY") ?? height / 2);
        return new(
            externalId,
            kind,
            semanticId,
            left ?? pinX,
            pageHeight is not null && bottom is not null && height is not null
                ? pageHeight - bottom - height
                : bottom ?? pinY,
            width,
            height,
            "in");
    }

    private static double? ParseVisioNumber(string? value) =>
        double.TryParse(value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var number) &&
        double.IsFinite(number) && Math.Abs(number) <= 1_000_000
            ? number
            : null;

    private static byte[] CreateMinimalOrdinaryVisioFixture()
    {
        using var output = new MemoryStream();
        using (var archive = new ZipArchive(output, ZipArchiveMode.Create, leaveOpen: true, Encoding.UTF8))
        {
            AddZipText(archive, "[Content_Types].xml", """
                <?xml version="1.0" encoding="UTF-8"?>
                <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
                  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
                  <Default Extension="xml" ContentType="application/xml"/>
                  <Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/>
                  <Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/>
                  <Override PartName="/visio/pages/page1.xml" ContentType="application/vnd.ms-visio.page+xml"/>
                </Types>
                """);
            AddZipText(archive, "_rels/.rels", """
                <?xml version="1.0" encoding="UTF-8"?>
                <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
                  <Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/document" Target="visio/document.xml"/>
                </Relationships>
                """);
            AddZipText(archive, "visio/document.xml", """
                <?xml version="1.0" encoding="UTF-8"?>
                <VisioDocument xmlns="http://schemas.microsoft.com/office/visio/2012/main"/>
                """);
            AddZipText(archive, "visio/pages/pages.xml", """
                <?xml version="1.0" encoding="UTF-8"?>
                <Pages xmlns="http://schemas.microsoft.com/office/visio/2012/main">
                  <Page ID="0" Name="Proces" NameU="Page-1"/>
                </Pages>
                """);
            AddZipText(archive, "visio/pages/page1.xml", """
                <?xml version="1.0" encoding="UTF-8"?>
                <PageContents xmlns="http://schemas.microsoft.com/office/visio/2012/main">
                  <Shapes>
                    <Shape ID="100" NameU="Swimlane">
                      <Cell N="PinX" V="5"/><Cell N="PinY" V="5"/><Cell N="Width" V="10"/><Cell N="Height" V="10"/>
                      <Text>Service</Text>
                    </Shape>
                    <Shape ID="1" NameU="Start">
                      <Cell N="PinX" V="5"/><Cell N="PinY" V="9"/><Cell N="Width" V="2"/><Cell N="Height" V="0.6"/>
                      <Text>Start</Text>
                    </Shape>
                    <Shape ID="2" NameU="Process">
                      <Cell N="PinX" V="5"/><Cell N="PinY" V="7"/><Cell N="Width" V="2"/><Cell N="Height" V="0.8"/>
                      <Text>Ontvang aanvraag</Text>
                    </Shape>
                    <Shape ID="3" NameU="Decision">
                      <Cell N="PinX" V="5"/><Cell N="PinY" V="5"/><Cell N="Width" V="2"/><Cell N="Height" V="1.2"/>
                      <Text>Aanvraag compleet?</Text>
                    </Shape>
                    <Shape ID="4" NameU="Process">
                      <Cell N="PinX" V="5"/><Cell N="PinY" V="3"/><Cell N="Width" V="2"/><Cell N="Height" V="0.8"/>
                      <Text>Aanvullen</Text>
                    </Shape>
                    <Shape ID="5" NameU="End">
                      <Cell N="PinX" V="5"/><Cell N="PinY" V="1"/><Cell N="Width" V="2"/><Cell N="Height" V="0.6"/>
                      <Text>Einde</Text>
                    </Shape>
                    <Shape ID="10" NameU="Dynamic connector" OneD="1"/>
                    <Shape ID="11" NameU="Dynamic connector" OneD="1"/>
                    <Shape ID="12" NameU="Dynamic connector" OneD="1"><Text>Ja</Text></Shape>
                    <Shape ID="13" NameU="Dynamic connector" OneD="1"><Text>Nee</Text></Shape>
                    <Shape ID="14" NameU="Dynamic connector" OneD="1"/>
                  </Shapes>
                  <Connects>
                    <Connect FromSheet="10" FromCell="BeginX" ToSheet="1" ToCell="PinX"/>
                    <Connect FromSheet="10" FromCell="EndX" ToSheet="2" ToCell="PinX"/>
                    <Connect FromSheet="11" FromCell="BeginX" ToSheet="2" ToCell="PinX"/>
                    <Connect FromSheet="11" FromCell="EndX" ToSheet="3" ToCell="PinX"/>
                    <Connect FromSheet="12" FromCell="BeginX" ToSheet="3" ToCell="PinX"/>
                    <Connect FromSheet="12" FromCell="EndX" ToSheet="5" ToCell="PinX"/>
                    <Connect FromSheet="13" FromCell="BeginX" ToSheet="3" ToCell="PinX"/>
                    <Connect FromSheet="13" FromCell="EndX" ToSheet="4" ToCell="PinX"/>
                    <Connect FromSheet="14" FromCell="BeginX" ToSheet="4" ToCell="PinX"/>
                    <Connect FromSheet="14" FromCell="EndX" ToSheet="5" ToCell="PinX"/>
                  </Connects>
                </PageContents>
                """);
        }
        return output.ToArray();
    }

    private static void AddZipText(ZipArchive archive, string name, string content)
    {
        var entry = archive.CreateEntry(name, CompressionLevel.NoCompression);
        entry.LastWriteTime = new DateTimeOffset(1980, 1, 1, 0, 0, 0, TimeSpan.Zero);
        using var writer = new StreamWriter(entry.Open(), new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
        writer.Write(content);
    }

    private static DiagramPackageExportResult ExportError(string format, string code, string message) =>
        new(false, format, null, null, null, [], [new(code, message)]);

    private static DiagramImportResult ImportError(string format, IReadOnlyList<DiagramExchangeIssue> errors) =>
        new(false, format, null, [], [], [], errors, 0);

    private sealed record PackageValidation(ZipArchive? Archive, IReadOnlyList<DiagramExchangeIssue> Errors)
    {
        public bool Ok => Archive is not null && Errors.Count == 0;
    }

    private sealed record VisioBounds(double Left, double Bottom, double Width, double Height)
    {
        public double CenterX => Left + Width / 2;
        public double CenterY => Bottom + Height / 2;

        public bool Contains(double x, double y) =>
            x >= Left && x <= Left + Width && y >= Bottom && y <= Bottom + Height;
    }

    private sealed record VisioShapeInfo(
        XElement Element,
        string ExternalId,
        string Text,
        string Hint,
        VisioBounds? Bounds,
        bool OneDimensional);

    private sealed record VisioFlowConnection(
        string ExternalId,
        string SourceId,
        string TargetId,
        string Label);

    private sealed record VisioExportBounds(double X, double Y, double Width, double Height)
    {
        public double Right => X + Width;
        public double Bottom => Y + Height;
        public double CenterX => X + Width / 2;
        public double CenterY => Y + Height / 2;
    }

    private sealed record VisioExportPoint(double X, double Y);

    private sealed record VisioExportLayout(
        double PageWidthPx,
        double PageHeightPx,
        IReadOnlyDictionary<string, VisioExportBounds> Lanes,
        IReadOnlyDictionary<string, VisioExportBounds> Sections,
        IReadOnlyDictionary<string, VisioExportBounds> Steps);

    private sealed record LucidSemanticReference(string Kind, string SemanticId);

    private sealed record LucidShapeEdit(
        string Kind,
        string SemanticId,
        string Text,
        string ExternalId);
}
