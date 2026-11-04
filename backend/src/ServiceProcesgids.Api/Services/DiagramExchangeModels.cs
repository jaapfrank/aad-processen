using ServiceProcesgids.Api.Contract;

namespace ServiceProcesgids.Api.Services;

public sealed record DiagramPackageLimits(
    long MaxPackageBytes = 50 * 1024 * 1024,
    long MaxUncompressedBytes = 100 * 1024 * 1024,
    long MaxEntryBytes = 20 * 1024 * 1024,
    int MaxEntries = 1_000,
    double MaxCompressionRatio = 100,
    long MaxXmlCharacters = 5_000_000,
    int MaxXmlDepth = 64,
    int MaxDiagramItems = 5_000,
    int MaxMetadataCharacters = 100_000);

public sealed record DiagramExchangeIssue(string Code, string Message, string? ElementId = null);

public sealed record DiagramElementGeometry(
    string ExternalId,
    string SemanticKind,
    string SemanticId,
    double? X,
    double? Y,
    double? Width,
    double? Height,
    string Unit);

public sealed record VisioImportPage(string Id, string Name, int Number, bool Background);

public sealed record DiagramImportResult(
    bool Ok,
    string Format,
    ProcessDocument? Process,
    IReadOnlyList<DiagramElementGeometry> Geometry,
    IReadOnlyList<DiagramExchangeIssue> Warnings,
    IReadOnlyList<DiagramExchangeIssue> Unmapped,
    IReadOnlyList<DiagramExchangeIssue> Errors,
    double Confidence,
    IReadOnlyList<VisioImportPage>? Pages = null);

public sealed record DiagramPackageExportResult(
    bool Ok,
    string Format,
    string? FileName,
    string? MediaType,
    byte[]? Content,
    IReadOnlyList<DiagramExchangeIssue> Warnings,
    IReadOnlyList<DiagramExchangeIssue> Errors);

public sealed record DiagramExportBlocker(
    string Format,
    string Code,
    string Message,
    bool RequiresValidatedTemplate);

public sealed record DiagramPackageSelfTestResult(
    bool Ok,
    IReadOnlyDictionary<string, bool> Checks,
    IReadOnlyList<string> Messages);
