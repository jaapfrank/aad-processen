using System.Text.Json;

namespace ServiceProcesgids.Api.Services;

public sealed record AiInstellingen(
    string Provider,
    string? Endpoint,
    string Model,
    string Mode,
    int SchemaVersion = 2,
    string? TenantCredentialProvider = null);

public sealed record AiCredentialResolution(
    string? Secret,
    string Source,
    AiCredentialMetadata Metadata);

public sealed record ManagedAiCapability(
    bool Available,
    string ReasonCode,
    string NextStep,
    AiInstellingen? Profile);

public sealed record AiRuntimeSnapshot(
    AiInstellingen Configured,
    ManagedAiCapability? ManagedCapability,
    AiCredentialResolution Credential);

/// <summary>
/// Niet-gevoelige AI-providerinstellingen. Secrets worden uitsluitend via
/// IAiCredentialStore of expliciete serverconfiguratie gelezen.
/// </summary>
public sealed class AiSettingsService(
    IWebHostEnvironment environment,
    IConfiguration configuration,
    IAiCredentialStore credentialStore)
{
    public const string DisabledMode = "disabled";
    public const string ManagedMode = "managed";
    public const string BringYourOwnMode = "byo";

    private sealed record LegacyAiInstellingen(
        string? Provider,
        string? Endpoint,
        string? ApiKey,
        string? Model,
        string? Mode,
        int? SchemaVersion,
        string? TenantCredentialProvider);

    private readonly string _path =
        Path.Combine(environment.ContentRootPath, "App_Data", "ai-instellingen.json");
    private readonly object _gate = new();

    public AiInstellingen LeesOfStandaard()
    {
        var saved = Lees();
        if (saved is not null)
        {
            return saved;
        }

        var section = configuration.GetSection("ServiceProcesgids:Ai");
        return new AiInstellingen(
            section.GetValue("Provider", "disabled")!,
            section.GetValue<string?>("Endpoint"),
            section.GetValue("Model", "")!,
            section.GetValue("Mode", DisabledMode)!,
            2);
    }

    public AiInstellingen? Lees()
    {
        lock (_gate)
        {
            if (!File.Exists(_path))
            {
                return null;
            }

            try
            {
                var legacy = JsonSerializer.Deserialize<LegacyAiInstellingen>(
                    File.ReadAllText(_path),
                    JsonOptions) ?? throw new JsonException("Leeg instellingenbestand.");

                var normalizedProvider =
                    string.IsNullOrWhiteSpace(legacy.Provider)
                        ? "disabled"
                        : legacy.Provider.Trim().ToLowerInvariant();
                var hasLegacySecret = !string.IsNullOrWhiteSpace(legacy.ApiKey);
                var mode = string.IsNullOrWhiteSpace(legacy.Mode)
                    ? normalizedProvider == "chatgpt"
                        ? BringYourOwnMode
                        : hasLegacySecret
                            ? BringYourOwnMode
                            : DisabledMode
                    : legacy.Mode.Trim().ToLowerInvariant();
                var credentialMetadata = credentialStore.GetMetadata();
                var inferredCredentialProvider =
                    string.IsNullOrWhiteSpace(legacy.TenantCredentialProvider) &&
                    (credentialMetadata.Present || hasLegacySecret) &&
                    ((legacy.SchemaVersion ?? 1) < 2 || mode == BringYourOwnMode)
                        ? normalizedProvider
                        : legacy.TenantCredentialProvider;
                var sanitized = new AiInstellingen(
                    normalizedProvider,
                    string.IsNullOrWhiteSpace(legacy.Endpoint) ? null : legacy.Endpoint.Trim(),
                    legacy.Model?.Trim() ?? "",
                    mode,
                    2,
                    string.IsNullOrWhiteSpace(inferredCredentialProvider)
                        ? null
                        : inferredCredentialProvider.Trim().ToLowerInvariant());

                // Schema v1 noemde de tenantmodus ten onrechte "managed".
                // Migreer die modus altijd naar BYO. Met een beschermd secret
                // blijft hij bruikbaar; zonder secret blijft hij herkenbaar
                // missing-credential en kan een nieuw centraal platformprofiel
                // hem nooit stil activeren.
                var migratedMode =
                    (legacy.SchemaVersion ?? 1) < 2 &&
                    mode == ManagedMode
                        ? BringYourOwnMode
                        : mode;
                sanitized = sanitized with { Mode = migratedMode };

                if (hasLegacySecret)
                {
                    // Eenmalige, fail-closed migratie van de vroegere plaintext
                    // ApiKey. Wis eerst atomair de plaintext; als de daarop
                    // volgende protect-stap faalt, blijft AI veilig uit en moet
                    // de beheerder de credential opnieuw roteren.
                    WriteUnsafe(sanitized);
                    credentialStore.Rotate(legacy.ApiKey!);
                }
                else if (
                    migratedMode != mode ||
                    (legacy.SchemaVersion ?? 1) < 2 ||
                    !string.Equals(
                        legacy.TenantCredentialProvider,
                        sanitized.TenantCredentialProvider,
                        StringComparison.OrdinalIgnoreCase))
                {
                    WriteUnsafe(sanitized);
                }

                return sanitized;
            }
            catch (AiConfigurationException)
            {
                throw;
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException)
            {
                throw new AiConfigurationException(
                    "ai-settings-unreadable",
                    "De AI-instellingen zijn onleesbaar. Laat een beheerder de configuratie herstellen.",
                    ex);
            }
        }
    }

    public void Bewaar(AiInstellingen instellingen)
    {
        lock (_gate)
        {
            var current = LeesUnsafeOfStandaard();
            var normalized = Normalize(instellingen with
            {
                TenantCredentialProvider =
                    instellingen.TenantCredentialProvider ??
                    current.TenantCredentialProvider
            });
            Validate(normalized);
            WriteUnsafe(normalized);
        }
    }

    public AiCredentialMetadata RotateCredential(string secret)
    {
        lock (_gate)
        {
            var current = Normalize(LeesUnsafeOfStandaard());
            return SaveWithCredential(current, secret);
        }
    }

    public void RevokeCredential()
    {
        lock (_gate)
        {
            var current = LeesUnsafeOfStandaard();
            var metadata = credentialStore.GetMetadata();
            if (!metadata.Present)
            {
                throw new AiConfigurationException(
                    "ai-tenant-credential-not-present",
                    "Er is geen organisatiecredential om in te trekken. Een centraal Managed AI-platformcredential kan niet vanuit de tenant worden ingetrokken.");
            }

            credentialStore.Revoke();
            WriteUnsafe(current with
            {
                Mode = current.Mode == BringYourOwnMode
                    ? DisabledMode
                    : current.Mode,
                TenantCredentialProvider = null
            });
        }
    }

    public AiCredentialResolution ResolveCredential(AiInstellingen instellingen)
    {
        lock (_gate)
        {
            return ResolveCredentialUnsafe(instellingen);
        }
    }

    public AiCredentialMetadata GetTenantCredentialMetadata()
    {
        lock (_gate)
        {
            return credentialStore.GetMetadata();
        }
    }

    public string? GetTenantCredentialProvider()
    {
        lock (_gate)
        {
            return credentialStore.GetMetadata().Present
                ? LeesUnsafeOfStandaard().TenantCredentialProvider
                : null;
        }
    }

    public AiRuntimeSnapshot GetRuntimeSnapshot()
    {
        lock (_gate)
        {
            var configured = Normalize(LeesUnsafeOfStandaard());
            ManagedAiCapability? managed = null;
            if (configured.Mode == ManagedMode)
            {
                managed = GetManagedAiCapability();
                if (managed.Available && managed.Profile is not null)
                {
                    configured = managed.Profile;
                }
                else
                {
                    return new AiRuntimeSnapshot(
                        configured,
                        managed,
                        EmptyCredential());
                }
            }

            return new AiRuntimeSnapshot(
                configured,
                managed,
                ResolveCredentialUnsafe(configured));
        }
    }

    public AiCredentialMetadata SaveWithCredential(
        AiInstellingen instellingen,
        string secret)
    {
        lock (_gate)
        {
            var normalized = Normalize(instellingen with
            {
                Mode = BringYourOwnMode,
                SchemaVersion = 2,
                TenantCredentialProvider = instellingen.Provider
            });
            EnsureApiCredentialProvider(normalized.Provider);
            Validate(normalized);
            var previousMetadata = credentialStore.GetMetadata();
            var previousSecret = previousMetadata.Present
                ? credentialStore.Read()
                : null;
            try
            {
                var metadata = credentialStore.Rotate(secret);
                WriteUnsafe(normalized);
                return metadata;
            }
            catch
            {
                if (previousSecret is not null)
                {
                    credentialStore.Rotate(previousSecret);
                }
                else
                {
                    credentialStore.Revoke();
                }

                throw;
            }
        }
    }

    private AiCredentialResolution ResolveCredentialUnsafe(AiInstellingen instellingen)
    {
        var mode = instellingen.Mode.Trim().ToLowerInvariant();
        if (mode == BringYourOwnMode)
        {
            var metadata = credentialStore.GetMetadata();
            var bindingMatches =
                metadata.Present &&
                !string.IsNullOrWhiteSpace(instellingen.TenantCredentialProvider) &&
                instellingen.TenantCredentialProvider.Equals(
                    instellingen.Provider,
                    StringComparison.OrdinalIgnoreCase);
            return new AiCredentialResolution(
                bindingMatches ? credentialStore.Read() : null,
                bindingMatches ? "tenant-protected" : "none",
                metadata);
        }

        if (mode == ManagedMode)
        {
            var secret = configuration["ServiceProcesgids:Ai:Managed:ApiKey"];
            var present = !string.IsNullOrWhiteSpace(secret);
            return new AiCredentialResolution(
                present ? secret!.Trim() : null,
                present ? "server-configuration" : "none",
                new AiCredentialMetadata(
                    present,
                    present ? DataProtectionAiCredentialStore.Fingerprint(secret!) : null,
                    null));
        }

        return EmptyCredential();
    }

    public ManagedAiCapability GetManagedAiCapability()
    {
        var section = configuration.GetSection("ServiceProcesgids:Ai:Managed");
        const string contactPlatform =
            "Laat platformbeheer eerst een centraal providerprofiel en platformcredential configureren. " +
            "Gebruik tot die tijd een van de andere beschikbare productmodi.";
        if (!section.GetValue("Enabled", false))
        {
            return new ManagedAiCapability(
                false,
                "managed-ai-not-enabled",
                contactPlatform,
                null);
        }

        var profile = Normalize(new AiInstellingen(
            section.GetValue("Provider", "")!,
            section.GetValue<string?>("Endpoint"),
            section.GetValue("Model", "")!,
            ManagedMode,
            2));
        if (string.IsNullOrWhiteSpace(section.GetValue<string?>("ApiKey")))
        {
            return new ManagedAiCapability(
                false,
                "managed-ai-platform-credential-missing",
                contactPlatform,
                null);
        }

        try
        {
            Validate(profile);
            if (profile.Provider is not "azure-openai" and not "openai" and not "anthropic")
            {
                throw new AiConfigurationException(
                    "managed-ai-provider-unsupported",
                    "Managed AI ondersteunt uitsluitend een server-side API-provider.");
            }
        }
        catch (AiConfigurationException)
        {
            return new ManagedAiCapability(
                false,
                "managed-ai-profile-invalid",
                "Laat platformbeheer provider, model/deployment en eventueel het officiële Azure-endpoint herstellen.",
                null);
        }

        return new ManagedAiCapability(
            true,
            "managed-ai-available",
            "Het centrale providerprofiel is beschikbaar. Sla Managed AI op en voer daarna de verbindingstest uit.",
            profile);
    }

    public static string ResolveRequestedMode(
        string? requestedMode,
        bool hasInlineCredential,
        string currentMode) =>
        hasInlineCredential
            ? BringYourOwnMode
            : string.IsNullOrWhiteSpace(requestedMode)
                ? currentMode
                : requestedMode;

    public static AiInstellingen Normalize(AiInstellingen settings) => new(
        string.IsNullOrWhiteSpace(settings.Provider)
            ? "disabled"
            : settings.Provider.Trim().ToLowerInvariant(),
        string.IsNullOrWhiteSpace(settings.Endpoint) ? null : settings.Endpoint.Trim(),
        settings.Model?.Trim() ?? "",
        string.IsNullOrWhiteSpace(settings.Mode)
            ? DisabledMode
            : settings.Mode.Trim().ToLowerInvariant(),
        2,
        string.IsNullOrWhiteSpace(settings.TenantCredentialProvider)
            ? null
            : settings.TenantCredentialProvider.Trim().ToLowerInvariant());

    public static void Validate(AiInstellingen settings)
    {
        var normalized = Normalize(settings);
        var supportedProvider = normalized.Provider is
            "disabled" or "azure-openai" or "openai" or "anthropic" or "chatgpt";
        if (!supportedProvider)
        {
            throw new AiConfigurationException(
                "ai-provider-unsupported",
                "Kies disabled, azure-openai, openai, anthropic of de lokale ChatGPT OAuth-provider.");
        }

        if (normalized.Mode is not DisabledMode and not ManagedMode and not BringYourOwnMode)
        {
            throw new AiConfigurationException(
                "ai-mode-unsupported",
                "Kies AI-modus disabled, managed of byo.");
        }

        if (normalized.Provider == "disabled" && normalized.Mode != DisabledMode)
        {
            throw new AiConfigurationException(
                "ai-provider-disabled",
                "Provider disabled kan uitsluitend met mode disabled worden opgeslagen.");
        }

        if (normalized.Mode != DisabledMode && string.IsNullOrWhiteSpace(normalized.Model))
        {
            throw new AiConfigurationException(
                "ai-model-missing",
                "Een expliciet model of Azure-deployment is verplicht wanneer AI actief kan zijn.");
        }

        if (normalized.Provider == "azure-openai" &&
            normalized.Mode != DisabledMode &&
            !IsAllowedAzureEndpoint(normalized.Endpoint))
        {
            throw new AiConfigurationException(
                "ai-endpoint-invalid",
                "Gebruik een HTTPS-basisendpoint op *.openai.azure.com of *.services.ai.azure.com.");
        }

        if (normalized.Provider is "openai" or "anthropic" or "chatgpt" &&
            !string.IsNullOrWhiteSpace(normalized.Endpoint))
        {
            throw new AiConfigurationException(
                "ai-endpoint-not-supported",
                "Een aangepast endpoint is voor deze provider niet toegestaan.");
        }
    }

    public static bool IsAllowedAzureEndpoint(string? endpoint)
    {
        if (!Uri.TryCreate(endpoint, UriKind.Absolute, out var uri) ||
            uri.Scheme != Uri.UriSchemeHttps ||
            !uri.IsDefaultPort ||
            !string.IsNullOrEmpty(uri.UserInfo) ||
            (uri.AbsolutePath != "/" && !string.IsNullOrEmpty(uri.AbsolutePath.Trim('/'))) ||
            !string.IsNullOrEmpty(uri.Query) ||
            !string.IsNullOrEmpty(uri.Fragment))
        {
            return false;
        }

        return uri.Host.EndsWith(".openai.azure.com", StringComparison.OrdinalIgnoreCase) ||
               uri.Host.EndsWith(".services.ai.azure.com", StringComparison.OrdinalIgnoreCase);
    }

    private AiInstellingen LeesUnsafeOfStandaard()
    {
        // Monitor is re-entrant; deze helper houdt rotate/revoke als één
        // consistente metadata-operatie.
        return Lees() ?? new AiInstellingen(
            configuration["ServiceProcesgids:Ai:Provider"] ?? "disabled",
            configuration["ServiceProcesgids:Ai:Endpoint"],
            configuration["ServiceProcesgids:Ai:Model"] ?? "",
            configuration["ServiceProcesgids:Ai:Mode"] ?? DisabledMode,
            2);
    }

    private static AiCredentialResolution EmptyCredential() => new(
        null,
        "none",
        new AiCredentialMetadata(false, null, null));

    private static void EnsureApiCredentialProvider(string provider)
    {
        if (provider is not "azure-openai" and not "openai" and not "anthropic")
        {
            throw new AiConfigurationException(
                "ai-credential-provider-invalid",
                "Een organisatiecredential kan uitsluitend aan Azure OpenAI, OpenAI of Anthropic worden gebonden.");
        }
    }

    private void WriteUnsafe(AiInstellingen settings)
    {
        DataProtectionAiCredentialStore.AtomicWrite(
            _path,
            JsonSerializer.Serialize(Normalize(settings), JsonOptions));
    }

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = true
    };
}
