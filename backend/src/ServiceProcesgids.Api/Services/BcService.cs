using System.Text.Json;

namespace ServiceProcesgids.Api.Services;

public sealed record BcInstellingen(
    string TenantId,
    string Environment,
    string CompanyId,
    string ClientId,
    string ClientSecret,
    /// <summary>Extra/maatwerk entiteit (bv. custom RMA API-page), optioneel.</summary>
    string? ExtraEntiteit);

public sealed record BcTreffer(string Type, string Nummer, string? Klant, string? Datum, string? Status, decimal? Totaal);

/// <summary>
/// Koppeling met Microsoft Dynamics 365 Business Central via de standaard
/// API v2.0 (OData) en OAuth2 client-credentials. Beheerd via de UI
/// (App_Data/bc-instellingen.json). Zoekt order-/creditinformatie bij een
/// RMA-/ordernummer, zodat de begeleide modus direct context heeft.
///
/// Standaard worden salesOrders en salesCreditMemos doorzocht; echte sales
/// return orders vereisen in BC een maatwerk-API-page — die kan als
/// "extra entiteit" worden geconfigureerd.
/// </summary>
public sealed class BcService(IHttpClientFactory httpFactory, IWebHostEnvironment environment, ProtectedSettingsStore settingsStore)
{
    private readonly string _pad = Path.Combine(environment.ContentRootPath, "App_Data", "bc-instellingen.json");
    private readonly object _slot = new();
    private (string Token, DateTimeOffset Vervalt)? _tokenCache;

    public BcInstellingen? Lees()
    {
        lock (_slot)
        {
            return settingsStore.Read<BcInstellingen>(_pad, "ServiceProcesgids.BusinessCentral.Settings.v1");
        }
    }

    public void Bewaar(BcInstellingen instellingen)
    {
        lock (_slot)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_pad)!);
            settingsStore.Write(_pad, "ServiceProcesgids.BusinessCentral.Settings.v1", instellingen);
            _tokenCache = null;
        }
    }

    public bool IsGeconfigureerd
    {
        get
        {
            var s = Lees();
            return s is not null
                && !string.IsNullOrWhiteSpace(s.TenantId)
                && !string.IsNullOrWhiteSpace(s.ClientId)
                && !string.IsNullOrWhiteSpace(s.ClientSecret);
        }
    }

    public async Task<IReadOnlyList<BcTreffer>> ZoekAsync(string nummer, CancellationToken ct)
    {
        var s = Lees() ?? throw new InvalidOperationException("Business Central is niet geconfigureerd.");
        var token = await TokenAsync(s, ct);
        var http = httpFactory.CreateClient("bc");
        http.Timeout = TimeSpan.FromSeconds(30);
        http.DefaultRequestHeaders.Authorization = new("Bearer", token);

        var basis = $"https://api.businesscentral.dynamics.com/v2.0/{s.TenantId}/{s.Environment}/api/v2.0/companies({s.CompanyId})";
        var veilig = nummer.Replace("'", "''");
        var resultaten = new List<BcTreffer>();

        // Standaard-entiteiten + optionele maatwerk-entiteit (bv. RMA API-page).
        var bronnen = new List<(string Entiteit, string Type)>
        {
            ("salesOrders", "Verkooporder"),
            ("salesCreditMemos", "Creditnota"),
        };
        if (!string.IsNullOrWhiteSpace(s.ExtraEntiteit))
        {
            bronnen.Add((s.ExtraEntiteit!, s.ExtraEntiteit!));
        }

        foreach (var (entiteit, type) in bronnen)
        {
            try
            {
                var url = $"{basis}/{entiteit}?$filter=number eq '{veilig}' or externalDocumentNumber eq '{veilig}'&$top=5";
                using var res = await http.GetAsync(url, ct);
                if (!res.IsSuccessStatusCode) continue;
                using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(ct));
                foreach (var item in doc.RootElement.GetProperty("value").EnumerateArray())
                {
                    resultaten.Add(new BcTreffer(
                        type,
                        Tekst(item, "number") ?? "?",
                        Tekst(item, "customerName") ?? Tekst(item, "customerNumber"),
                        Tekst(item, "orderDate") ?? Tekst(item, "creditMemoDate") ?? Tekst(item, "documentDate"),
                        Tekst(item, "status"),
                        item.TryGetProperty("totalAmountIncludingTax", out var t) && t.ValueKind == JsonValueKind.Number
                            ? t.GetDecimal()
                            : null));
                }
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch
            {
                // Entiteit niet beschikbaar in deze omgeving: sla over.
            }
        }

        return resultaten;
    }

    private async Task<string> TokenAsync(BcInstellingen s, CancellationToken ct)
    {
        if (_tokenCache is { } cache && cache.Vervalt > DateTimeOffset.UtcNow.AddMinutes(2))
        {
            return cache.Token;
        }

        var http = httpFactory.CreateClient("bc");
        using var res = await http.PostAsync(
            $"https://login.microsoftonline.com/{s.TenantId}/oauth2/v2.0/token",
            new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["grant_type"] = "client_credentials",
                ["client_id"] = s.ClientId,
                ["client_secret"] = s.ClientSecret,
                ["scope"] = "https://api.businesscentral.dynamics.com/.default",
            }), ct);

        var tekst = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"BC-token mislukt ({(int)res.StatusCode}): {tekst[..Math.Min(tekst.Length, 200)]}");
        }

        using var doc = JsonDocument.Parse(tekst);
        var token = doc.RootElement.GetProperty("access_token").GetString()!;
        var geldig = doc.RootElement.TryGetProperty("expires_in", out var e) ? e.GetInt32() : 3600;
        _tokenCache = (token, DateTimeOffset.UtcNow.AddSeconds(geldig));
        return token;
    }

    private static string? Tekst(JsonElement el, string naam) =>
        el.TryGetProperty(naam, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
}
