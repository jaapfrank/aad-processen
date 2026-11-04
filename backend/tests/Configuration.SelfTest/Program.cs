using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using ServiceProcesgids.Api.Contract;
using ServiceProcesgids.Api.Data;
using ServiceProcesgids.Api.Data.Entities;
using ServiceProcesgids.Api.Models;
using ServiceProcesgids.Api.Services;
using System.Text.Json;

var checks = new List<(string Name, Func<Task> Run)>
{
    ("AI-vervolgvraag ontvangt historie zonder procesopslag", TestConversationHistory),
    ("runtime standard/database is eerlijk", TestStandardRuntime),
    ("demo is uitsluitend expliciet in development", TestDemoGate),
    ("runtime mismatch heeft geen fallback", TestRuntimeMismatch),
    ("auth en opslag hebben geen impliciete fallback", TestAuthAndStorageGate),
    ("bootstrap vereist expliciet secret", TestBootstrapGate),
    ("development-loginbypass is expliciet en fail-closed", TestDevelopmentLoginGate),
    ("development-sessie heeft begrensde identiteit en requestgrens", TestDevelopmentLoginSession),
    ("database-init seedt geen admin of fixtures stil", TestDatabaseInitializerGates),
    ("lokale OAuth volgt offline/local capability en niet de environmentnaam", TestLocalOAuthGate),
    ("lokaal OAuth-token migreert encrypted en centrale runtime blijft dicht", TestLocalOAuthTokenMigration),
    ("oude ChatGPT-providerconfig migreert naar lokale OAuth-compatibiliteitsmodus", TestLegacyChatGptOAuthSettingsMigration),
    ("tenantcredential is versleuteld, herkenbaar en revoke is fail-closed", TestTenantProtectedCredential),
    ("legacy plaintext credential migreert veilig naar BYO", TestLegacyCredentialMigration),
    ("oude mislabeled managed-config migreert naar BYO", TestMislabeledManagedMigration),
    ("Managed AI gebruikt uitsluitend expliciete platformconfig", TestManagedPlatformCredential),
    ("Managed AI unavailable en oude BYO-config blijven fail-closed", TestManagedUnavailable),
    ("audit start/bevestiging stempelt actor, tijd, revisie en bewijs", TestAuditAssessmentContract),
    ("Azure endpointvalidatie voorkomt generieke SSRF-route", TestAzureEndpointValidation)
};

var failed = false;
foreach (var check in checks)
{
    try
    {
        await check.Run();
        Console.WriteLine($"{check.Name}: OK");
    }
    catch (Exception ex)
    {
        failed = true;
        Console.Error.WriteLine($"{check.Name}: MISLUKT ({ex.GetType().Name}: {ex.Message})");
    }
}

return failed ? 1 : 0;

static Task TestStandardRuntime()
{
    var runtime = RuntimeConfig.From(
        Config(),
        new TestEnvironment(Environments.Production, CreateTemporaryDirectory()));
    Assert(runtime.RuntimeMode == RuntimeConfig.StandardMode, "Verkeerde standaardmodus.");
    Assert(runtime.DataSource == RuntimeConfig.DatabaseDataSource, "Verkeerde databron.");
    Assert(!runtime.ShouldSeedDemoFixtures, "Standard runtime mag geen fixtures seeden.");
    var publicConfig = runtime.ToAppConfig().Runtime!;
    Assert(publicConfig.Profile == "r0", "Runtimeprofiel ontbreekt.");
    Assert(publicConfig.TenantType == "single-tenant", "Tenanttype ontbreekt.");
    Assert(!publicConfig.FallbackUsed, "Fallback mag nooit als gebruikt worden gemeld.");
    Assert(!publicConfig.DevelopmentLoginAvailable, "Development-login mag niet standaard actief zijn.");
    return Task.CompletedTask;
}

static Task TestDemoGate()
{
    var values = new Dictionary<string, string?>
    {
        ["ServiceProcesgids:Runtime:Mode"] = "demo",
        ["ServiceProcesgids:Runtime:DataSource"] = "demo-fixtures"
    };
    ExpectThrows<InvalidOperationException>(() =>
        RuntimeConfig.From(
            Config(values),
            new TestEnvironment(Environments.Production, CreateTemporaryDirectory())));
    var development = RuntimeConfig.From(
        Config(values),
        new TestEnvironment(Environments.Development, CreateTemporaryDirectory()));
    Assert(development.ShouldSeedDemoFixtures, "Development-demo moet expliciet fixtures activeren.");
    return Task.CompletedTask;
}

static Task TestRuntimeMismatch()
{
    var values = new Dictionary<string, string?>
    {
        ["ServiceProcesgids:Runtime:Mode"] = "standard",
        ["ServiceProcesgids:Runtime:DataSource"] = "demo-fixtures"
    };
    ExpectThrows<InvalidOperationException>(() =>
        RuntimeConfig.From(
            Config(values),
            new TestEnvironment(Environments.Development, CreateTemporaryDirectory())));
    values["ServiceProcesgids:Runtime:DataSource"] = "mock";
    ExpectThrows<InvalidOperationException>(() =>
        RuntimeConfig.From(
            Config(values),
            new TestEnvironment(Environments.Development, CreateTemporaryDirectory())));
    return Task.CompletedTask;
}

static Task TestAuthAndStorageGate()
{
    var values = new Dictionary<string, string?>
    {
        ["ServiceProcesgids:AuthMode"] = "onbekend"
    };
    ExpectThrows<InvalidOperationException>(() =>
        RuntimeConfig.From(
            Config(values),
            new TestEnvironment(Environments.Production, CreateTemporaryDirectory())));

    values["ServiceProcesgids:AuthMode"] = "local";
    values["ServiceProcesgids:Storage"] = "cloud";
    ExpectThrows<InvalidOperationException>(() =>
        RuntimeConfig.From(
            Config(values),
            new TestEnvironment(Environments.Production, CreateTemporaryDirectory())));

    values["ServiceProcesgids:Storage"] = "db";
    ExpectThrows<InvalidOperationException>(() =>
        RuntimeConfig.From(
            Config(values),
            new TestEnvironment(Environments.Production, CreateTemporaryDirectory())));

    values["ConnectionStrings:SqlServer"] =
        "Server=(local);Database=ServiceProcesgidsSelfTest;Integrated Security=true";
    var configured = RuntimeConfig.From(
        Config(values),
        new TestEnvironment(Environments.Production, CreateTemporaryDirectory()));
    Assert(configured.Storage == "db", "Expliciete SQL Server-opslag werd niet geaccepteerd.");
    return Task.CompletedTask;
}

static Task TestBootstrapGate()
{
    var values = new Dictionary<string, string?>
    {
        ["ServiceProcesgids:LocalUser:BootstrapEnabled"] = "true"
    };
    ExpectThrows<InvalidOperationException>(() =>
        RuntimeConfig.From(
            Config(values),
            new TestEnvironment(Environments.Development, CreateTemporaryDirectory())));
    values["ServiceProcesgids:LocalUser:Password"] = "test-only-explicit-secret";
    var runtime = RuntimeConfig.From(
        Config(values),
        new TestEnvironment(Environments.Development, CreateTemporaryDirectory()));
    Assert(runtime.LocalUserBootstrapEnabled, "Expliciete bootstrap werd niet geactiveerd.");
    Assert(runtime.LocalUserPassword == "test-only-explicit-secret", "Expliciet secret werd niet gelezen.");
    return Task.CompletedTask;
}

static Task TestDevelopmentLoginGate()
{
    var requested = new Dictionary<string, string?>
    {
        ["ServiceProcesgids:Development:SkipLogin"] = "true"
    };

#if DEBUG
    var development = RuntimeConfig.From(
        Config(requested),
        new TestEnvironment(Environments.Development, CreateTemporaryDirectory()));
    Assert(development.DevelopmentSkipLogin, "Expliciete development-loginaanvraag werd niet gelezen.");
    Assert(development.DevelopmentLoginAvailable, "Veilige lokale Debug/Development-run activeerde de loginbypass niet.");
    Assert(
        development.ToAppConfig().Runtime?.DevelopmentLoginAvailable == true,
        "De publieke runtimeconfig meldt de actieve development-login niet.");
#else
    ExpectThrows<InvalidOperationException>(() =>
        RuntimeConfig.From(
            Config(requested),
            new TestEnvironment(Environments.Development, CreateTemporaryDirectory())));
#endif

    ExpectThrows<InvalidOperationException>(() =>
        RuntimeConfig.From(
            Config(requested),
            new TestEnvironment(Environments.Production, CreateTemporaryDirectory())));

    var online = new Dictionary<string, string?>(requested)
    {
        ["ServiceProcesgids:Online"] = "true"
    };
    ExpectThrows<InvalidOperationException>(() =>
        RuntimeConfig.From(
            Config(online),
            new TestEnvironment(Environments.Development, CreateTemporaryDirectory())));

    var entra = new Dictionary<string, string?>(requested)
    {
        ["ServiceProcesgids:AuthMode"] = "entra"
    };
    ExpectThrows<InvalidOperationException>(() =>
        RuntimeConfig.From(
            Config(entra),
            new TestEnvironment(Environments.Development, CreateTemporaryDirectory())));

    var sharedStorage = new Dictionary<string, string?>(requested)
    {
        ["ServiceProcesgids:Storage"] = "db",
        ["ConnectionStrings:SqlServer"] =
            "Server=(local);Database=ServiceProcesgidsSelfTest;Integrated Security=true"
    };
    ExpectThrows<InvalidOperationException>(() =>
        RuntimeConfig.From(
            Config(sharedStorage),
            new TestEnvironment(Environments.Development, CreateTemporaryDirectory())));

    var normal = RuntimeConfig.From(
        Config(),
        new TestEnvironment(Environments.Development, CreateTemporaryDirectory()));
    Assert(!normal.DevelopmentLoginAvailable, "De loginbypass werd zonder expliciete vlag geactiveerd.");

    return Task.CompletedTask;
}

static Task TestDevelopmentLoginSession()
{
    var principal = DevelopmentLoginSession.CreatePrincipal();
    Assert(principal.Identity?.IsAuthenticated == true, "Development-principal is niet geauthenticeerd.");
    Assert(
        principal.FindFirst("bron")?.Value == DevelopmentLoginSession.Source,
        "Development-principal heeft geen herkenbare bronclaim.");
    Assert(
        RoleNames.All.All(principal.IsInRole),
        "Development-principal bevat niet alle expliciete testrollen.");

    var issuedAt = DateTimeOffset.UtcNow;
    var properties = DevelopmentLoginSession.CreateAuthenticationProperties(issuedAt);
    Assert(!properties.IsPersistent, "Development-sessie mag niet persistent zijn.");
    Assert(properties.AllowRefresh == false, "Development-sessie mag niet verversbaar zijn.");
    Assert(
        properties.IssuedUtc is { } actualIssuedAt &&
        properties.ExpiresUtc is { } actualExpiresAt &&
        Math.Abs((actualExpiresAt - actualIssuedAt).TotalHours - 1) < 0.001,
        "Development-sessie heeft niet de begrensde looptijd van één uur.");

    var context = new DefaultHttpContext();
    context.Connection.RemoteIpAddress = System.Net.IPAddress.Loopback;
    context.Request.Headers[DevelopmentLoginSession.HeaderName] = DevelopmentLoginSession.HeaderValue;
    context.Request.Headers.Origin = "http://localhost:4173";
    Assert(
        DevelopmentLoginSession.IsSafeLocalRequest(context),
        "Directe loopbackrequest met development-header werd ten onrechte geweigerd.");

    context.Request.Headers["X-Forwarded-For"] = "127.0.0.1";
    Assert(
        !DevelopmentLoginSession.IsSafeLocalRequest(context),
        "Een forwarded request passeerde de lokale development-requestgrens.");

    context.Request.Headers.Remove("X-Forwarded-For");
    context.Connection.RemoteIpAddress = System.Net.IPAddress.Parse("192.0.2.10");
    Assert(
        !DevelopmentLoginSession.IsSafeLocalRequest(context),
        "Een niet-lokale request passeerde de development-requestgrens.");

    return Task.CompletedTask;
}

static Task TestLocalOAuthGate()
{
    var localProduction = RuntimeConfig.From(
        Config(),
        new TestEnvironment(Environments.Production, CreateTemporaryDirectory()));
    Assert(
        localProduction.CanUseLocalChatGptOAuth,
        "Een zelfstandige local/offline installatie verloor OAuth door de environmentnaam.");

    var explicitlyDisabled = RuntimeConfig.From(
        Config(new Dictionary<string, string?>
        {
            ["ServiceProcesgids:Ai:EnableLocalChatGptOAuth"] = "false"
        }),
        new TestEnvironment(Environments.Production, CreateTemporaryDirectory()));
    Assert(
        !explicitlyDisabled.CanUseLocalChatGptOAuth,
        "De expliciete lokale OAuth-kill-switch werd genegeerd.");

    var legacyAlias = RuntimeConfig.From(
        Config(new Dictionary<string, string?>
        {
            ["ServiceProcesgids:Ai:AllowLegacyChatGptOAuth"] = "true"
        }),
        new TestEnvironment(Environments.Production, CreateTemporaryDirectory()));
    Assert(
        legacyAlias.CanUseLocalChatGptOAuth,
        "De bestaande AllowLegacyChatGptOAuth-configuratiesleutel werkt niet meer als alias.");

    var newKeyWins = RuntimeConfig.From(
        Config(new Dictionary<string, string?>
        {
            ["ServiceProcesgids:Ai:EnableLocalChatGptOAuth"] = "false",
            ["ServiceProcesgids:Ai:AllowLegacyChatGptOAuth"] = "true"
        }),
        new TestEnvironment(Environments.Production, CreateTemporaryDirectory()));
    Assert(
        !newKeyWins.CanUseLocalChatGptOAuth,
        "De nieuwe lokale capability-kill-switch heeft geen voorrang op de compatibiliteitsalias.");

    var onlineValues = new Dictionary<string, string?>
    {
        ["ServiceProcesgids:Online"] = "true",
        ["ServiceProcesgids:Ai:EnableLocalChatGptOAuth"] = "true"
    };
    var online = RuntimeConfig.From(
        Config(onlineValues),
        new TestEnvironment(Environments.Production, CreateTemporaryDirectory()));
    Assert(!online.CanUseLocalChatGptOAuth, "Een online/centrale runtime activeerde lokale OAuth.");

    var entra = RuntimeConfig.From(
        Config(new Dictionary<string, string?>
        {
            ["ServiceProcesgids:AuthMode"] = "entra",
            ["ServiceProcesgids:Ai:EnableLocalChatGptOAuth"] = "true"
        }),
        new TestEnvironment(Environments.Production, CreateTemporaryDirectory()));
    Assert(!entra.CanUseLocalChatGptOAuth, "Een Entra-runtime activeerde lokale OAuth.");
    return Task.CompletedTask;
}

static Task TestLocalOAuthTokenMigration()
{
    var root = CreateTemporaryDirectory();
    var environment = new TestEnvironment(Environments.Production, root);
    var runtime = new RuntimeConfig
    {
        EnvironmentName = Environments.Production,
        AuthMode = "local",
        Online = false,
        LocalChatGptOAuthEnabled = true
    };
    var provider = DataProtectionProvider.Create(new DirectoryInfo(Path.Combine(root, "keys")));
    var service = new ChatGptOAuthService(
        new TestHttpClientFactory(),
        environment,
        runtime,
        provider,
        NullLogger<ChatGptOAuthService>.Instance);
    Directory.CreateDirectory(Path.Combine(root, "App_Data"));
    const string token = "local-oauth-plaintext-selftest";
    File.WriteAllText(
        Path.Combine(root, "App_Data", "chatgpt-oauth.json"),
        $$"""{"accessToken":"{{token}}","refreshToken":null,"idToken":null,"verlooptOp":"2030-01-01T00:00:00Z","accountId":null}""");

    service.SecureStoredTokens();
    var tokenPath = Path.Combine(root, "App_Data", "chatgpt-oauth.json");
    var protectedFile = File.ReadAllText(tokenPath);
    Assert(!protectedFile.Contains(token, StringComparison.Ordinal), "Lokaal OAuth-token bleef plaintext.");
    Assert(service.IsAvailable, "Local/offline OAuth bleef afhankelijk van Development.");
    Assert(service.Lees()?.AccessToken == token, "Versleuteld lokaal OAuth-token is niet meer leesbaar.");
    if (!OperatingSystem.IsWindows())
    {
        const UnixFileMode unsafeBits =
            UnixFileMode.GroupRead |
            UnixFileMode.GroupWrite |
            UnixFileMode.GroupExecute |
            UnixFileMode.OtherRead |
            UnixFileMode.OtherWrite |
            UnixFileMode.OtherExecute;
        Assert(
            (File.GetUnixFileMode(tokenPath) & unsafeBits) == 0,
            "Het versleutelde lokale OAuth-tokenbestand is leesbaar voor group/other.");
    }

    var onlineService = new ChatGptOAuthService(
        new TestHttpClientFactory(),
        environment,
        new RuntimeConfig
        {
            EnvironmentName = Environments.Production,
            AuthMode = "local",
            Online = true,
            LocalChatGptOAuthEnabled = true
        },
        provider,
        NullLogger<ChatGptOAuthService>.Instance);
    Assert(!onlineService.IsAvailable, "De online/centrale runtime activeerde een lokaal OAuth-token.");
    Assert(onlineService.Lees() is null, "De online/centrale runtime las een lokaal OAuth-token.");
    return Task.CompletedTask;
}

static async Task TestDatabaseInitializerGates()
{
    var contentRoot = Directory.GetCurrentDirectory();
    const string password = "database-selftest-explicit-secret";

    var blockedPath = Path.Combine(
        Path.GetTempPath(),
        "spg-config-selftest",
        Guid.NewGuid().ToString("N") + ".db");
    await using (var blockedDb = CreateDb(blockedPath))
    {
        var runtime = new RuntimeConfig
        {
            AuthMode = "local",
            EnvironmentName = Environments.Development,
            RuntimeMode = RuntimeConfig.StandardMode,
            DataSource = RuntimeConfig.DatabaseDataSource,
            LocalUserBootstrapEnabled = false
        };
        var initializer = new DatabaseInitializer(
            blockedDb,
            new TestEnvironment(Environments.Development, contentRoot),
            runtime,
            new PasswordHashService(),
            new ProcessVersionService(blockedDb));
        await ExpectThrowsAsync<InvalidOperationException>(() => initializer.InitializeAsync());
    }

    var allowedPath = Path.Combine(
        Path.GetTempPath(),
        "spg-config-selftest",
        Guid.NewGuid().ToString("N") + ".db");
    await using (var allowedDb = CreateDb(allowedPath))
    {
        var runtime = new RuntimeConfig
        {
            AuthMode = "local",
            EnvironmentName = Environments.Development,
            RuntimeMode = RuntimeConfig.StandardMode,
            DataSource = RuntimeConfig.DatabaseDataSource,
            LocalUserBootstrapEnabled = true,
            LocalUserPassword = password
        };
        var passwordHasher = new PasswordHashService();
        var initializer = new DatabaseInitializer(
            allowedDb,
            new TestEnvironment(Environments.Development, contentRoot),
            runtime,
            passwordHasher,
            new ProcessVersionService(allowedDb));
        await initializer.InitializeAsync();

        var admin = await allowedDb.LocalUsers.SingleAsync();
        Assert(passwordHasher.VerifyPassword(password, admin.PasswordHash), "Expliciete bootstrapcredential is niet correct gehasht.");
        Assert(await allowedDb.Processes.CountAsync() == 0, "Standard/database heeft stil procesfixtures geseed.");

        const string replacementAttempt = "database-selftest-must-not-replace";
        var repeatedInitializer = new DatabaseInitializer(
            allowedDb,
            new TestEnvironment(Environments.Development, contentRoot),
            new RuntimeConfig
            {
                AuthMode = "local",
                EnvironmentName = Environments.Development,
                RuntimeMode = RuntimeConfig.StandardMode,
                DataSource = RuntimeConfig.DatabaseDataSource,
                LocalUserBootstrapEnabled = true,
                LocalUserPassword = replacementAttempt
            },
            passwordHasher,
            new ProcessVersionService(allowedDb));
        await repeatedInitializer.InitializeAsync();

        admin = await allowedDb.LocalUsers.SingleAsync();
        Assert(passwordHasher.VerifyPassword(password, admin.PasswordHash), "Herhaalde bootstrap heeft het bestaande wachtwoord gewijzigd.");
        Assert(!passwordHasher.VerifyPassword(replacementAttempt, admin.PasswordHash), "Herhaalde bootstrap heeft een bestaand account gereset.");
    }
}

static Task TestTenantProtectedCredential()
{
    var root = CreateTemporaryDirectory();
    var environment = new TestEnvironment(Environments.Development, root);
    var configuration = Config(new Dictionary<string, string?>
    {
        ["ServiceProcesgids:Ai:Provider"] = "openai",
        ["ServiceProcesgids:Ai:Model"] = "explicit-test-model"
    });
    var provider = DataProtectionProvider.Create(new DirectoryInfo(Path.Combine(root, "keys")));
    var store = new DataProtectionAiCredentialStore(provider, environment);
    var settings = new AiSettingsService(environment, configuration, store);
    settings.Bewaar(new AiInstellingen("openai", null, "explicit-test-model", "byo"));
    Assert(
        AiSettingsService.ResolveRequestedMode("managed", true, "disabled") == "byo",
        "Een inline legacy API-key moet semantisch als tenant-BYO worden behandeld.");

    const string secret = "selftest-tenant-secret-value";
    var metadata = settings.RotateCredential(secret);
    Assert(metadata.Present && metadata.Fingerprint?.StartsWith("sha256:") == true, "Metadata ontbreekt.");
    var resolved = settings.ResolveCredential(settings.LeesOfStandaard());
    Assert(resolved.Secret == secret, "Credential round-trip faalt.");
    Assert(resolved.Source == "tenant-protected", "Tenantcredential heeft de verkeerde bronnaam.");
    Assert(settings.LeesOfStandaard().Mode == "byo", "Credentialrotatie moet expliciet BYO activeren.");
    var credentialFile = File.ReadAllText(Path.Combine(root, "App_Data", "ai-provider-credential.json"));
    var settingsFile = File.ReadAllText(Path.Combine(root, "App_Data", "ai-instellingen.json"));
    Assert(!credentialFile.Contains(secret, StringComparison.Ordinal), "Credential staat plaintext in secretbestand.");
    Assert(!settingsFile.Contains(secret, StringComparison.Ordinal), "Credential staat plaintext in settingsbestand.");

    settings.Bewaar(settings.LeesOfStandaard() with { Mode = "disabled" });
    Assert(
        settings.GetTenantCredentialMetadata().Present,
        "Disabled verbergt ten onrechte dat een tenantcredential opgeslagen staat.");
    Assert(
        settings.GetRuntimeSnapshot().Credential.Secret is null,
        "Disabled mag een opgeslagen tenantcredential nooit voor runtime activeren.");
    settings.RevokeCredential();
    var current = settings.LeesOfStandaard();
    Assert(current.Mode == "disabled", "Revoke moet AI fail-closed uitschakelen.");
    Assert(settings.ResolveCredential(current).Secret is null, "Revoke laat nog een credential door.");
    Assert(
        !settings.GetTenantCredentialMetadata().Present,
        "Revoke vanuit disabled heeft de opgeslagen tenantcredential niet verwijderd.");

    const string replacement = "atomic-one-request-secret";
    settings.SaveWithCredential(
        new AiInstellingen("anthropic", null, "atomic-model", "byo"),
        replacement);
    var snapshot = settings.GetRuntimeSnapshot();
    Assert(
        snapshot.Configured.Provider == "anthropic" &&
        snapshot.Configured.Model == "atomic-model" &&
        snapshot.Credential.Secret == replacement,
        "Settings en credential vormen geen consistente runtime-snapshot.");
    Assert(
        !File.ReadAllText(Path.Combine(root, "App_Data", "ai-instellingen.json"))
            .Contains(replacement, StringComparison.Ordinal),
        "Atomische settings-save lekte het secret naar instellingen.");
    return Task.CompletedTask;
}

static Task TestLegacyCredentialMigration()
{
    var root = CreateTemporaryDirectory();
    var environment = new TestEnvironment(Environments.Development, root);
    var configuration = Config();
    var provider = DataProtectionProvider.Create(new DirectoryInfo(Path.Combine(root, "keys")));
    var store = new DataProtectionAiCredentialStore(provider, environment);
    var settings = new AiSettingsService(environment, configuration, store);
    Directory.CreateDirectory(Path.Combine(root, "App_Data"));
    const string secret = "legacy-plaintext-selftest";
    File.WriteAllText(
        Path.Combine(root, "App_Data", "ai-instellingen.json"),
        $$"""{"provider":"openai","model":"explicit-test-model","apiKey":"{{secret}}"}""");

    var migrated = settings.LeesOfStandaard();
    Assert(migrated.Mode == "byo", "Legacy secret moet naar de tenantgebonden BYO-modus migreren.");
    Assert(settings.ResolveCredential(migrated).Secret == secret, "Gemigreerde credential is niet leesbaar.");
    Assert(
        settings.ResolveCredential(migrated).Source == "tenant-protected",
        "Gemigreerde tenantcredential heeft geen semantische bronnaam.");
    var sanitized = File.ReadAllText(Path.Combine(root, "App_Data", "ai-instellingen.json"));
    Assert(!sanitized.Contains(secret, StringComparison.Ordinal), "Legacy plaintext is niet verwijderd.");
    Assert(!sanitized.Contains("apiKey", StringComparison.OrdinalIgnoreCase), "Legacy secretveld is blijven staan.");
    Assert(sanitized.Contains("\"schemaVersion\": 2", StringComparison.Ordinal), "Migratieschema is niet herkenbaar vastgelegd.");
    return Task.CompletedTask;
}

static async Task TestLegacyChatGptOAuthSettingsMigration()
{
    var root = CreateTemporaryDirectory();
    var environment = new TestEnvironment(Environments.Production, root);
    var configuration = Config();
    var provider = DataProtectionProvider.Create(new DirectoryInfo(Path.Combine(root, "keys")));
    var store = new DataProtectionAiCredentialStore(provider, environment);
    var settings = new AiSettingsService(environment, configuration, store);
    Directory.CreateDirectory(Path.Combine(root, "App_Data"));
    File.WriteAllText(
        Path.Combine(root, "App_Data", "ai-instellingen.json"),
        """{"provider":"chatgpt","model":"gpt-5.5"}""");

    var migrated = settings.LeesOfStandaard();
    Assert(migrated.Provider == "chatgpt", "De oude ChatGPT-providerkeuze ging verloren.");
    Assert(
        migrated.Mode == AiSettingsService.BringYourOwnMode,
        "De oude ChatGPT-provider werd niet naar de interne OAuth-compatibiliteitsmodus gemigreerd.");
    Assert(migrated.Model == "gpt-5.5", "Het expliciet opgeslagen OAuth-model ging verloren.");
    Assert(migrated.SchemaVersion == 2, "De lokale OAuth-configuratie kreeg geen herkenbare schemaversie.");
    Assert(
        !store.GetMetadata().Present && migrated.TenantCredentialProvider is null,
        "Een lokale OAuth-configuratie werd ten onrechte als tenant-API-credential gemigreerd.");

    var sanitized = File.ReadAllText(Path.Combine(root, "App_Data", "ai-instellingen.json"));
    Assert(
        sanitized.Contains("\"provider\": \"chatgpt\"", StringComparison.Ordinal) &&
        sanitized.Contains("\"mode\": \"byo\"", StringComparison.Ordinal),
        "De gemigreerde lokale OAuth-providerintentie is niet duurzaam opgeslagen.");
    Assert(
        !sanitized.Contains("apiKey", StringComparison.OrdinalIgnoreCase),
        "De lokale OAuth-configuratiemigratie introduceerde een API-keyveld.");

    using var db = CreateDb(Path.Combine(root, "oauth-status.db"));
    var localOAuth = new ChatGptOAuthService(
        new TestHttpClientFactory(),
        environment,
        new RuntimeConfig
        {
            EnvironmentName = Environments.Production,
            AuthMode = "local",
            Online = false,
            LocalChatGptOAuthEnabled = true
        },
        provider,
        NullLogger<ChatGptOAuthService>.Instance);
    var localAi = new AiService(
        new TestHttpClientFactory(),
        settings,
        localOAuth,
        db,
        NullLogger<AiService>.Instance);
    var localStatus = localAi.LeesEffectieveInstellingen();
    Assert(
        localStatus.Provider == "chatgpt" &&
        localStatus.Mode == AiSettingsService.BringYourOwnMode &&
        localStatus.ActivationState == "missing-credential" &&
        localStatus.CredentialSource == "legacy-oauth",
        "De gemigreerde provider wordt niet als beschikbare lokale OAuth-configuratie gerapporteerd.");
    var missingSession = await CaptureThrowsAsync<AiConfigurationException>(() =>
        localAi.TestConnectionAsync(CancellationToken.None));
    Assert(
        missingSession.Message.Contains("lokale ChatGPT/Codex OAuth", StringComparison.Ordinal),
        "Een ontbrekende lokale OAuth-sessie wordt nog als generieke providercredential beschreven.");

    var centralOAuth = new ChatGptOAuthService(
        new TestHttpClientFactory(),
        environment,
        new RuntimeConfig
        {
            EnvironmentName = Environments.Production,
            AuthMode = "entra",
            Online = true,
            LocalChatGptOAuthEnabled = true
        },
        provider,
        NullLogger<ChatGptOAuthService>.Instance);
    var centralAi = new AiService(
        new TestHttpClientFactory(),
        settings,
        centralOAuth,
        db,
        NullLogger<AiService>.Instance);
    var centralStatus = centralAi.LeesEffectieveInstellingen();
    Assert(
        centralStatus.ActivationState == "legacy-disabled" &&
        centralStatus.ErrorCode == "ai-legacy-oauth-disabled",
        "Een centrale/Entra-runtime rapporteert lokale OAuth niet fail-closed.");
}

static Task TestMislabeledManagedMigration()
{
    var root = CreateTemporaryDirectory();
    var environment = new TestEnvironment(Environments.Development, root);
    var configuration = Config();
    var provider = DataProtectionProvider.Create(new DirectoryInfo(Path.Combine(root, "keys")));
    var store = new DataProtectionAiCredentialStore(provider, environment);
    const string secret = "v1-mislabeled-managed-secret";
    store.Rotate(secret);
    Directory.CreateDirectory(Path.Combine(root, "App_Data"));
    File.WriteAllText(
        Path.Combine(root, "App_Data", "ai-instellingen.json"),
        """{"provider":"openai","model":"legacy-model","mode":"managed","schemaVersion":1}""");
    var settings = new AiSettingsService(environment, configuration, store);

    var migrated = settings.LeesOfStandaard();
    var resolved = settings.ResolveCredential(migrated);
    Assert(migrated.Mode == "byo", "V1 managed + protected credential moet naar BYO migreren.");
    Assert(resolved.Secret == secret, "De beschermde v1-credential ging tijdens migratie verloren.");
    Assert(resolved.Source == "tenant-protected", "De oude verkeerde bronnaam bleef semantisch actief.");
    var sanitized = File.ReadAllText(Path.Combine(root, "App_Data", "ai-instellingen.json"));
    Assert(sanitized.Contains("\"mode\": \"byo\"", StringComparison.Ordinal), "Gemigreerde modus is niet herkenbaar opgeslagen.");
    Assert(sanitized.Contains("\"schemaVersion\": 2", StringComparison.Ordinal), "Schema v2 is niet opgeslagen.");
    Assert(!sanitized.Contains(secret, StringComparison.Ordinal), "Secret lekte naar het instellingenbestand.");
    return Task.CompletedTask;
}

static Task TestManagedPlatformCredential()
{
    var root = CreateTemporaryDirectory();
    var environment = new TestEnvironment(Environments.Development, root);
    const string secret = "platform-only-selftest";
    var configuration = Config(new Dictionary<string, string?>
    {
        ["ServiceProcesgids:Ai:Managed:Enabled"] = "true",
        ["ServiceProcesgids:Ai:Managed:Provider"] = "anthropic",
        ["ServiceProcesgids:Ai:Managed:Model"] = "central-model",
        ["ServiceProcesgids:Ai:Managed:ApiKey"] = secret
    });
    var provider = DataProtectionProvider.Create(new DirectoryInfo(Path.Combine(root, "keys")));
    var store = new DataProtectionAiCredentialStore(provider, environment);
    Directory.CreateDirectory(Path.Combine(root, "App_Data"));
    File.WriteAllText(
        Path.Combine(root, "App_Data", "ai-instellingen.json"),
        """{"provider":"openai","model":"legacy-model","mode":"managed","schemaVersion":1}""");
    var settings = new AiSettingsService(environment, configuration, store);
    var migrated = settings.LeesOfStandaard();
    Assert(
        migrated.Mode == "byo" &&
        settings.GetRuntimeSnapshot().Credential.Secret is null,
        "Een v1 managed-config zonder tenantsecret werd stil door het nieuwe platformprofiel geactiveerd.");
    const string tenantOpenAiSecret = "tenant-openai-must-not-cross-provider";
    settings.SaveWithCredential(
        new AiInstellingen("openai", null, "tenant-model", "byo"),
        tenantOpenAiSecret);
    settings.Bewaar(new AiInstellingen("anthropic", null, "central-model", "managed"));
    settings.Bewaar(new AiInstellingen("anthropic", null, "tenant-anthropic-model", "byo"));
    var mismatchedByo = settings.GetRuntimeSnapshot();
    Assert(
        mismatchedByo.Credential.Secret is null &&
        mismatchedByo.Credential.Metadata.Present &&
        settings.GetTenantCredentialProvider() == "openai",
        "Een OpenAI-tenantcredential werd na Managed Anthropic als passende Anthropic-BYO-credential hergebruikt.");
    settings.Bewaar(new AiInstellingen("anthropic", null, "central-model", "managed"));

    var capability = settings.GetManagedAiCapability();
    Assert(capability.Available && capability.Profile is not null, "Managed capability werd niet beschikbaar.");
    Assert(!capability.NextStep.Contains(secret, StringComparison.Ordinal), "Managed capability lekt een secret.");
    var resolved = settings.ResolveCredential(capability.Profile!);
    Assert(resolved.Secret == secret, "Managed AI leest de expliciete platformcredential niet.");
    Assert(resolved.Source == "server-configuration", "Managed AI rapporteert niet de platformbron.");
    Assert(store.GetMetadata().Present, "De niet-actieve tenantcredential verdween stil bij Managed AI.");

    settings.RevokeCredential();
    Assert(!store.GetMetadata().Present, "Expliciete tenant-revoke verwijderde de oude tenantcredential niet.");
    Assert(
        settings.LeesOfStandaard().Mode == "managed",
        "Tenant-revoke heeft de actieve Managed AI-modus uitgeschakeld.");
    var revokeError = CaptureThrows<AiConfigurationException>(() => settings.RevokeCredential());
    Assert(
        revokeError.Code == "ai-tenant-credential-not-present",
        "Tenant-revoke blokkeert een platformcredential niet herkenbaar.");
    Assert(
        settings.ResolveCredential(capability.Profile!).Secret == secret,
        "Tenant-revoke heeft de platformcredential geraakt.");
    return Task.CompletedTask;
}

static async Task TestManagedUnavailable()
{
    var root = CreateTemporaryDirectory();
    var environment = new TestEnvironment(Environments.Development, root);
    const string ignoredLegacyServerSecret = "old-byo-server-secret-must-not-activate";
    var configuration = Config(new Dictionary<string, string?>
    {
        ["ServiceProcesgids:Ai:ApiKey"] = ignoredLegacyServerSecret
    });
    var provider = DataProtectionProvider.Create(new DirectoryInfo(Path.Combine(root, "keys")));
    var store = new DataProtectionAiCredentialStore(provider, environment);
    var settings = new AiSettingsService(environment, configuration, store);
    Directory.CreateDirectory(Path.Combine(root, "App_Data"));
    File.WriteAllText(
        Path.Combine(root, "App_Data", "ai-instellingen.json"),
        """{"provider":"openai","model":"legacy-byo-model","mode":"byo","schemaVersion":1}""");

    var migrated = settings.LeesOfStandaard();
    var byo = settings.ResolveCredential(migrated);
    Assert(migrated.SchemaVersion == 2, "Oude BYO-config is niet herkenbaar naar schema v2 gemigreerd.");
    Assert(byo.Secret is null && byo.Source == "none", "Oude serverconfig activeerde stil een BYO-credential.");
    var sanitized = File.ReadAllText(Path.Combine(root, "App_Data", "ai-instellingen.json"));
    Assert(!sanitized.Contains(ignoredLegacyServerSecret, StringComparison.Ordinal), "Oud serversecret lekte naar instellingen.");

    settings.Bewaar(new AiInstellingen("openai", null, "central-model", "managed"));
    var capability = settings.GetManagedAiCapability();
    Assert(!capability.Available, "Managed AI mag zonder platforminrichting niet beschikbaar zijn.");
    Assert(capability.ReasonCode == "managed-ai-not-enabled", "Managed blokkade is niet actiegericht herkenbaar.");

    var dbPath = Path.Combine(root, "status.db");
    await using var db = CreateDb(dbPath);
    var chatgpt = new ChatGptOAuthService(
        new TestHttpClientFactory(),
        environment,
        new RuntimeConfig { EnvironmentName = Environments.Development },
        provider,
        NullLogger<ChatGptOAuthService>.Instance);
    var ai = new AiService(
        new TestHttpClientFactory(),
        settings,
        chatgpt,
        db,
        NullLogger<AiService>.Instance);
    var status = ai.LeesEffectieveInstellingen();
    Assert(status.ActivationState == "managed-unavailable", "Managed unavailable heeft geen expliciete activatiestatus.");
    Assert(status.ErrorCode == "managed-ai-not-enabled", "Managed unavailable mist de concrete reden.");
    Assert(!status.HeeftSleutel && status.CredentialSource == "none", "Managed unavailable oogt onterecht bruikbaar.");
}

static async Task TestConversationHistory()
{
    var root = CreateTemporaryDirectory();
    var environment = new TestEnvironment(Environments.Development, root);
    var protection = DataProtectionProvider.Create(new DirectoryInfo(Path.Combine(root, "keys")));
    var settings = new AiSettingsService(environment, Config(new Dictionary<string, string?>()),
        new DataProtectionAiCredentialStore(protection, environment));
    settings.SaveWithCredential(new AiInstellingen("anthropic", null, "selftest-model", "byo"), "fake-secret-no-network");
    await using var db = CreateDb(Path.Combine(root, "conversation.db"));
    await db.Database.EnsureCreatedAsync();
    var transport = new ConversationTransport();
    var oauth = new ChatGptOAuthService(transport, environment,
        new RuntimeConfig { EnvironmentName = Environments.Development }, protection,
        NullLogger<ChatGptOAuthService>.Instance);
    var ai = new AiService(transport, settings, oauth, db, NullLogger<AiService>.Instance);
    var answer = await ai.VraagAsync("Heb je hem opgeslagen?", CancellationToken.None,
        [new AiGespreksbericht("gebruiker", "Maak pakketonderzoek"), new AiGespreksbericht("ai", "Voorstel Pakketonderzoek")]);
    Assert(answer == "Gesprek ontvangen", "Providerantwoord ontbreekt.");
    using var body = JsonDocument.Parse(transport.Body!);
    using var history = JsonDocument.Parse(body.RootElement.GetProperty("messages")[0].GetProperty("content").GetString()!);
    Assert(history.RootElement.GetProperty("eerdereBerichten")[1].GetProperty("tekst").GetString() == "Voorstel Pakketonderzoek", "Eerder AI-antwoord bereikte de provider niet.");
    Assert(history.RootElement.GetProperty("huidigeVraag").GetString() == "Heb je hem opgeslagen?", "Vervolgvraag ontbreekt.");
    Assert(body.RootElement.GetProperty("system").GetString()!.Contains("Je kunt zelf niets opslaan"), "Opslaggrens ontbreekt.");
    Assert(await db.Processes.CountAsync() == 0, "AI heeft onverwacht een proces opgeslagen.");
}

static async Task TestAuditAssessmentContract()
{
    var dbPath = Path.Combine(
        Path.GetTempPath(),
        "spg-config-selftest",
        Guid.NewGuid().ToString("N") + ".db");
    await using var db = CreateDb(dbPath);
    await db.Database.EnsureCreatedAsync();
    db.Processes.Add(new ProcessEntity
    {
        Id = "audit-proces",
        Hoofdproces = "Audit",
        Detailproces = "Handmatige beoordeling",
        Versie = "V1.7",
        Status = "live",
        LaatsteWijziging = "2026-07-27",
        Revision = 7,
        DocumentJson = "{}"
    });
    await db.SaveChangesAsync();

    var iso = new IsoService(db);
    var service = new AuditAssessmentService(db, iso, new AuditLogService(db));
    var actor = new User(
        "auditor-42",
        "Eva Auditor",
        "eva@example.test",
        "local",
        ["goedkeuren"],
        []);

    var started = await service.StartAsync("audit-proces", "iso27001", actor);
    Assert(started.GestartDoorId == actor.Id && started.GestartDoor == actor.Naam, "Auditstart mist de serveractor.");
    Assert(started.ProcessRevision == 7, "Auditstart is niet aan de actuele procesrevisie gebonden.");
    Assert(DateTimeOffset.TryParse(started.GestartOp, out _), "Auditstart mist een geldige servertijd.");
    Assert(DateTimeOffset.TryParse(started.VerlooptOp, out _), "Auditstart mist een geldige vervaltijd.");
    Assert(Guid.TryParseExact(started.AssessmentId, "N", out _), "Auditstart mist een server-assessment-id.");
    Assert(started.CatalogVersion == AuditControlCatalog.Version, "Auditstart mist de actuele catalogusversie.");

    var missingEvidence = CaptureThrows<AuditAssessmentException>(() =>
        AuditAssessmentService.Validate(new AuditBevestigingRequest(
            started.AssessmentId,
            started.ProcessRevision,
            "iso27001",
            "isms-risk",
            "voldoet",
            "Onderbouwde menselijke beoordeling.",
            null)));
    Assert(missingEvidence.Code == "audit-evidence-required", "Voldoet zonder bewijs faalt niet herkenbaar.");
    var missingExplanation = CaptureThrows<AuditAssessmentException>(() =>
        AuditAssessmentService.Validate(new AuditBevestigingRequest(
            started.AssessmentId,
            started.ProcessRevision,
            "iso27001",
            "isms-risk",
            "actie-nodig",
            "te kort",
            null)));
    Assert(missingExplanation.Code == "audit-explanation-required", "Ontbrekende uitleg faalt niet herkenbaar.");

    var withoutStart = await CaptureThrowsAsync<AuditAssessmentException>(() =>
        service.ConfirmAsync(
            "audit-proces",
            new AuditBevestigingRequest(
                Guid.NewGuid().ToString("N"),
                7,
                "iso27001",
                "isms-risk",
                "actie-nodig",
                "Er is een concrete vervolgactie nodig.",
                null),
            actor));
    Assert(
        withoutStart.Code == "audit-assessment-not-found" &&
        withoutStart.StatusCode == StatusCodes.Status409Conflict,
        "Bevestigen zonder persisted start wordt niet met 409 geweigerd.");

    var otherActor = new User(
        "auditor-99",
        "Andere Auditor",
        null,
        "local",
        ["goedkeuren"],
        []);
    var actorMismatch = await CaptureThrowsAsync<AuditAssessmentException>(() =>
        service.ConfirmAsync(
            "audit-proces",
            new AuditBevestigingRequest(
                started.AssessmentId,
                7,
                "iso27001",
                "isms-risk",
                "actie-nodig",
                "Deze actor mag het assessment niet overnemen.",
                null),
            otherActor));
    Assert(
        actorMismatch.Code == "audit-assessment-actor-mismatch" &&
        actorMismatch.StatusCode == StatusCodes.Status409Conflict,
        "Een andere actor kan een assessment overnemen.");

    var bogusControl = await CaptureThrowsAsync<AuditAssessmentException>(() =>
        service.ConfirmAsync(
            "audit-proces",
            new AuditBevestigingRequest(
                started.AssessmentId,
                7,
                "iso27001",
                "bogus-control",
                "actie-nodig",
                "Deze controle staat niet in de gedeelde catalogus.",
                null),
            actor));
    Assert(bogusControl.Code == "audit-control-not-manual", "Een willekeurig controle-id werd geaccepteerd.");
    var automaticControl = await CaptureThrowsAsync<AuditAssessmentException>(() =>
        service.ConfirmAsync(
            "audit-proces",
            new AuditBevestigingRequest(
                started.AssessmentId,
                7,
                "iso27001",
                "isms-controls",
                "actie-nodig",
                "Een automatische controle mag niet handmatig worden bevestigd.",
                null),
            actor));
    Assert(automaticControl.Code == "audit-control-not-manual", "Een automatische controle werd handmatig bevestigd.");

    var expiredAssessmentId = Guid.NewGuid().ToString("N");
    db.AuditLogs.Add(new AuditLogEntity
    {
        Action = "audit.review.start",
        EntityType = "process",
        EntityId = "audit-proces",
        ActorId = actor.Id,
        ActorName = actor.Naam,
        CreatedAtUtc = DateTimeOffset.UtcNow.AddHours(-3),
        DetailsJson = $$"""
          {"assessmentId":"{{expiredAssessmentId}}","kaderId":"iso27001","processRevision":7,"catalogVersion":"{{AuditControlCatalog.Version}}","expiresAt":"{{DateTimeOffset.UtcNow.AddHours(-1):O}}"}
          """
    });
    await db.SaveChangesAsync();
    var expired = await CaptureThrowsAsync<AuditAssessmentException>(() =>
        service.ConfirmAsync(
            "audit-proces",
            new AuditBevestigingRequest(
                expiredAssessmentId,
                7,
                "iso27001",
                "isms-risk",
                "actie-nodig",
                "Dit verlopen assessment mag niet bevestigen.",
                null),
            actor));
    Assert(
        expired.Code == "audit-assessment-expired" &&
        expired.StatusCode == StatusCodes.Status409Conflict,
        "Een verlopen assessment wordt niet met 409 geweigerd.");

    var confirmation = await service.ConfirmAsync(
        "audit-proces",
        new AuditBevestigingRequest(
            started.AssessmentId,
            started.ProcessRevision,
            "iso27001",
            "isms-risk",
            "voldoet",
            "Dossier en actuele processtap zijn door de auditor vergeleken.",
            "DMS-2026-0042"),
        actor);
    Assert(confirmation.BevestigdDoorId == actor.Id && confirmation.BevestigdDoor == actor.Naam, "Bevestiging mist de serveractor.");
    Assert(confirmation.AssessmentId == started.AssessmentId, "Bevestiging mist de persisted assessmentbinding.");
    Assert(confirmation.CatalogVersion == AuditControlCatalog.Version, "Bevestiging mist de catalogusversie.");
    Assert(confirmation.ProcessRevision == 7, "Bevestiging mist de serverrevisie.");
    Assert(confirmation.Bewijsreferentie == "DMS-2026-0042", "Bewijsreferentie is niet bewaard.");
    Assert(DateTimeOffset.TryParse(confirmation.BevestigdOp, out _), "Bevestiging mist een geldige servertijd.");

    var stored = await iso.GetConfigAsync("audit-proces");
    var persisted = stored.AuditBevestigingen?.Single();
    Assert(persisted == confirmation, "Servergestempelde bevestiging is niet persistent opgeslagen.");

    var spoof = confirmation with
    {
        BevestigdDoorId = "spoof",
        BevestigdDoor = "Browser",
        BevestigdOp = "2000-01-01T00:00:00Z",
        ProcessRevision = 1
    };
    await iso.SaveConfigAsync(
        new IsoProcessConfig("audit-proces", [], null, [spoof]),
        "Browser");
    stored = await iso.GetConfigAsync("audit-proces");
    persisted = stored.AuditBevestigingen?.Single();
    Assert(persisted == confirmation, "Generieke ISO-update kon serverstempels overschrijven.");

    var supersedingConfirmation = await service.ConfirmAsync(
        "audit-proces",
        new AuditBevestigingRequest(
            started.AssessmentId,
            started.ProcessRevision,
            "iso27001",
            "isms-risk",
            "actie-nodig",
            "Nieuwe informatie vereist een aantoonbare vervolgactie.",
            "ACTIE-2026-17"),
        actor);
    stored = await iso.GetConfigAsync("audit-proces");
    Assert(
        stored.AuditBevestigingen?.Single() == supersedingConfirmation,
        "De actuele projectie wijst niet naar de laatste bevestiging.");

    var process = await db.Processes.SingleAsync(item => item.Id == "audit-proces");
    process.Revision = 8;
    await db.SaveChangesAsync();
    var revisionMismatch = await CaptureThrowsAsync<AuditAssessmentException>(() =>
        service.ConfirmAsync(
            "audit-proces",
            new AuditBevestigingRequest(
                started.AssessmentId,
                7,
                "iso27001",
                "isms-access",
                "actie-nodig",
                "Het proces veranderde tijdens de beoordeling.",
                null),
            actor));
    Assert(
        revisionMismatch.Code == "audit-process-revision-changed" &&
        revisionMismatch.StatusCode == StatusCodes.Status409Conflict,
        "Een wijziging na auditstart wordt niet met revision-conflict geweigerd.");

    var auditEntries = await db.AuditLogs.OrderBy(item => item.Id).ToListAsync();
    Assert(auditEntries.Count == 4, "Auditstarts en beide bevestigingshistorie zijn niet append-only aanwezig.");
    Assert(auditEntries[0].Action == "audit.review.start", "Auditstart heeft de verkeerde actiecode.");
    Assert(auditEntries[2].Action == "audit.confirmation.record", "Auditbevestiging heeft de verkeerde actiecode.");
    Assert(auditEntries[3].Action == "audit.confirmation.record", "Opvolgende bevestiging is niet append-only gelogd.");
    Assert(
        auditEntries[2].DetailsJson?.Contains("DMS-2026-0042", StringComparison.Ordinal) == true,
        "Bewijsreferentie ontbreekt in de auditlog.");
    Assert(
        auditEntries[2].DetailsJson?.Contains("rationaleHash", StringComparison.Ordinal) == true,
        "Append-only auditgeschiedenis mist de rationale-hash.");
    Assert(
        auditEntries[3].DetailsJson?.Contains("supersedes", StringComparison.Ordinal) == true &&
        auditEntries[3].DetailsJson?.Contains(confirmation.AssessmentId, StringComparison.Ordinal) == true,
        "Opvolgende bevestiging verwijst niet aantoonbaar naar de vorige.");
    Assert(
        auditEntries.All(item => !item.DetailsJson!.Contains("certificaat verleend", StringComparison.OrdinalIgnoreCase)),
        "Auditlog suggereert onterecht certificering.");
}

static Task TestAzureEndpointValidation()
{
    Assert(
        AiSettingsService.IsAllowedAzureEndpoint("https://example.openai.azure.com"),
        "Officieel Azure-endpoint werd geweigerd.");
    Assert(
        !AiSettingsService.IsAllowedAzureEndpoint("https://example.openai.azure.com.evil.test"),
        "Host-suffixcontrole laat SSRF-achtige host toe.");
    Assert(
        !AiSettingsService.IsAllowedAzureEndpoint("http://example.openai.azure.com"),
        "Niet-HTTPS endpoint werd toegelaten.");
    return Task.CompletedTask;
}

static IConfiguration Config(Dictionary<string, string?>? values = null) =>
    new ConfigurationBuilder()
        .AddInMemoryCollection(values ?? new Dictionary<string, string?>())
        .Build();

static AppDbContext CreateDb(string path)
{
    Directory.CreateDirectory(Path.GetDirectoryName(path)!);
    var options = new DbContextOptionsBuilder<AppDbContext>()
        .UseSqlite($"Data Source={path}")
        .Options;
    return new AppDbContext(options);
}

static string CreateTemporaryDirectory()
{
    var path = Path.Combine(Path.GetTempPath(), "spg-config-selftest", Guid.NewGuid().ToString("N"));
    Directory.CreateDirectory(path);
    return path;
}

static void Assert(bool condition, string message)
{
    if (!condition)
    {
        throw new InvalidOperationException(message);
    }
}

static void ExpectThrows<TException>(Action action) where TException : Exception
{
    try
    {
        action();
    }
    catch (TException)
    {
        return;
    }

    throw new InvalidOperationException($"Verwachte {typeof(TException).Name} werd niet gegooid.");
}

static TException CaptureThrows<TException>(Action action) where TException : Exception
{
    try
    {
        action();
    }
    catch (TException exception)
    {
        return exception;
    }

    throw new InvalidOperationException($"Verwachte {typeof(TException).Name} werd niet gegooid.");
}

static async Task<TException> CaptureThrowsAsync<TException>(
    Func<Task> action) where TException : Exception
{
    try
    {
        await action();
    }
    catch (TException exception)
    {
        return exception;
    }

    throw new InvalidOperationException($"Verwachte {typeof(TException).Name} werd niet gegooid.");
}

static async Task ExpectThrowsAsync<TException>(Func<Task> action) where TException : Exception
{
    try
    {
        await action();
    }
    catch (TException)
    {
        return;
    }

    throw new InvalidOperationException($"Verwachte {typeof(TException).Name} werd niet gegooid.");
}

sealed class TestEnvironment(string environmentName, string contentRootPath) : IWebHostEnvironment
{
    public string ApplicationName { get; set; } = "Configuration.SelfTest";
    public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
    public string WebRootPath { get; set; } = contentRootPath;
    public string EnvironmentName { get; set; } = environmentName;
    public string ContentRootPath { get; set; } = contentRootPath;
    public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
}

sealed class TestHttpClientFactory : IHttpClientFactory
{
    public HttpClient CreateClient(string name) => new();
}

sealed class ConversationTransport : HttpMessageHandler, IHttpClientFactory
{
    public string? Body { get; private set; }
    public HttpClient CreateClient(string name) => new(this, false);
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        Body = await request.Content!.ReadAsStringAsync(cancellationToken);
        return new HttpResponseMessage(System.Net.HttpStatusCode.OK)
        {
            Content = new StringContent("""{"content":[{"type":"text","text":"Gesprek ontvangen"}]}""", System.Text.Encoding.UTF8, "application/json")
        };
    }
}
