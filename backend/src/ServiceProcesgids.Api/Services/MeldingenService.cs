using System.Net;
using System.Net.Mail;
using System.Text;
using System.Text.Json;

namespace ServiceProcesgids.Api.Services;

public sealed record MeldingenInstellingen(
    string WebhookUrl,
    bool BijSuggestie,
    bool BijIndienen,
    bool BijGoedkeuren);

/// <summary>SMTP-instellingen voor e-mail naar beheerders (App_Data/mail-instellingen.json).</summary>
public sealed record MailInstellingen(
    string SmtpHost,
    int SmtpPoort,
    bool Ssl,
    string? Gebruiker,
    string? Wachtwoord,
    string Afzender,
    /// <summary>Ontvangers, gescheiden door komma of puntkomma.</summary>
    string Ontvangers);

/// <summary>
/// Webhook-meldingen naar Teams/Slack (of elk endpoint dat {"text": "..."}
/// accepteert) bij suggesties, indienen en goedkeuren. Beheerbaar via de UI
/// (App_Data/meldingen-instellingen.json). Versturen is fire-and-forget:
/// een haperende webhook mag het proces nooit blokkeren.
/// </summary>
public sealed class MeldingenService(IHttpClientFactory httpFactory, IWebHostEnvironment environment, ILogger<MeldingenService> logger, ProtectedSettingsStore settingsStore)
{
    private readonly string _pad = Path.Combine(environment.ContentRootPath, "App_Data", "meldingen-instellingen.json");
    private readonly string _mailPad = Path.Combine(environment.ContentRootPath, "App_Data", "mail-instellingen.json");
    private readonly object _slot = new();

    public MeldingenInstellingen? Lees()
    {
        lock (_slot)
        {
            return settingsStore.Read<MeldingenInstellingen>(_pad, "ServiceProcesgids.Notifications.Webhook.v1");
        }
    }

    public void Bewaar(MeldingenInstellingen instellingen)
    {
        lock (_slot)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_pad)!);
            settingsStore.Write(_pad, "ServiceProcesgids.Notifications.Webhook.v1", instellingen);
        }
    }

    public MailInstellingen? LeesMail()
    {
        lock (_slot)
        {
            return settingsStore.Read<MailInstellingen>(_mailPad, "ServiceProcesgids.Notifications.Smtp.v1");
        }
    }

    public void BewaarMail(MailInstellingen instellingen)
    {
        lock (_slot)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_mailPad)!);
            settingsStore.Write(_mailPad, "ServiceProcesgids.Notifications.Smtp.v1", instellingen);
        }
    }

    /// <summary>Direct testmail; geeft de fout terug i.p.v. te slikken.</summary>
    public async Task TestMailAsync(CancellationToken ct)
    {
        var m = LeesMail() ?? throw new InvalidOperationException("Mail is niet geconfigureerd.");
        await VerstuurMailAsync(m, "Testmail Service Procesgids", "De mailkoppeling werkt. — Service Procesgids", ct);
    }

    private static async Task VerstuurMailAsync(MailInstellingen m, string onderwerp, string tekst, CancellationToken ct)
    {
        using var client = new SmtpClient(m.SmtpHost, m.SmtpPoort)
        {
            EnableSsl = m.Ssl,
            DeliveryMethod = SmtpDeliveryMethod.Network,
        };
        if (!string.IsNullOrWhiteSpace(m.Gebruiker))
        {
            client.Credentials = new NetworkCredential(m.Gebruiker, m.Wachtwoord ?? "");
        }

        using var bericht = new MailMessage { From = new MailAddress(m.Afzender), Subject = onderwerp, Body = tekst };
        foreach (var ontvanger in m.Ontvangers.Split([',', ';'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            bericht.To.Add(ontvanger);
        }
        if (bericht.To.Count == 0)
        {
            throw new InvalidOperationException("Geen ontvangers ingesteld.");
        }

        await client.SendMailAsync(bericht, ct);
    }

    public void StuurSuggestie(string procesId, string door) =>
        Stuur(s => s.BijSuggestie, $"💬 Nieuwe suggestie bij proces '{procesId}' (door {door}). Bekijk: Beheer → Suggesties.");

    public void StuurIndienen(string procesId, string door) =>
        Stuur(s => s.BijIndienen, $"📤 Proces '{procesId}' is ingediend ter goedkeuring (door {door}).");

    public void StuurGoedkeuren(string procesId, string door) =>
        Stuur(s => s.BijGoedkeuren, $"✅ Proces '{procesId}' is goedgekeurd en live gezet (door {door}).");

    /// <summary>Direct testbericht; geeft de fout terug i.p.v. te slikken.</summary>
    public async Task TestAsync(CancellationToken ct)
    {
        var s = Lees() ?? throw new InvalidOperationException("Meldingen zijn niet geconfigureerd.");
        await PostAsync(s.WebhookUrl, "🔔 Testmelding van de Service Procesgids — de webhook werkt.", ct);
    }

    private void Stuur(Func<MeldingenInstellingen, bool> aanstaand, string tekst)
    {
        // De gebeurtenis-schakelaars gelden voor beide kanalen (webhook + mail);
        // zonder meldingen-instellingen staan alle gebeurtenissen aan.
        var s = Lees();
        var aan = s is null || aanstaand(s);
        if (!aan)
        {
            return;
        }

        // Fire-and-forget: nooit het verzoek van de gebruiker blokkeren.
        if (s is not null && !string.IsNullOrWhiteSpace(s.WebhookUrl))
        {
            _ = Task.Run(async () =>
            {
                try
                {
                    await PostAsync(s.WebhookUrl, tekst, CancellationToken.None);
                }
                catch (Exception ex)
                {
                    logger.LogWarning(ex, "Webhook-melding mislukt.");
                }
            });
        }

        var mail = LeesMail();
        if (mail is not null && !string.IsNullOrWhiteSpace(mail.SmtpHost))
        {
            _ = Task.Run(async () =>
            {
                try
                {
                    await VerstuurMailAsync(mail, "Service Procesgids: melding", tekst, CancellationToken.None);
                }
                catch (Exception ex)
                {
                    logger.LogWarning(ex, "Mailmelding mislukt.");
                }
            });
        }
    }

    private async Task PostAsync(string url, string tekst, CancellationToken ct)
    {
        var http = httpFactory.CreateClient("webhook");
        http.Timeout = TimeSpan.FromSeconds(10);
        using var res = await http.PostAsync(
            url,
            new StringContent(JsonSerializer.Serialize(new { text = tekst }), Encoding.UTF8, "application/json"),
            ct);
        res.EnsureSuccessStatusCode();
    }
}
