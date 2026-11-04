namespace ServiceProcesgids.Api.Models;

/// <summary>Publieke Entra-gegevens voor de frontend-MSAL-login (contract v1.3).</summary>
public sealed record EntraPublicConfig(string TenantId, string ClientId);

/// <summary>
/// Eerlijke, niet-gevoelige runtime-identiteit. De frontend hoeft hierdoor
/// nooit af te leiden of gegevens echt of synthetisch zijn.
/// </summary>
public sealed record RuntimePublicConfig(
    string Environment,
    string Profile,
    string TenantType,
    string Mode,
    string DataSource,
    bool IsDemo,
    bool SyntheticData,
    bool FallbackUsed,
    bool DevelopmentLoginAvailable);

public sealed record AppConfig(
    string AuthMode,
    string Storage,
    bool Online,
    string Versie,
    EntraPublicConfig? Entra = null,
    RuntimePublicConfig? Runtime = null);
