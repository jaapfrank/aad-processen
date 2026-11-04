using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using ServiceProcesgids.Api.Contract;
using ServiceProcesgids.Api.Data;
using ServiceProcesgids.Api.Data.Entities;
using UglyToad.PdfPig;

namespace ServiceProcesgids.Api.Services;

public sealed class PdfImportService(AppDbContext dbContext)
{
    private static readonly string[] CompactResponsibleRoles =
    [
        "Klantenservice medewerker (Service)",
        "(Klanten)service medewerker",
        "Inside Sales / Account Manager",
        "Service medewerker inscanner",
        "Service medewerker onderzoek",
        "Financiële administratie",
        "Financiele administratie",
        "Service onderzoek",
        "Service medewerker",
        "Service inpakker",
        "Restock medewerker",
        "Inkoop(retour)",
        "Sales Manager",
        "Account Manager",
        "Service inscanner",
        "Onderzoek",
        "Leverancier",
        "Magazijn",
        "Website",
        "Content",
        "Klant",
        "ERP"
    ];

    private static readonly Regex CompactRowStartRegex = new(
        $@"(?<!\S)(?<role>{string.Join('|', CompactResponsibleRoles.OrderByDescending(role => role.Length).Select(Regex.Escape))})\s+(?<step>\d+\.?|SC\.?|E\.?|A\.?|C\.?|O\.?|L\.?|V\.?|D\.?|F\.?|S\.?)\s+",
        RegexOptions.Compiled | RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);

    private static readonly Regex CompactHeaderRegex = new(
        @"Verantwoordelijke\s+Stap\s+Activiteit\s+Opmerking",
        RegexOptions.Compiled | RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);

    private static readonly string[] RemarkStartMarkers =
    [
        "Op de website",
        "Ook kiest",
        "De website maakt",
        "De website synchroniseert",
        "RMA-status",
        "ERP RMA",
        "ERP status",
        "Dit kan",
        "Indien",
        "De medewerker",
        "Controle van",
        "Elke werkdag",
        "Onderdeel van",
        "Controle vindt",
        "Medewerker gebruikt",
        "1e beoordeling",
        "Restockingskosten",
        "Beoordeling of",
        "Klant met potentie",
        "Maakt ticket",
        "Meestal via",
        "Er wordt",
        "AM'er",
        "AM’er",
        "Dit gebeurt",
        "SK heeft",
        "Inkoop Retour Order",
        "Serienummer",
        "Dit is maatwerk",
        "Via excel",
        "Kan zijn",
        "In de IRO",
        "Elke leverancier",
        "Noteer ook",
        "Bij volledige",
        "Voorraad wordt",
        "IRV wordt",
        "Inclusief label",
        "Fysiek andere",
        "Voor manager",
        "Negatieve voorraad",
        "Positieve",
        "Herhaal deze",
        "Product komt",
        "In de meeste gevallen",
        "De meeste credits",
        "Te achterhalen",
        "(regel)IRO",
        "Hier zit",
        "Dit kan ook",
        "Alle producten",
        "Elk retourkanaal",
        "Plaatst artikel én",
        "Scan product",
        "Einde proces"
    ];

    public async Task<ImportJobDocument> StartAsync(
        IFormFile file,
        CancellationToken cancellationToken = default)
    {
        var fileId = $"file-{Guid.NewGuid():N}";
        var jobId = $"imp-{Guid.NewGuid():N}";
        var safeFileName = Path.GetFileName(file.FileName);

        await using var fileStream = file.OpenReadStream();
        using var memory = new MemoryStream();
        await fileStream.CopyToAsync(memory, cancellationToken);
        var bytes = memory.ToArray();

        dbContext.Files.Add(new StoredFileEntity
        {
            Id = fileId,
            FileName = safeFileName,
            ContentType = string.IsNullOrWhiteSpace(file.ContentType) ? "application/pdf" : file.ContentType,
            Length = bytes.Length,
            Content = bytes,
            CreatedAtUtc = DateTimeOffset.UtcNow
        });

        var job = new ImportJobEntity
        {
            Id = jobId,
            FileName = safeFileName,
            Status = "verwerken",
            CreatedAtUtc = DateTimeOffset.UtcNow,
            Progress = 10,
            SourceFileId = fileId
        };
        dbContext.ImportJobs.Add(job);
        await dbContext.SaveChangesAsync(cancellationToken);

        try
        {
            var result = ParsePdf(bytes, safeFileName, fileId);

            // Pagina's als PNG renderen voor het review-scherm; valt terug op
            // PDF-referenties wanneer rasterisatie niet beschikbaar is.
            var pageImages = TryRenderPageImages(bytes, safeFileName) ?? result.PageReferences;

            job.Status = result.ConceptProces.Stappen.Count == 0 ? "mislukt" : "gereed";
            job.Progress = 100;
            job.ConceptProcessJson = JsonSerializer.Serialize(result.ConceptProces, ProcessJson.Options);
            job.ConfidenceJson = JsonSerializer.Serialize(result.Confidence, ProcessJson.Options);
            job.PageImagesJson = JsonSerializer.Serialize(pageImages, ProcessJson.Options);
            job.Error = result.ConceptProces.Stappen.Count == 0
                ? "Geen tabelregels herkend met kolommen Verantwoordelijke/Stap/Activiteit/Opmerking."
                : null;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            job.Status = "mislukt";
            job.Progress = 100;
            job.Error = ex.Message;
        }

        await dbContext.SaveChangesAsync(cancellationToken);
        return ToDocument(job);
    }

    public async Task<ImportJobDocument?> GetJobAsync(
        string jobId,
        CancellationToken cancellationToken = default)
    {
        var job = await dbContext.ImportJobs.AsNoTracking().FirstOrDefaultAsync(
            existing => existing.Id == jobId,
            cancellationToken);

        return job is null ? null : ToDocument(job);
    }

    public ImportJobDocument ToDocument(ImportJobEntity job)
    {
        var concept = string.IsNullOrWhiteSpace(job.ConceptProcessJson)
            ? null
            : JsonSerializer.Deserialize<ProcessDocument>(job.ConceptProcessJson, ProcessJson.Options);

        var confidence = JsonSerializer.Deserialize<ImportFieldConfidence[]>(
            job.ConfidenceJson,
            ProcessJson.Options) ?? [];

        var pageImages = JsonSerializer.Deserialize<string[]>(
            job.PageImagesJson,
            ProcessJson.Options) ?? [];

        return new ImportJobDocument(
            job.Id,
            job.FileName,
            job.Status,
            job.CreatedAtUtc.ToString("O"),
            job.Progress,
            job.SourceFileId,
            concept,
            confidence,
            pageImages,
            job.Error);
    }

    private const int MaxRenderedPages = 60;

    /// <summary>
    /// Rendert PDF-pagina's naar PNG (PDFtoImage/pdfium) en slaat ze op als
    /// bestanden, zodat het review-scherm echte afbeeldingen kan tonen.
    /// Retourneert null bij fouten zodat de aanroeper terugvalt op PDF-referenties.
    /// </summary>
    private List<string>? TryRenderPageImages(byte[] pdfBytes, string fileName)
    {
#pragma warning disable CA1416 // pdfium-rasterisatie; app draait op Windows/Linux (zie deploy-handleiding)
        try
        {
            var refs = new List<string>();
            var pageIndex = 0;
            foreach (var bitmap in PDFtoImage.Conversion.ToImages(pdfBytes))
            {
                using (bitmap)
                {
                    if (pageIndex >= MaxRenderedPages)
                    {
                        break;
                    }

                    using var data = bitmap.Encode(SkiaSharp.SKEncodedImageFormat.Png, 80);
                    var pngId = $"file-{Guid.NewGuid():N}";
                    dbContext.Files.Add(new StoredFileEntity
                    {
                        Id = pngId,
                        FileName = $"{Path.GetFileNameWithoutExtension(fileName)}-p{pageIndex + 1}.png",
                        ContentType = "image/png",
                        Length = data.Size,
                        Content = data.ToArray(),
                        CreatedAtUtc = DateTimeOffset.UtcNow
                    });
                    refs.Add($"/api/files/{pngId}");
                    pageIndex++;
                }
            }

            return refs.Count > 0 ? refs : null;
        }
        catch
        {
            // Rasterisatie is best-effort; de PDF zelf blijft beschikbaar.
            return null;
        }
#pragma warning restore CA1416
    }

    private static ParsedImport ParsePdf(byte[] bytes, string fileName, string fileId)
    {
        using var stream = new MemoryStream(bytes);
        using var document = PdfDocument.Open(stream);

        var rows = new List<ParsedRow>();
        var pageReferences = new List<string>();
        var allText = new List<string>();

        var pageNumber = 0;
        foreach (var page in document.GetPages())
        {
            pageNumber++;
            var pageText = page.Text ?? "";
            allText.Add(pageText);
            pageReferences.Add($"/api/files/{fileId}?page={pageNumber}");
            rows.AddRange(ParseRows(pageText, pageNumber));
        }

        var process = BuildProcess(fileName, rows, allText);
        var confidence = BuildConfidence(rows);

        return new ParsedImport(process, confidence, pageReferences);
    }

    private static IReadOnlyList<ParsedRow> ParseRows(string pageText, int pageNumber)
    {
        var lineRows = ParseLineRows(pageText, pageNumber);
        return lineRows.Count > 0 ? lineRows : ParseCompactRows(pageText, pageNumber);
    }

    private static IReadOnlyList<ParsedRow> ParseLineRows(string pageText, int pageNumber)
    {
        var lines = pageText
            .Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(NormalizeWhitespace)
            .Where(line => line.Length > 0)
            .ToList();

        var rows = new List<ParsedRow>();
        var inTable = false;
        foreach (var line in lines)
        {
            if (LooksLikeHeader(line))
            {
                inTable = true;
                continue;
            }

            if (!inTable && !Regex.IsMatch(line, @"\b(\d+|SC|E|A|O|L|V|D)\b", RegexOptions.IgnoreCase))
            {
                continue;
            }

            var parts = Regex.Split(line, @"\s{2,}|\t+")
                .Select(part => part.Trim())
                .Where(part => part.Length > 0)
                .ToArray();

            if (parts.Length >= 3 && LooksLikeStep(parts[1]))
            {
                rows.Add(new ParsedRow(
                    parts[0],
                    NormalizeStepValue(parts[1]),
                    parts[2],
                    parts.Length > 3 ? string.Join(" ", parts.Skip(3)) : null,
                    pageNumber,
                    parts.Length > 3 ? 0.86 : 0.76,
                    line));
                continue;
            }

            var match = Regex.Match(
                line,
                @"^(?<role>[A-Za-zÀ-ÿ0-9()/' ._-]{3,}?)\s+(?<step>\d+\.?|SC\.?|E\.?|A\.?|C\.?|O\.?|L\.?|V\.?|D\.?|F\.?|S\.?)\s+(?<activity>.+)$",
                RegexOptions.IgnoreCase);

            if (!match.Success)
            {
                continue;
            }

            rows.Add(new ParsedRow(
                match.Groups["role"].Value.Trim(),
                NormalizeStepValue(match.Groups["step"].Value),
                match.Groups["activity"].Value.Trim(),
                null,
                pageNumber,
                0.62,
                line));
        }

        return rows;
    }

    private static IReadOnlyList<ParsedRow> ParseCompactRows(string pageText, int pageNumber)
    {
        var compactText = NormalizeCompactText(pageText);
        var headerMatch = CompactHeaderRegex.Match(compactText);
        if (!headerMatch.Success)
        {
            return [];
        }

        var tableText = compactText[(headerMatch.Index + headerMatch.Length)..].Trim();
        var matches = CompactRowStartRegex.Matches(tableText).Cast<Match>().ToArray();
        if (matches.Length == 0)
        {
            return [];
        }

        var rows = new List<ParsedRow>();
        for (var index = 0; index < matches.Length; index++)
        {
            var match = matches[index];
            var rowStart = match.Index + match.Length;
            var rowEnd = index + 1 < matches.Length ? matches[index + 1].Index : tableText.Length;
            if (rowEnd <= rowStart)
            {
                continue;
            }

            var rowText = CleanCompactRowSegment(tableText[rowStart..rowEnd]);
            if (rowText.Length == 0)
            {
                continue;
            }

            var (activity, remark) = SplitActivityAndRemark(rowText);
            if (activity.Length == 0)
            {
                continue;
            }

            rows.Add(new ParsedRow(
                match.Groups["role"].Value.Trim(),
                NormalizeStepValue(match.Groups["step"].Value),
                activity,
                remark,
                pageNumber,
                remark is null ? 0.64 : 0.72,
                $"{match.Value.Trim()} {rowText}"));
        }

        return rows;
    }

    private static string CleanCompactRowSegment(string value)
    {
        var segment = NormalizeCompactText(value);
        var headerIndex = segment.IndexOf(" Verantwoordelijke Stap Activiteit Opmerking", StringComparison.OrdinalIgnoreCase);
        if (headerIndex >= 0)
        {
            var beforeHeader = segment[..headerIndex].Trim();
            var titleIndex = FindLastTableTitleIndex(beforeHeader);
            segment = titleIndex > 0 ? beforeHeader[..titleIndex] : beforeHeader;
        }

        foreach (var boundary in new[] { " Werkinstructies", " Hoofdproces:", " VoorbeeldbedrijfVoorbeeldbedrijf" })
        {
            var boundaryIndex = segment.IndexOf(boundary, StringComparison.OrdinalIgnoreCase);
            if (boundaryIndex >= 0)
            {
                segment = segment[..boundaryIndex];
            }
        }

        return segment.Trim();
    }

    private static int FindLastTableTitleIndex(string value)
    {
        var serviceHyphen = value.LastIndexOf(" Service - ", StringComparison.OrdinalIgnoreCase);
        var serviceDash = value.LastIndexOf(" Service – ", StringComparison.OrdinalIgnoreCase);
        return Math.Max(serviceHyphen, serviceDash);
    }

    private static (string Activity, string? Remark) SplitActivityAndRemark(string value)
    {
        var segment = NormalizeCompactText(value);
        var splitIndex = RemarkStartMarkers
            .Select(marker => segment.IndexOf(marker, StringComparison.OrdinalIgnoreCase))
            .Where(index => index >= 10)
            .DefaultIfEmpty(-1)
            .Min();

        if (splitIndex < 0)
        {
            return (segment, null);
        }

        var activity = segment[..splitIndex].Trim();
        var remark = segment[splitIndex..].Trim();
        return activity.Length == 0
            ? (segment, null)
            : (activity, string.IsNullOrWhiteSpace(remark) ? null : remark);
    }

    private static ProcessDocument BuildProcess(string fileName, IReadOnlyList<ParsedRow> rows, IReadOnlyList<string> allText)
    {
        var laneNames = rows
            .Select(row => row.Responsible)
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        var lanes = laneNames
            .Select((name, index) => new Lane(CreateStableId(name), name, PickLaneColor(index)))
            .ToList();

        var laneByName = lanes.ToDictionary(lane => lane.Naam, lane => lane.Id, StringComparer.OrdinalIgnoreCase);
        var steps = rows.Select((row, index) =>
        {
            var id = $"imp-step-{index + 1}";
            var next = index + 1 < rows.Count ? $"imp-step-{index + 2}" : null;
            var samengesteld = $"{row.Activity} {row.Remark}";
            return new Step(
                id,
                row.Step,
                laneByName[row.Responsible],
                DetermineStepType(row.Step, row.Activity),
                row.Activity,
                $"pagina-{row.Page}",
                null,
                row.Remark,
                null,
                null,
                DetectVoorwaarde(row.Remark),
                DetectErpStatus(samengesteld),
                DetectTermijn(samengesteld),
                DetectWaarschuwing(samengesteld),
                null,
                null,
                next,
                null,
                null,
                row.Confidence);
        }).ToList();

        var pages = rows.Select(row => row.Page).Distinct().Order().ToArray();
        var joinedText = string.Join('\n', allText);
        var version = Regex.Match($"{fileName}\n{joinedText}", @"\b[vV]\d+(?:\.\d+)*\b").Value;

        return new ProcessDocument(
            $"import-{CreateStableId(Path.GetFileNameWithoutExtension(fileName))}-{DateTimeOffset.UtcNow:yyyyMMddHHmmss}",
            InferHoofdproces(fileName, joinedText),
            Path.GetFileNameWithoutExtension(fileName),
            string.IsNullOrWhiteSpace(version) ? "V0.1" : version.ToUpperInvariant(),
            "concept",
            DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd"),
            1,
            new ProcessSource(
                "pdf-import",
                fileName,
                pages,
                DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd"),
                rows.Count == 0 ? 0 : Math.Round(rows.Average(row => row.Confidence), 2)),
            lanes,
            rows.Select(r => r.Page).Distinct().Order().Select(p => new Section($"pagina-{p}", $"PDF pagina {p}")).ToList(),
            steps);
    }

    private static IReadOnlyList<ImportFieldConfidence> BuildConfidence(IReadOnlyList<ParsedRow> rows)
    {
        var confidence = new List<ImportFieldConfidence>();

        for (var index = 0; index < rows.Count; index++)
        {
            var row = rows[index];
            var prefix = $"stappen[{index}]";
            confidence.Add(new ImportFieldConfidence($"{prefix}.laneId", row.Confidence, row.Page, row.Responsible, null));
            confidence.Add(new ImportFieldConfidence($"{prefix}.nummer", row.Confidence, row.Page, row.Step, null));
            confidence.Add(new ImportFieldConfidence($"{prefix}.activiteit", row.Confidence, row.Page, row.Activity, row.Confidence < 0.7 ? "Fallback-regelherkenning gebruikt." : null));
            if (!string.IsNullOrWhiteSpace(row.Remark))
            {
                confidence.Add(new ImportFieldConfidence($"{prefix}.opmerking", row.Confidence, row.Page, row.Remark, null));
            }
        }

        return confidence;
    }

    private static string DetermineStepType(string number, string activity)
    {
        if (number.Equals("SC", StringComparison.OrdinalIgnoreCase))
        {
            return "subproces";
        }

        if (number.Equals("E", StringComparison.OrdinalIgnoreCase))
        {
            return "eind";
        }

        if (activity.StartsWith("Start proces", StringComparison.OrdinalIgnoreCase) ||
            activity.StartsWith("Volgt proces", StringComparison.OrdinalIgnoreCase))
        {
            return "subproces";
        }

        if (activity.StartsWith("Einde proces", StringComparison.OrdinalIgnoreCase))
        {
            return "eind";
        }

        return activity.Contains("indien", StringComparison.OrdinalIgnoreCase) ||
            activity.Contains("ja/nee", StringComparison.OrdinalIgnoreCase) ||
            activity.Contains('?')
            ? "beslissing"
            : "actie";
    }

    /// <summary>"Indien …"-zin aan het begin van de opmerking wordt de voorwaarde.</summary>
    private static string? DetectVoorwaarde(string? remark)
    {
        if (string.IsNullOrWhiteSpace(remark) ||
            !remark.TrimStart().StartsWith("Indien", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        var zin = Regex.Match(remark.TrimStart(), @"^Indien[^.;:]*").Value.Trim();
        return zin.Length > 6 ? zin : null;
    }

    /// <summary>Herkent "ERP (RMA) status 'x'" in activiteit+opmerking.</summary>
    private static string? DetectErpStatus(string text)
    {
        var m = Regex.Match(text, @"ERP(?:\s+RMA)?\s+status\s+[‘']([^’']{2,40})[’']", RegexOptions.IgnoreCase);
        return m.Success ? m.Groups[1].Value.Trim() : null;
    }

    private static bool LooksLikeHeader(string line)
    {
        return line.Contains("Verantwoordelijke", StringComparison.OrdinalIgnoreCase) &&
            line.Contains("Stap", StringComparison.OrdinalIgnoreCase) &&
            line.Contains("Activiteit", StringComparison.OrdinalIgnoreCase);
    }

    private static bool LooksLikeStep(string value)
    {
        return Regex.IsMatch(NormalizeStepValue(value), @"^(\d+|SC|E|A|C|O|L|V|D|F|S)$", RegexOptions.IgnoreCase);
    }

    private static string NormalizeWhitespace(string value)
    {
        return Regex.Replace(value.Trim(), @"[ ]{3,}", "  ");
    }

    private static string NormalizeCompactText(string value)
    {
        return Regex.Replace(value.Trim(), @"\s+", " ");
    }

    private static string NormalizeStepValue(string value)
    {
        return value.Trim().TrimEnd('.');
    }

    private static string CreateStableId(string value)
    {
        var normalized = Regex.Replace(value.ToLowerInvariant(), @"[^a-z0-9]+", "-").Trim('-');
        return string.IsNullOrWhiteSpace(normalized) ? "import" : normalized;
    }

    private static readonly Regex TermijnRegex = new(
        @"(?:binnen|<|≤|minimaal\s+na|maximaal|max\.?|na)?\s*\b\d+\s*(?:werkdag(?:en)?|dag(?:en)?|we(?:e)?k(?:en)?|maand(?:en)?|uur|uren|jaar|jaren)\b[^.;]*",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    /// <summary>Herkent termijnen zoals "&lt; 6 dagen na levering" of "minimaal na 2 maanden".</summary>
    private static string? DetectTermijn(string text)
    {
        var match = TermijnRegex.Match(text);
        if (!match.Success)
        {
            return null;
        }

        var waarde = NormalizeWhitespace(match.Value).Trim();
        return waarde.Length is > 3 and <= 80 ? waarde : null;
    }

    /// <summary>Markeert risicosignalen (fraude e.d.) als zichtbare waarschuwing.</summary>
    private static string? DetectWaarschuwing(string text)
    {
        if (text.Contains("fraude", StringComparison.OrdinalIgnoreCase))
        {
            return "Kan fraude zijn — voer extra controle uit.";
        }

        if (text.Contains("let op", StringComparison.OrdinalIgnoreCase))
        {
            return "Let op — zie de opmerking bij deze stap.";
        }

        return null;
    }

    private static string InferHoofdproces(string fileName, string text)
    {
        var source = $"{fileName}\n{text}";
        if (source.Contains("Service", StringComparison.OrdinalIgnoreCase))
        {
            return "Service";
        }

        return "Geimporteerd";
    }

    private static string PickLaneColor(int index)
    {
        var colors = new[] { "#3B82F6", "#10B981", "#F59E0B", "#8B5CF6", "#6B7280", "#EF4444", "#14B8A6" };
        return colors[index % colors.Length];
    }

    private sealed record ParsedImport(
        ProcessDocument ConceptProces,
        IReadOnlyList<ImportFieldConfidence> Confidence,
        IReadOnlyList<string> PageReferences);

    private sealed record ParsedRow(
        string Responsible,
        string Step,
        string Activity,
        string? Remark,
        int Page,
        double Confidence,
        string Source);
}
