using System.IO.Compression;
using System.Text;
using System.Xml.Linq;
using ServiceProcesgids.Api.Services;

internal static class OrdinaryVisioTests
{
    // Synthetic OPC/ShapeSheet fixtures with no application metadata. They exercise the
    // format contract, not a claim of compatibility with every Visio desktop stencil.
    private const string Ns = "http://schemas.microsoft.com/office/visio/2012/main";
    private const string RelNs = "http://schemas.openxmlformats.org/package/2006/relationships";
    private const string OfficeRel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

    internal static void WriteFixtures(string directory)
    {
        Directory.CreateDirectory(directory);
        File.WriteAllBytes(Path.Combine(directory, "ordinary-multiple-pages.vsdx"), Zip(Fixture(twoPages: true)));
        var noLanes = ChangePage(Fixture(), doc => doc.Descendants().Single(item => (string?)item.Attribute("ID") == "100").Remove());
        File.WriteAllBytes(Path.Combine(directory, "ordinary-without-lanes.vsdx"), Zip(noLanes));
    }

    internal static DiagramPackageSelfTestResult Run(DiagramPackageService service)
    {
        var parts = Fixture();
        var imported = service.ImportVisioVsdx(Zip(parts));
        var process = imported.Process;
        var checks = new Dictionary<string, bool>
        {
            ["ordinary-stencil-import"] = imported.Ok && process?.Stappen.Count == 4,
            ["master-width-and-height-inherited"] = imported.Geometry.Any(item => item.ExternalId == "2" && item.Width == 2 && item.Height == 0.8),
            ["terminal-custom-labels-preserved"] = process?.Stappen.Any(step => step.Type == "start" && step.Activiteit == "Aanvraag ontvangen") == true &&
                process.Stappen.Any(step => step.Type == "eind" && step.Activiteit == "Afgehandeld"),
            ["page-name-retained"] = process?.Detailproces == "Inkoop",
            ["decision-labels-and-loop-preserved"] = process?.Stappen.SingleOrDefault(step => step.Type == "beslissing")?.Routes?.Select(route => route.Label).ToHashSet().SetEquals(["Akkoord", "Aanpassen"]) == true,
            ["source-coordinate-y-flipped"] = imported.Geometry.SingleOrDefault(item => item.ExternalId == "1")?.Y < imported.Geometry.SingleOrDefault(item => item.ExternalId == "4")?.Y,
            ["confidence-counts-shapes-not-connect-records"] = imported.Confidence == 1,
        };
        var withoutLanes = ChangePage(parts, doc => doc.Descendants().Single(item => (string?)item.Attribute("ID") == "100").Remove());
        var missingRole = service.ImportVisioVsdx(Zip(withoutLanes));
        var assigned = service.ImportVisioVsdx(Zip(withoutLanes), defaultRole: "Inkoper");
        checks["role-required-when-lanes-absent"] = !missingRole.Ok && missingRole.Errors.Any(error => error.Code == "roles-missing");
        checks["user-supplied-role-enables-draft"] = assigned.Ok && assigned.Process?.Lanes.Single().Naam == "Inkoper" && assigned.Warnings.Any(warning => warning.Code == "role-assigned-by-user");
        checks["explicit-lane-not-overwritten"] = service.ImportVisioVsdx(Zip(parts), defaultRole: "Ignored").Process?.Lanes.Single().Naam == "Proceseigenaar";
        checks["role-length-bounded"] = !service.ImportVisioVsdx(Zip(withoutLanes), defaultRole: new string('x', 121)).Ok;
        var multi = Fixture(twoPages: true);
        var selection = service.ImportVisioVsdx(Zip(multi));
        var second = service.ImportVisioVsdx(Zip(multi), "visio/pages/page2.xml");
        checks["multiple-pages-require-choice"] = !selection.Ok && selection.Pages?.Count == 2 && selection.Errors.Any(error => error.Code == "page-selection-required");
        checks["selected-page-name-and-origin"] = second.Ok && second.Process?.Detailproces == "Onderhoud" && second.Process.Bron?.Paginas?.SequenceEqual([2]) == true;
        checks["page-shapes-not-merged"] = second.Process?.Stappen.Count == 4 && second.Process.Id != service.ImportVisioVsdx(Zip(multi), "visio/pages/page1.xml").Process?.Id;
        checks["invalid-page-no-fallback"] = !service.ImportVisioVsdx(Zip(multi), "../../page1.xml").Ok;
        var background = Fixture(twoPages: true, background: true);
        checks["background-excluded-from-auto-selection"] = service.ImportVisioVsdx(Zip(background)).Ok &&
            !service.ImportVisioVsdx(Zip(background), "visio/pages/page2.xml").Ok;
        var noLabel = ChangePage(parts, doc => doc.Descendants().Single(item => (string?)item.Attribute("ID") == "12").Elements().Where(item => item.Name.LocalName == "Text").Remove());
        checks["missing-decision-label-blocks-commit"] = service.ImportVisioVsdx(Zip(noLabel)).Errors.Any(error => error.Code == "decision-labels-ambiguous");
        var brokenConnection = ChangePage(parts, doc => doc.Descendants().First(item => item.Name.LocalName == "Connect").SetAttributeValue("ToSheet", "missing"));
        checks["unknown-connector-target-blocked"] = !service.ImportVisioVsdx(Zip(brokenConnection)).Ok;
        var reverseArrow = ChangePage(parts, doc => doc.Descendants().Single(item => (string?)item.Attribute("ID") == "10").Add(new XElement(XName.Get("Cell", Ns), new XAttribute("N", "BeginArrow"), new XAttribute("V", "13"))));
        checks["ambiguous-arrow-direction-blocked"] = service.ImportVisioVsdx(Zip(reverseArrow)).Errors.Any(error => error.Code == "connector-direction-unsupported");
        var external = new Dictionary<string, string>(parts) { ["visio/_rels/document.xml.rels"] = $"<Relationships xmlns='{RelNs}'><Relationship Id='rExt' Type='external' Target='https://example.com/' TargetMode='External'/></Relationships>" };
        checks["external-relationships-not-fetched"] = service.ImportVisioVsdx(Zip(external)).Errors.Any(error => error.Code == "external-relationship-rejected");
        var macro = new Dictionary<string, string>(parts) { ["visio/vbaProject.bin"] = "dummy" };
        checks["macro-parts-rejected"] = !service.ImportVisioVsdx(Zip(macro)).Ok;
        return new(checks.Values.All(ok => ok), checks, imported.Errors.Select(error => error.Message).ToList());
    }

    private static Dictionary<string, string> ChangePage(Dictionary<string, string> source, Action<XDocument> edit)
    {
        var copy = new Dictionary<string, string>(source);
        var page = XDocument.Parse(copy["visio/pages/page1.xml"]);
        edit(page);
        copy["visio/pages/page1.xml"] = page.ToString();
        return copy;
    }

    private static Dictionary<string, string> Fixture(bool twoPages = false, bool background = false)
    {
        var page = $"""
            <PageContents xmlns="{Ns}"><Shapes>
              <Shape ID="100" NameU="Swimlane"><Cell N="PinX" V="5"/><Cell N="PinY" V="5"/><Cell N="Width" V="10"/><Cell N="Height" V="10"/><Text>Proceseigenaar</Text></Shape>
              <Shape ID="1" NameU="Start/End"><Cell N="PinX" V="5"/><Cell N="PinY" V="9"/><Cell N="Width" V="2"/><Cell N="Height" V="0.6"/><Text>Aanvraag ontvangen</Text></Shape>
              <Shape ID="2" Master="7"><Cell N="PinX" V="5"/><Cell N="PinY" V="7"/><Text>Beoordeel aanvraag</Text></Shape>
              <Shape ID="3" NameU="Decision"><Cell N="PinX" V="5"/><Cell N="PinY" V="5"/><Cell N="Width" V="2"/><Cell N="Height" V="1"/><Text>Akkoord?</Text></Shape>
              <Shape ID="4" NameU="Start/End"><Cell N="PinX" V="5"/><Cell N="PinY" V="1"/><Cell N="Width" V="2"/><Cell N="Height" V="0.6"/><Text>Afgehandeld</Text></Shape>
              <Shape ID="10" NameU="Dynamic connector" OneD="1"/>
              <Shape ID="11" NameU="Dynamic connector" OneD="1"/>
              <Shape ID="12" NameU="Dynamic connector" OneD="1"><Text>Akkoord</Text></Shape>
              <Shape ID="13" NameU="Dynamic connector" OneD="1"><Text>Aanpassen</Text></Shape>
            </Shapes><Connects>
              <Connect FromSheet="10" FromCell="BeginX" ToSheet="1"/><Connect FromSheet="10" FromCell="EndX" ToSheet="2"/>
              <Connect FromSheet="11" FromCell="BeginX" ToSheet="2"/><Connect FromSheet="11" FromCell="EndX" ToSheet="3"/>
              <Connect FromSheet="12" FromCell="BeginX" ToSheet="3"/><Connect FromSheet="12" FromCell="EndX" ToSheet="4"/>
              <Connect FromSheet="13" FromCell="BeginX" ToSheet="3"/><Connect FromSheet="13" FromCell="EndX" ToSheet="2"/>
            </Connects></PageContents>
            """;
        var result = new Dictionary<string, string>
        {
            ["[Content_Types].xml"] = "<Types xmlns='http://schemas.openxmlformats.org/package/2006/content-types'><Default Extension='xml' ContentType='application/xml'/></Types>",
            ["_rels/.rels"] = $"<Relationships xmlns='{RelNs}'><Relationship Id='rDoc' Type='http://schemas.microsoft.com/visio/2010/relationships/document' Target='visio/document.xml'/></Relationships>",
            ["visio/document.xml"] = $"<VisioDocument xmlns='{Ns}'/>",
            ["visio/pages/pages.xml"] = $"<Pages xmlns='{Ns}' xmlns:r='{OfficeRel}'><Page ID='0' Name='Inkoop'><PageSheet><Cell N='PageHeight' V='12'/></PageSheet><Rel r:id='r1'/></Page>{(twoPages ? $"<Page ID='1' Name='Onderhoud' Background='{(background ? "1" : "0")}'><PageSheet><Cell N='PageHeight' V='12'/></PageSheet><Rel r:id='r2'/></Page>" : "")}</Pages>",
            ["visio/pages/_rels/pages.xml.rels"] = $"<Relationships xmlns='{RelNs}'><Relationship Id='r1' Target='page1.xml' Type='page'/>{(twoPages ? "<Relationship Id='r2' Target='page2.xml' Type='page'/>" : "")}</Relationships>",
            ["visio/pages/page1.xml"] = page,
            ["visio/masters/masters.xml"] = $"<Masters xmlns='{Ns}' xmlns:r='{OfficeRel}'><Master ID='7' NameU='Process'><Rel r:id='r7'/></Master></Masters>",
            ["visio/masters/_rels/masters.xml.rels"] = $"<Relationships xmlns='{RelNs}'><Relationship Id='r7' Target='master7.xml' Type='master'/></Relationships>",
            ["visio/masters/master7.xml"] = $"<MasterContents xmlns='{Ns}'><Shapes><Shape ID='0'><Cell N='Width' V='2'/><Cell N='Height' V='0.8'/></Shape></Shapes></MasterContents>",
        };
        if (twoPages) result["visio/pages/page2.xml"] = page;
        return result;
    }

    private static byte[] Zip(Dictionary<string, string> parts)
    {
        using var memory = new MemoryStream();
        using (var zip = new ZipArchive(memory, ZipArchiveMode.Create, true))
            foreach (var (name, xml) in parts)
            {
                using var writer = new StreamWriter(zip.CreateEntry(name, CompressionLevel.NoCompression).Open(), new UTF8Encoding(false));
                writer.Write(xml);
            }
        return memory.ToArray();
    }
}
