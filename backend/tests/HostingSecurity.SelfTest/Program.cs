using Microsoft.AspNetCore.Builder;
using System.Net;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using ServiceProcesgids.Api.Services;

var directory = Path.Combine(Path.GetTempPath(), $"spg-hosting-security-{Guid.NewGuid():N}");
Directory.CreateDirectory(directory);
try
{
    await ProxyBoundaryAsync();
    Console.WriteLine("alleen expliciet vertrouwde proxy kan HTTPS en client-IP doorgeven: OK");
    OnlineRequiresKeys();
    Console.WriteLine("online keyring heeft geen onversleutelde fallback: OK");
    ProtectedKeyringRoundtrip();
    Console.WriteLine("versleutelde keyring is herstelbaar met eigen certificaat en sleutel: OK");
    ConnectorSecrets();
    Console.WriteLine("BC, SMTP en webhook veilig opgeslagen; plaintext migreert en corruptie faalt gesloten: OK");
}
finally { Directory.Delete(directory, recursive: true); }

async Task ProxyBoundaryAsync()
{
    var known = IPAddress.Parse("172.28.7.2");
    var options = new ForwardedHeadersOptions();
    HostingSecurityConfiguration.ConfigureForwarding(options, [known]);
    var middleware = new ForwardedHeadersMiddleware(_ => Task.CompletedTask,
        NullLoggerFactory.Instance, Options.Create(options));
    foreach (var trusted in new[] { false, true })
    {
        var context = new DefaultHttpContext();
        context.Connection.RemoteIpAddress = trusted ? known : IPAddress.Parse("172.28.7.3");
        context.Request.Scheme = "http";
        context.Request.Headers["X-Forwarded-Proto"] = "https";
        context.Request.Headers["X-Forwarded-For"] = "198.51.100.20";
        await middleware.Invoke(context);
        Assert(context.Request.IsHttps == trusted, "Onvertrouwde proxy kon transport overschrijven.");
        Assert((context.Connection.RemoteIpAddress?.ToString() == "198.51.100.20") == trusted, "Onvertrouwde proxy kon client-IP overschrijven.");
    }
    Assert(options.ForwardLimit == 1 && options.KnownIPNetworks.Count == 0, "Proxygrens is te ruim.");
    Expect<InvalidOperationException>(() => HostingSecurityConfiguration.ConfigureForwarding(new(), []));
    var config = Config(new() { ["ServiceProcesgids:ReverseProxy:KnownProxies:0"] = "*" });
    Expect<InvalidOperationException>(() => HostingSecurityConfiguration.ReadKnownProxies(config));
    Assert(HostingSecurityConfiguration.ReadKnownProxies(Config()).Length == 0, "Lege configuratie vertrouwt proxies.");
}

void OnlineRequiresKeys()
{
    var services = new ServiceCollection();
    var builder = services.AddDataProtection();
    Expect<InvalidOperationException>(() => HostingSecurityConfiguration.ProtectKeyRing(builder, Config(), true));
    HostingSecurityConfiguration.ProtectKeyRing(builder, Config(), false);
    Expect<InvalidOperationException>(() => HostingSecurityConfiguration.ProtectKeyRing(builder,
        Config(new() { ["ServiceProcesgids:DataProtection:CertificatePath"] = "certificate.pem" }), false));
}

void ProtectedKeyringRoundtrip()
{
    using var rsa = RSA.Create(2048);
    var request = new CertificateRequest("CN=SPG isolated selftest", rsa, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
    using var certificate = request.CreateSelfSigned(DateTimeOffset.UtcNow.AddMinutes(-1), DateTimeOffset.UtcNow.AddDays(1));
    var certificatePath = Path.Combine(directory, "certificate.pem");
    var privateKeyPath = Path.Combine(directory, "private-key.pem");
    File.WriteAllText(certificatePath, certificate.ExportCertificatePem());
    File.WriteAllText(privateKeyPath, rsa.ExportPkcs8PrivateKeyPem());
    var config = Config(new()
    {
        ["ServiceProcesgids:DataProtection:CertificatePath"] = certificatePath,
        ["ServiceProcesgids:DataProtection:PrivateKeyPath"] = privateKeyPath
    });
    var keyDirectory = Path.Combine(directory, "protected-keyring");
    string protectedValue;
    using (var services = BuildProvider(config, keyDirectory))
        protectedValue = services.GetRequiredService<IDataProtectionProvider>().CreateProtector("recovery-test").Protect("test-only-credential");
    using (var services = BuildProvider(config, keyDirectory))
        Assert(services.GetRequiredService<IDataProtectionProvider>().CreateProtector("recovery-test").Unprotect(protectedValue) == "test-only-credential", "Herstel na providerherstart mislukt.");
    var keyFile = Directory.GetFiles(keyDirectory, "key-*.xml").Single();
    Assert(File.ReadAllText(keyFile).Contains("encryptedSecret"), "Keyring is onversleuteld opgeslagen.");
}

void ConnectorSecrets()
{
    var environment = new TestEnvironment(Path.Combine(directory, "connectors"));
    var provider = DataProtectionProvider.Create(new DirectoryInfo(Path.Combine(directory, "connector-keys")));
    var store = new ProtectedSettingsStore(provider);
    var bc = new BcService(new NoNetworkFactory(), environment, store);
    var mail = new MeldingenService(new NoNetworkFactory(), environment, NullLogger<MeldingenService>.Instance, store);
    var bcSettings = new BcInstellingen("tenant", "test", "company", "client", "bc-test-only-secret", null);
    var smtpSettings = new MailInstellingen("smtp.invalid", 587, true, "test", "smtp-test-only-secret", "test@example.invalid", "recipient@example.invalid");
    var webhook = new MeldingenInstellingen("https://example.invalid/test-only-webhook-token", true, true, true);
    bc.Bewaar(bcSettings);
    mail.BewaarMail(smtpSettings);
    mail.Bewaar(webhook);
    Assert(bc.Lees() == bcSettings && mail.LeesMail() == smtpSettings && mail.Lees() == webhook, "Connector roundtrip veranderde instellingen.");
    foreach (var (name, secret) in new[] { ("bc-instellingen.json", bcSettings.ClientSecret), ("mail-instellingen.json", smtpSettings.Wachtwoord!), ("meldingen-instellingen.json", webhook.WebhookUrl) })
        Assert(!File.ReadAllText(Path.Combine(environment.ContentRootPath, "App_Data", name)).Contains(secret), "Plaintext credential op disk.");
    var path = Path.Combine(environment.ContentRootPath, "App_Data", "bc-instellingen.json");
    File.WriteAllText(path, JsonSerializer.Serialize(bcSettings));
    Assert(bc.Lees() == bcSettings && !File.ReadAllText(path).Contains(bcSettings.ClientSecret), "Legacy BC is niet gemigreerd.");
    path = Path.Combine(environment.ContentRootPath, "App_Data", "mail-instellingen.json");
    File.WriteAllText(path, JsonSerializer.Serialize(smtpSettings));
    Assert(mail.LeesMail() == smtpSettings && !File.ReadAllText(path).Contains(smtpSettings.Wachtwoord!), "Legacy SMTP is niet gemigreerd.");
    const string corrupted = "{\"format\":\"spg-protected-settings-v1\",\"protectedPayload\":\"corrupt\"}";
    File.WriteAllText(path, corrupted);
    Expect<InvalidOperationException>(() => mail.LeesMail());
    Assert(File.ReadAllText(path) == corrupted, "Onleesbare configuratie is stil overschreven.");
}

ServiceProvider BuildProvider(IConfiguration config, string keyDirectory)
{
    var services = new ServiceCollection();
    services.AddLogging();
    var builder = services.AddDataProtection().SetApplicationName("ServiceProcesgids").PersistKeysToFileSystem(new DirectoryInfo(keyDirectory));
    HostingSecurityConfiguration.ProtectKeyRing(builder, config, true);
    return services.BuildServiceProvider();
}

static IConfiguration Config(Dictionary<string, string?>? values = null) => new ConfigurationBuilder().AddInMemoryCollection(values ?? []).Build();
static void Assert(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }
static void Expect<T>(Action action) where T : Exception
{
    try { action(); }
    catch (T) { return; }
    throw new InvalidOperationException($"Verwacht {typeof(T).Name}.");
}

sealed class NoNetworkFactory : IHttpClientFactory
{
    public HttpClient CreateClient(string name) => throw new InvalidOperationException("Netwerk is niet toegestaan tijdens deze test.");
}
sealed class TestEnvironment(string path) : IWebHostEnvironment
{
    public string ApplicationName { get; set; } = "HostingSecurity.SelfTest";
    public string EnvironmentName { get; set; } = "Production";
    public string ContentRootPath { get; set; } = path;
    public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    public string WebRootPath { get; set; } = path;
    public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
}