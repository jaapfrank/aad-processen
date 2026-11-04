using System.Reflection;
using System.Text.Json;

namespace ServiceProcesgids.Api.Services;

/// <summary>
/// Versioned allowlist shared with the frontend. Only controls explicitly
/// marked manual in this embedded contract can receive a human confirmation.
/// </summary>
public static class AuditControlCatalog
{
    private sealed record FrameworkEntry(IReadOnlyList<string> ManualControlIds);
    private sealed record CatalogDocument(
        string Version,
        IReadOnlyDictionary<string, FrameworkEntry> Frameworks);

    private static readonly Lazy<CatalogDocument> Catalog = new(Load);

    public static string Version => Catalog.Value.Version;

    public static bool IsKnownFramework(string? frameworkId) =>
        !string.IsNullOrWhiteSpace(frameworkId) &&
        Catalog.Value.Frameworks.ContainsKey(frameworkId.Trim());

    public static bool IsManualControl(string? frameworkId, string? controlId)
    {
        if (string.IsNullOrWhiteSpace(frameworkId) || string.IsNullOrWhiteSpace(controlId))
        {
            return false;
        }

        return Catalog.Value.Frameworks.TryGetValue(
                   frameworkId.Trim(),
                   out var framework) &&
               framework.ManualControlIds.Contains(
                   controlId.Trim(),
                   StringComparer.OrdinalIgnoreCase);
    }

    private static CatalogDocument Load()
    {
        var assembly = typeof(AuditControlCatalog).Assembly;
        var resourceName = assembly.GetManifestResourceNames()
            .SingleOrDefault(name =>
                name.EndsWith(
                    "audit-control-catalog.json",
                    StringComparison.OrdinalIgnoreCase))
            ?? throw new InvalidOperationException(
                "De ingebedde handmatige auditcontrolcatalogus ontbreekt.");
        using var stream = assembly.GetManifestResourceStream(resourceName)
            ?? throw new InvalidOperationException(
                "De ingebedde handmatige auditcontrolcatalogus is onleesbaar.");
        var document = JsonSerializer.Deserialize<CatalogDocument>(
            stream,
            new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true
            })
            ?? throw new InvalidOperationException(
                "De handmatige auditcontrolcatalogus is leeg.");
        if (string.IsNullOrWhiteSpace(document.Version) ||
            document.Frameworks.Count == 0 ||
            document.Frameworks.Any(item =>
                string.IsNullOrWhiteSpace(item.Key) ||
                item.Value.ManualControlIds.Count == 0))
        {
            throw new InvalidOperationException(
                "De handmatige auditcontrolcatalogus is ongeldig.");
        }

        return document;
    }
}
