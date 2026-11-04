using System.Text.Json;

namespace ServiceProcesgids.Api.Services;

public sealed record Branding(
    string Bedrijfsnaam,
    string AppNaam,
    string PrimaireKleur,
    string AccentKleur,
    /// <summary>Logo als data-URL (png/svg/jpeg), max ~300 kB; leeg = tekstmerk.</summary>
    string? LogoDataUrl);

/// <summary>
/// Eigen huisstijl per bedrijf (white-label): naam, kleuren en logo, beheerd
/// via de UI en opgeslagen in App_Data/branding.json. GET is anoniem zodat
/// ook het inlogscherm in de juiste stijl staat.
/// </summary>
public sealed class BrandingService(IWebHostEnvironment environment)
{
    public static readonly Branding Standaard = new(
        "PROCESGIDS", "Processen & borging", "#ea5b0c", "#e2231a", null);

    private readonly string _pad = Path.Combine(environment.ContentRootPath, "App_Data", "branding.json");
    private readonly object _slot = new();

    public Branding Lees()
    {
        lock (_slot)
        {
            if (!File.Exists(_pad)) return Standaard;
            try
            {
                return JsonSerializer.Deserialize<Branding>(File.ReadAllText(_pad)) ?? Standaard;
            }
            catch
            {
                return Standaard;
            }
        }
    }

    public void Bewaar(Branding branding)
    {
        if (branding.LogoDataUrl is { Length: > 400_000 })
        {
            throw new InvalidOperationException("Logo is te groot (max ±300 kB). Gebruik een kleinere afbeelding of SVG.");
        }

        lock (_slot)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_pad)!);
            File.WriteAllText(_pad, JsonSerializer.Serialize(branding, new JsonSerializerOptions { WriteIndented = true }));
        }
    }

    public void Reset()
    {
        lock (_slot)
        {
            if (File.Exists(_pad)) File.Delete(_pad);
        }
    }
}
