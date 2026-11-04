namespace ServiceProcesgids.Api.Models;

public sealed class RuntimeConfig
{
    public const string StandardMode = "standard";
    public const string DemoMode = "demo";
    public const string DatabaseDataSource = "database";
    public const string DemoFixturesDataSource = "demo-fixtures";
#if DEBUG
    public const bool DevelopmentLoginBypassCompiled = true;
#else
    public const bool DevelopmentLoginBypassCompiled = false;
#endif

    public string AuthMode { get; init; } = "local";
    public string Storage { get; init; } = "local";
    public bool Online { get; init; }
    public string Version { get; init; } = "1.0.0-pilot";
    public string EnvironmentName { get; init; } = Environments.Production;
    public string RuntimeMode { get; init; } = StandardMode;
    public string DataSource { get; init; } = DatabaseDataSource;
    public string LocalUserId { get; init; } = "u-local-admin";
    public string LocalUserName { get; init; } = "Admin";
    public string? LocalUserEmail { get; init; }
    public string LocalUserPassword { get; init; } = "";
    public bool LocalUserBootstrapEnabled { get; init; }
    public string[] LocalRoles { get; init; } = RoleNames.All;
    /// <summary>
    /// Expliciete, deployment-only aanvraag om in een lokale Debug/Development-run
    /// een tijdelijke ontwikkelsessie te mogen uitgeven. Deze instelling is geen
    /// tenant- of beheerfunctie en wordt buiten de veilige ontwikkelgrens geweigerd.
    /// </summary>
    public bool DevelopmentSkipLogin { get; init; }
    /// <summary>
    /// Lokale ChatGPT/Codex OAuth-capability. De configuratiesleutel
    /// Ai:AllowLegacyChatGptOAuth blijft als compatibele alias leesbaar.
    /// Beschikbaarheid wordt daarnaast altijd begrensd tot local + offline.
    /// </summary>
    public bool LocalChatGptOAuthEnabled { get; init; } = true;
    public EntraConfig Entra { get; init; } = new();

    public bool IsLocalMode => AuthMode.Equals("local", StringComparison.OrdinalIgnoreCase);
    public bool IsEntraMode => AuthMode.Equals("entra", StringComparison.OrdinalIgnoreCase);
    public bool IsDevelopment => EnvironmentName.Equals(Environments.Development, StringComparison.OrdinalIgnoreCase);
    public bool IsLocalOfflineSingleTenant => IsLocalMode && !Online;
    public bool DevelopmentLoginAvailable =>
        DevelopmentSkipLogin &&
        DevelopmentLoginBypassCompiled &&
        IsDevelopment &&
        IsLocalOfflineSingleTenant &&
        Storage.Equals("local", StringComparison.OrdinalIgnoreCase);
    public bool CanUseLocalChatGptOAuth =>
        IsLocalOfflineSingleTenant && LocalChatGptOAuthEnabled;
    public bool IsDemoMode => RuntimeMode.Equals(DemoMode, StringComparison.OrdinalIgnoreCase);
    public bool ShouldSeedDemoFixtures => IsDemoMode &&
        DataSource.Equals(DemoFixturesDataSource, StringComparison.OrdinalIgnoreCase);

    public static RuntimeConfig From(IConfiguration configuration, IHostEnvironment environment)
    {
        var section = configuration.GetSection("ServiceProcesgids");
        var groupRoleMappings = ReadGroupRoleMappings(section);

        // UI-beheerde AD/Entra-instellingen (App_Data/entra-instellingen.json)
        // overschrijven appsettings; ze worden bij het opstarten ingelezen.
        string? uiAuthMode = null, uiTenantId = null, uiClientId = null;
        Dictionary<string, string[]>? uiMappings = null;
        try
        {
            var pad = Path.Combine(AppContext.BaseDirectory, "App_Data", "entra-instellingen.json");
            if (!File.Exists(pad))
            {
                pad = Path.Combine(Directory.GetCurrentDirectory(), "App_Data", "entra-instellingen.json");
            }
            if (File.Exists(pad))
            {
                using var doc = System.Text.Json.JsonDocument.Parse(File.ReadAllText(pad));
                var root = doc.RootElement;
                uiAuthMode = root.TryGetProperty("authMode", out var am) ? am.GetString() : null;
                uiTenantId = root.TryGetProperty("tenantId", out var ti) ? ti.GetString() : null;
                uiClientId = root.TryGetProperty("clientId", out var ci) ? ci.GetString() : null;
                if (root.TryGetProperty("groupRoleMappings", out var gm) && gm.ValueKind == System.Text.Json.JsonValueKind.Object)
                {
                    uiMappings = new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase);
                    foreach (var prop in gm.EnumerateObject())
                    {
                        uiMappings[prop.Name] = prop.Value.EnumerateArray().Select(v => v.GetString() ?? "").Where(v => v.Length > 0).ToArray();
                    }
                }
            }
        }
        catch
        {
            // Onleesbaar instellingenbestand: val terug op appsettings.
        }

        var result = new RuntimeConfig
        {
            AuthMode = (string.IsNullOrWhiteSpace(uiAuthMode) ? section.GetValue("AuthMode", "local") : uiAuthMode)!
                .Trim()
                .ToLowerInvariant(),
            Storage = section.GetValue("Storage", "local")!
                .Trim()
                .ToLowerInvariant(),
            Online = section.GetValue("Online", false),
            Version = section.GetValue("Version", "1.0.0-pilot")!,
            EnvironmentName = environment.EnvironmentName,
            RuntimeMode = section.GetValue("Runtime:Mode", StandardMode)!.Trim().ToLowerInvariant(),
            DataSource = section.GetValue("Runtime:DataSource", DatabaseDataSource)!.Trim().ToLowerInvariant(),
            LocalUserId = section.GetValue("LocalUser:Id", "u-local-admin")!,
            LocalUserName = section.GetValue("LocalUser:Name", "Admin")!,
            LocalUserEmail = section.GetValue<string?>("LocalUser:Email"),
            LocalUserPassword = section.GetValue("LocalUser:Password", "")!,
            LocalUserBootstrapEnabled = section.GetValue("LocalUser:BootstrapEnabled", false),
            LocalRoles = RoleNames.Normalize(section.GetSection("LocalUser:Roles").Get<string[]>() ?? RoleNames.All),
            DevelopmentSkipLogin = section.GetValue("Development:SkipLogin", false),
            LocalChatGptOAuthEnabled =
                section.GetValue<bool?>("Ai:EnableLocalChatGptOAuth") ??
                section.GetValue<bool?>("Ai:AllowLegacyChatGptOAuth") ??
                true,
            Entra = new EntraConfig
            {
                Authority = section.GetValue<string?>("Entra:Authority"),
                TenantId = string.IsNullOrWhiteSpace(uiTenantId) ? section.GetValue<string?>("Entra:TenantId") : uiTenantId,
                ClientId = string.IsNullOrWhiteSpace(uiClientId) ? section.GetValue<string?>("Entra:ClientId") : uiClientId,
                Audience = section.GetValue<string?>("Entra:Audience"),
                GroupRoleMappings = uiMappings is { Count: > 0 } ? uiMappings : groupRoleMappings
            }
        };

        result.Validate(configuration);
        return result;
    }

    public AppConfig ToAppConfig() => new(
        AuthMode,
        Storage,
        Online,
        Version,
        IsEntraMode && !string.IsNullOrWhiteSpace(Entra.TenantId) && !string.IsNullOrWhiteSpace(Entra.ClientId)
            ? new EntraPublicConfig(Entra.TenantId!, Entra.ClientId!)
            : null,
        new RuntimePublicConfig(
            EnvironmentName,
            "r0",
            "single-tenant",
            RuntimeMode,
            DataSource,
            IsDemoMode,
            ShouldSeedDemoFixtures,
            false,
            DevelopmentLoginAvailable));

    public User ToUser() => new(
        LocalUserId,
        LocalUserName,
        LocalUserEmail,
        AuthMode.Equals("entra", StringComparison.OrdinalIgnoreCase) ? "entra" : "local",
        LocalRoles,
        []);

    private void Validate(IConfiguration configuration)
    {
        var mode = RuntimeMode.Trim().ToLowerInvariant();
        var source = DataSource.Trim().ToLowerInvariant();

        if (AuthMode is not "local" and not "entra")
        {
            throw new InvalidOperationException(
                $"Onbekende authenticatiemodus '{AuthMode}'. Kies 'local' of 'entra'. Er is geen automatische fallback.");
        }

        if (Storage is not "local" and not "db")
        {
            throw new InvalidOperationException(
                $"Onbekende opslagmodus '{Storage}'. Kies 'local' of 'db'. Er is geen automatische fallback.");
        }

        if (Storage == "db" && string.IsNullOrWhiteSpace(configuration.GetConnectionString("SqlServer")))
        {
            throw new InvalidOperationException(
                "Storage=db vereist een expliciete ConnectionStrings:SqlServer. Er is geen automatische SQLite-fallback.");
        }

        if (mode is not StandardMode and not DemoMode)
        {
            throw new InvalidOperationException(
                $"Onbekende runtime-modus '{RuntimeMode}'. Kies '{StandardMode}' of '{DemoMode}'. Er is geen automatische fallback.");
        }

        if (source is not DatabaseDataSource and not DemoFixturesDataSource)
        {
            throw new InvalidOperationException(
                $"Onbekende databron '{DataSource}'. Kies '{DatabaseDataSource}' of '{DemoFixturesDataSource}'. Er is geen automatische fallback.");
        }

        if (mode == DemoMode && !IsDevelopment)
        {
            throw new InvalidOperationException(
                "Runtime:Mode=demo is uitsluitend toegestaan in de Development-omgeving.");
        }

        if ((mode == DemoMode) != (source == DemoFixturesDataSource))
        {
            throw new InvalidOperationException(
                "Runtime:Mode en Runtime:DataSource zijn inconsistent. Gebruik standard/database of, uitsluitend in Development, demo/demo-fixtures.");
        }

        if (LocalUserBootstrapEnabled && string.IsNullOrWhiteSpace(LocalUserPassword))
        {
            throw new InvalidOperationException(
                "LocalUser:BootstrapEnabled=true vereist een expliciet LocalUser:Password via een secret of omgevingsvariabele.");
        }

        if (DevelopmentSkipLogin && !DevelopmentLoginBypassCompiled)
        {
            throw new InvalidOperationException(
                "Development:SkipLogin=true is niet beschikbaar in een Release-build.");
        }

        if (DevelopmentSkipLogin && !IsDevelopment)
        {
            throw new InvalidOperationException(
                "Development:SkipLogin=true is uitsluitend toegestaan in de Development-omgeving.");
        }

        if (DevelopmentSkipLogin && !IsLocalMode)
        {
            throw new InvalidOperationException(
                "Development:SkipLogin=true vereist AuthMode=local.");
        }

        if (DevelopmentSkipLogin && Online)
        {
            throw new InvalidOperationException(
                "Development:SkipLogin=true vereist Online=false.");
        }

        if (DevelopmentSkipLogin && !Storage.Equals("local", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                "Development:SkipLogin=true vereist Storage=local; een gedeelde database wordt nooit met ontwikkelauthenticatie geopend.");
        }

    }

    private static Dictionary<string, string[]> ReadGroupRoleMappings(IConfiguration section)
    {
        var configured = section.GetSection("Entra:GroupRoleMappings").Get<Dictionary<string, string[]>>() ?? [];
        var normalized = new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase);

        foreach (var (groupId, roles) in configured)
        {
            if (string.IsNullOrWhiteSpace(groupId))
            {
                continue;
            }

            normalized[groupId.Trim()] = RoleNames.Normalize(roles);
        }

        return normalized;
    }
}

public sealed class EntraConfig
{
    public string? Authority { get; init; }
    public string? TenantId { get; init; }
    public string? ClientId { get; init; }
    public string? Audience { get; init; }
    public Dictionary<string, string[]> GroupRoleMappings { get; init; } = [];

    public string? EffectiveAuthority
    {
        get
        {
            if (!string.IsNullOrWhiteSpace(Authority))
            {
                return Authority;
            }

            return string.IsNullOrWhiteSpace(TenantId)
                ? null
                : $"https://login.microsoftonline.com/{TenantId}/v2.0";
        }
    }

    public string? EffectiveAudience => string.IsNullOrWhiteSpace(Audience) ? ClientId : Audience;
}
