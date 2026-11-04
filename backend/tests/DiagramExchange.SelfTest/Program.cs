using System.Text.Json;
using ServiceProcesgids.Api.Contract;
using ServiceProcesgids.Api.Services;

var process = JsonSerializer.Deserialize<ProcessDocument>(
    """
    {
      "id": "vsdx-selftest",
      "hoofdproces": "Service",
      "detailproces": "VSDX round-trip",
      "versie": "V1.0",
      "status": "concept",
      "laatsteWijziging": "2026-07-24",
      "revision": 3,
      "bron": { "type": "handmatig" },
      "lanes": [
        { "id": "klant", "naam": "Klant", "kleur": "#2563eb" },
        { "id": "service", "naam": "Service", "kleur": "#ea580c" }
      ],
      "secties": [
        { "id": "aanvraag", "naam": "Aanvraag behandelen" }
      ],
      "stappen": [
        {
          "id": "start",
          "nummer": "1",
          "laneId": "klant",
          "type": "start",
          "activiteit": "Start",
          "sectieId": "aanvraag",
          "naarStap": "controle"
        },
        {
          "id": "controle",
          "nummer": "2",
          "laneId": "service",
          "type": "beslissing",
          "activiteit": "Aanvraag compleet?",
          "sectieId": "aanvraag",
          "routes": [
            { "id": "ja", "label": "Ja", "naarStap": "einde" },
            { "id": "nee", "label": "Nee", "naarStap": "aanvullen" }
          ]
        },
        {
          "id": "aanvullen",
          "nummer": "3",
          "laneId": "klant",
          "type": "bericht",
          "activiteit": "Informatie aanvullen",
          "sectieId": "aanvraag",
          "doelLaneId": "service",
          "naarStap": "controle"
        },
        {
          "id": "einde",
          "nummer": "4",
          "laneId": "service",
          "type": "eind",
          "activiteit": "Einde",
          "sectieId": "aanvraag"
        }
      ],
      "diagramLayout": {
        "version": 1,
        "coordinateSystem": "px96-y-down",
        "nodes": {
          "step:start": { "x": 20, "y": 90, "width": 200, "height": 72 },
          "step:controle": { "x": 260, "y": 220, "width": 200, "height": 96 },
          "step:aanvullen": { "x": 20, "y": 380, "width": 200, "height": 72 },
          "step:einde": { "x": 260, "y": 520, "width": 200, "height": 72 }
        }
      }
    }
    """,
    ProcessJson.Options) ?? throw new InvalidOperationException("Selftest-proces kon niet worden gelezen.");

var exchange = new DiagramPackageService();
if (args.Length == 2 && args[0] == "--write-fixtures") OrdinaryVisioTests.WriteFixtures(args[1]);
var checks = new Dictionary<string, DiagramPackageSelfTestResult>
{
    ["visio-round-trip"] = exchange.SelfTestVisioRoundTrip(process),
    ["ordinary-visio-import"] = exchange.SelfTestOrdinaryVisioImport(),
    ["ordinary-visio-migration"] = OrdinaryVisioTests.Run(exchange),
    ["lucid-round-trip"] = exchange.SelfTestLucidRoundTrip(process)
};

foreach (var (name, result) in checks)
{
    Console.WriteLine($"{name}: {(result.Ok ? "OK" : "MISLUKT")}");
    foreach (var (check, ok) in result.Checks)
    {
        Console.WriteLine($"  {check}: {(ok ? "OK" : "MISLUKT")}");
    }
    foreach (var message in result.Messages)
    {
        Console.WriteLine($"  {message}");
    }
}

return checks.Values.All(result => result.Ok) ? 0 : 1;
