using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using ServiceProcesgids.Api.Models;

namespace ServiceProcesgids.Api.Services;

/// <summary>
/// "Inloggen met ChatGPT" (Codex-abonnement) via OAuth2/PKCE — dezelfde flow
/// als de Codex CLI en OpenClaw, geport uit AegisPT:
///   authorize: https://auth.openai.com/oauth/authorize (S256, scopes
///   openid profile email offline_access, callback http://localhost:1455/auth/callback)
///   token:     https://auth.openai.com/oauth/token (authorization_code / refresh_token)
///   chat:      POST https://chatgpt.com/backend-api/codex/responses (SSE)
///
/// De vaste callback-poort 1455 hoort bij de publieke Codex-client; daarom
/// start de server tijdens het koppelen een tijdelijke listener op die poort.
/// Dit werkt wanneer de browser op dezelfde machine draait als de app
/// (zelfstandige modus) — voor een centrale server is de API-sleutelroute
/// de juiste keuze.
/// </summary>
public sealed class ChatGptOAuthService(
    IHttpClientFactory httpFactory,
    IWebHostEnvironment environment,
    RuntimeConfig runtimeConfig,
    IDataProtectionProvider dataProtection,
    ILogger<ChatGptOAuthService> logger)
{
    private const string ClientId = "app_EMoamEEZ73f0CkXaXp7hrann";
    private const string AuthorizeUrl = "https://auth.openai.com/oauth/authorize";
    private const string TokenUrl = "https://auth.openai.com/oauth/token";
    private const string RedirectUri = "http://localhost:1455/auth/callback";
    private const string Scopes = "openid profile email offline_access";
    private const string BackendUrl = "https://chatgpt.com/backend-api/codex/responses";

    private readonly string _pad = Path.Combine(environment.ContentRootPath, "App_Data", "chatgpt-oauth.json");
    private readonly IDataProtector _protector =
        dataProtection.CreateProtector("ServiceProcesgids.LegacyChatGptOAuth.v1");
    private readonly object _slot = new();
    private (string State, string Verifier)? _pending;
    private CancellationTokenSource? _listenerStop;
    private bool _listenerActief;

    public sealed record TokenSet(string AccessToken, string? RefreshToken, string? IdToken, DateTimeOffset VerlooptOp, string? AccountId);
    private sealed record ProtectedTokenEnvelope(int Version, string ProtectedPayload, DateTimeOffset UpdatedAt);

    public bool IsAvailable => runtimeConfig.CanUseLocalChatGptOAuth;
    public bool IsGekoppeld => Lees() is not null;

    /// <summary>
    /// Migreert een eventueel plaintext prototypebestand ook wanneer de lokale
    /// OAuth-capability niet geactiveerd mag worden. Zo blijft een upgrade niet
    /// met een ongebruikt maar leesbaar tokenbestand achter.
    /// </summary>
    public void SecureStoredTokens()
    {
        lock (_slot)
        {
            if (!File.Exists(_pad))
            {
                return;
            }

            try
            {
                var json = File.ReadAllText(_pad);
                var envelope = JsonSerializer.Deserialize<ProtectedTokenEnvelope>(json, JsonOptions);
                if (envelope is { Version: 1 } && !string.IsNullOrWhiteSpace(envelope.ProtectedPayload))
                {
                    return;
                }

                var legacy = JsonSerializer.Deserialize<TokenSet>(json, JsonOptions)
                    ?? throw new JsonException("Leeg tokenbestand.");
                Bewaar(legacy);
            }
            catch (AiConfigurationException)
            {
                throw;
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException or CryptographicException)
            {
                throw new AiConfigurationException(
                    "ai-legacy-token-unreadable",
                    "Het lokale OAuth-tokenbestand kan niet veilig worden gemigreerd.",
                    ex);
            }
        }
    }

    public TokenSet? Lees()
    {
        SecureStoredTokens();
        if (!IsAvailable)
        {
            return null;
        }

        lock (_slot)
        {
            if (!File.Exists(_pad)) return null;
            try
            {
                var json = File.ReadAllText(_pad);
                var envelope = JsonSerializer.Deserialize<ProtectedTokenEnvelope>(json, JsonOptions);
                if (envelope is { Version: 1 } && !string.IsNullOrWhiteSpace(envelope.ProtectedPayload))
                {
                    return JsonSerializer.Deserialize<TokenSet>(
                        _protector.Unprotect(envelope.ProtectedPayload),
                        JsonOptions);
                }

                return null;
            }
            catch
            {
                return null;
            }
        }
    }

    public void Ontkoppel()
    {
        CancellationTokenSource? listenerStop;
        lock (_slot)
        {
            if (File.Exists(_pad)) File.Delete(_pad);
            _pending = null;
            _listenerActief = false;
            listenerStop = _listenerStop;
        }
        listenerStop?.Cancel();
    }

    public bool ListenerActief
    {
        get
        {
            lock (_slot)
            {
                return _listenerActief && _listenerStop is { IsCancellationRequested: false };
            }
        }
    }

    /// <summary>
    /// Start de koppel-flow: PKCE + state genereren, tijdelijke listener op
    /// :1455 starten en de authorize-URL teruggeven om in de browser te openen.
    /// </summary>
    public string StartLogin()
    {
        if (!IsAvailable)
        {
            throw new AiConfigurationException(
                "ai-legacy-oauth-disabled",
                "De lokale ChatGPT/Codex OAuth-koppeling is uitsluitend beschikbaar in een lokale offline installatie.");
        }

        var verifier = Base64Url(RandomNumberGenerator.GetBytes(64));
        var challenge = Base64Url(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));
        var state = Base64Url(RandomNumberGenerator.GetBytes(24));
        lock (_slot)
        {
            _pending = (state, verifier);
        }

        StartCallbackListener();

        var query = new Dictionary<string, string>
        {
            ["response_type"] = "code",
            ["client_id"] = ClientId,
            ["redirect_uri"] = RedirectUri,
            ["scope"] = Scopes,
            ["state"] = state,
            ["code_challenge"] = challenge,
            ["code_challenge_method"] = "S256",
            ["id_token_add_organizations"] = "true",
            ["originator"] = "service-procesgids",
        };
        return $"{AuthorizeUrl}?{string.Join('&', query.Select(kv => $"{kv.Key}={Uri.EscapeDataString(kv.Value)}"))}";
    }

    private void StartCallbackListener()
    {
        var stop = new CancellationTokenSource(TimeSpan.FromMinutes(5));
        CancellationTokenSource? vorigeListener;
        lock (_slot)
        {
            vorigeListener = _listenerStop;
            _listenerStop = stop;
            _listenerActief = false;
        }
        vorigeListener?.Cancel();

        _ = Task.Run(async () =>
        {
            using var listener = new HttpListener();
            listener.Prefixes.Add("http://localhost:1455/");
            try
            {
                listener.Start();
            }
            catch (Exception ex)
            {
                logger.LogWarning(
                    "Kon lokale OAuth-callback-listener niet starten. ErrorType={ErrorType}",
                    ex.GetType().Name);
                lock (_slot)
                {
                    if (_listenerStop == stop)
                    {
                        _listenerStop = null;
                        _listenerActief = false;
                        _pending = null;
                    }
                }
                stop.Dispose();
                return;
            }

            try
            {
                lock (_slot)
                {
                    if (_listenerStop != stop || stop.IsCancellationRequested)
                    {
                        return;
                    }
                    _listenerActief = true;
                }

                while (!stop.IsCancellationRequested)
                {
                    var contextTask = listener.GetContextAsync();
                    var klaar = await Task.WhenAny(contextTask, Task.Delay(Timeout.Infinite, stop.Token));
                    if (klaar != contextTask) break;
                    var ctx = contextTask.Result;

                    if (ctx.Request.Url?.AbsolutePath != "/auth/callback")
                    {
                        await Antwoord(ctx, 404, "Onbekend pad.");
                        continue;
                    }

                    var code = ctx.Request.QueryString["code"];
                    var state = ctx.Request.QueryString["state"];
                    if (_pending is not { } pending || string.IsNullOrEmpty(code) || state != pending.State)
                    {
                        await Antwoord(ctx, 400, "Ongeldige of verlopen koppelpoging. Start opnieuw vanuit de Procesgids.");
                        continue;
                    }

                    try
                    {
                        await WisselCodeAsync(code, pending.Verifier, stop.Token);
                        _pending = null;
                        await Antwoord(ctx, 200,
                            "✅ Gekoppeld! Je kunt dit tabblad sluiten en teruggaan naar de Service Procesgids.");
                        break;
                    }
                    catch (Exception ex)
                    {
                        logger.LogWarning(
                            "Lokale OAuth-tokenwissel mislukt. ErrorType={ErrorType}",
                            ex.GetType().Name);
                        await Antwoord(ctx, 502, "Koppelen mislukt. Controleer de serverlog en probeer opnieuw.");
                    }
                }
            }
            finally
            {
                listener.Stop();
                lock (_slot)
                {
                    if (_listenerStop == stop)
                    {
                        _listenerStop = null;
                        _listenerActief = false;
                        _pending = null;
                    }
                }
                stop.Dispose();
            }
        }, CancellationToken.None);
    }

    private static async Task Antwoord(HttpListenerContext ctx, int status, string tekst)
    {
        var html = $"<!doctype html><html lang=\"nl\"><meta charset=\"utf-8\"><body style=\"font-family:system-ui;display:grid;place-items:center;height:100vh;background:#f6f6f8\"><div style=\"background:#fff;border:1px solid #e6e6ea;border-top:4px solid #ea5b0c;border-radius:12px;padding:2rem;max-width:420px\"><strong style=\"color:#ea5b0c\">PROCESGIDS</strong> Processen &amp; borging<p>{WebUtility.HtmlEncode(tekst)}</p></div></body></html>";
        var buffer = Encoding.UTF8.GetBytes(html);
        ctx.Response.StatusCode = status;
        ctx.Response.ContentType = "text/html; charset=utf-8";
        await ctx.Response.OutputStream.WriteAsync(buffer);
        ctx.Response.Close();
    }

    private async Task WisselCodeAsync(string code, string verifier, CancellationToken ct)
    {
        var http = httpFactory.CreateClient("ai");
        using var res = await http.PostAsync(TokenUrl, new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["grant_type"] = "authorization_code",
            ["client_id"] = ClientId,
            ["code"] = code,
            ["redirect_uri"] = RedirectUri,
            ["code_verifier"] = verifier,
        }), ct);
        await BewaarTokensAsync(res, ct);
    }

    public async Task<TokenSet> VerversIndienNodigAsync(CancellationToken ct)
    {
        var huidig = Lees() ?? throw new InvalidOperationException("ChatGPT is niet gekoppeld.");
        if (huidig.VerlooptOp > DateTimeOffset.UtcNow.AddMinutes(2))
        {
            return huidig;
        }

        if (string.IsNullOrEmpty(huidig.RefreshToken))
        {
            throw new InvalidOperationException("Sessie verlopen en geen refresh token; koppel opnieuw.");
        }

        var http = httpFactory.CreateClient("ai");
        using var res = await http.PostAsync(TokenUrl, new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["grant_type"] = "refresh_token",
            ["client_id"] = ClientId,
            ["refresh_token"] = huidig.RefreshToken,
        }), ct);
        return await BewaarTokensAsync(res, ct);
    }

    private async Task<TokenSet> BewaarTokensAsync(HttpResponseMessage res, CancellationToken ct)
    {
        var tekst = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode)
        {
            throw new AiProviderException("chatgpt-oauth", (int)res.StatusCode);
        }

        using var doc = JsonDocument.Parse(tekst);
        var root = doc.RootElement;
        var access = root.GetProperty("access_token").GetString()!;
        var refresh = root.TryGetProperty("refresh_token", out var r) ? r.GetString() : Lees()?.RefreshToken;
        var idToken = root.TryGetProperty("id_token", out var i) ? i.GetString() : Lees()?.IdToken;
        var geldig = root.TryGetProperty("expires_in", out var e) ? e.GetInt32() : 3600;

        var set = new TokenSet(access, refresh, idToken, DateTimeOffset.UtcNow.AddSeconds(geldig), AccountIdUit(idToken));
        Bewaar(set);
        return set;
    }

    /// <summary>chatgpt_account_id uit de id_token-claims (https://api.openai.com/auth).</summary>
    private static string? AccountIdUit(string? idToken)
    {
        if (string.IsNullOrEmpty(idToken)) return null;
        try
        {
            var delen = idToken.Split('.');
            if (delen.Length < 2) return null;
            var payload = delen[1].Replace('-', '+').Replace('_', '/');
            payload = payload.PadRight(payload.Length + (4 - payload.Length % 4) % 4, '=');
            using var doc = JsonDocument.Parse(Convert.FromBase64String(payload));
            if (doc.RootElement.TryGetProperty("https://api.openai.com/auth", out var auth) &&
                auth.TryGetProperty("chatgpt_account_id", out var acc))
            {
                return acc.GetString();
            }
        }
        catch
        {
            // Claims niet leesbaar: account-id is optioneel.
        }
        return null;
    }

    /// <summary>Vraag via het ChatGPT/Codex-abonnement (SSE: delta's + response.completed-fallback).</summary>
    public async Task<string> VraagAsync(string model, string systeem, string vraag, CancellationToken ct)
    {
        var tokens = await VerversIndienNodigAsync(ct);
        var http = httpFactory.CreateClient("ai");
        http.Timeout = TimeSpan.FromSeconds(180);

        using var req = new HttpRequestMessage(HttpMethod.Post, BackendUrl);
        req.Headers.Add("Authorization", $"Bearer {tokens.AccessToken}");
        req.Headers.Add("Accept", "text/event-stream");
        if (!string.IsNullOrEmpty(tokens.AccountId))
        {
            req.Headers.Add("chatgpt-account-id", tokens.AccountId);
        }
        req.Content = new StringContent(JsonSerializer.Serialize(new
        {
            model,
            store = false,
            stream = true,
            instructions = systeem,
            input = new object[]
            {
                new
                {
                    type = "message",
                    role = "user",
                    content = new object[] { new { type = "input_text", text = vraag } },
                },
            },
        }), Encoding.UTF8, "application/json");

        using var res = await http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
        if (!res.IsSuccessStatusCode)
        {
            throw new AiProviderException("chatgpt", (int)res.StatusCode);
        }

        var delta = new StringBuilder();
        string? compleet = null;
        using var stream = await res.Content.ReadAsStreamAsync(ct);
        using var lezer = new StreamReader(stream);
        while (await lezer.ReadLineAsync(ct) is { } regel)
        {
            if (!regel.StartsWith("data: ", StringComparison.Ordinal)) continue;
            var payload = regel[6..];
            if (payload == "[DONE]") continue;
            JsonDocument doc;
            try { doc = JsonDocument.Parse(payload); } catch { continue; }
            using (doc)
            {
                var type = doc.RootElement.TryGetProperty("type", out var t) ? t.GetString() : null;
                if (type == "response.output_text.delta" &&
                    doc.RootElement.TryGetProperty("delta", out var d))
                {
                    delta.Append(d.GetString());
                }
                else if (type == "response.completed")
                {
                    compleet = TekstUitCompleted(doc.RootElement);
                }
                else if (type is "error" or "response.failed")
                {
                    throw new AiProviderException("chatgpt");
                }
            }
        }

        var resultaat = delta.Length > 0 ? delta.ToString() : compleet ?? "";
        return string.IsNullOrWhiteSpace(resultaat)
            ? throw new InvalidOperationException("Geen tekst in het ChatGPT-antwoord.")
            : resultaat;
    }

    private static string? TekstUitCompleted(JsonElement root)
    {
        if (!root.TryGetProperty("response", out var resp) || !resp.TryGetProperty("output", out var output))
        {
            return null;
        }

        var sb = new StringBuilder();
        foreach (var item in output.EnumerateArray())
        {
            if (!item.TryGetProperty("content", out var content)) continue;
            foreach (var deel in content.EnumerateArray())
            {
                if (deel.TryGetProperty("text", out var tekst))
                {
                    sb.Append(tekst.GetString());
                }
            }
        }
        return sb.Length > 0 ? sb.ToString() : null;
    }

    private static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private void Bewaar(TokenSet tokenSet)
    {
        var payload = JsonSerializer.Serialize(tokenSet, JsonOptions);
        var envelope = new ProtectedTokenEnvelope(
            1,
            _protector.Protect(payload),
            DateTimeOffset.UtcNow);
        DataProtectionAiCredentialStore.AtomicWrite(
            _pad,
            JsonSerializer.Serialize(envelope, JsonOptions));
    }

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = true
    };
}
