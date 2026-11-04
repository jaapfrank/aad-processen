namespace ServiceProcesgids.Api.Models;

public sealed record WorkflowCommentRequest(int? ExpectedRevision, string? Opmerking);

public sealed record RejectRequest(int? ExpectedRevision, string? Reden);

public sealed record SuggestionCreateRequest(string Type, string Tekst);

public sealed record SuggestionResolveRequest(string Status);

public sealed record AiGespreksbericht(string Rol, string Tekst);
public sealed record AiVraagRequest(string Vraag, IReadOnlyList<AiGespreksbericht>? Geschiedenis = null);

public sealed record AiInstellingenRequest(
    string? Provider,
    string? Endpoint,
    string? ApiKey,
    string? Model,
    string? Mode);

public sealed record AiCredentialRotateRequest(string? Secret);

public sealed record EntraInstellingenRequest(
    string? AuthMode,
    string? TenantId,
    string? ClientId,
    Dictionary<string, string[]>? GroupRoleMappings);

public sealed record BcInstellingenRequest(
    string? TenantId,
    string? Environment,
    string? CompanyId,
    string? ClientId,
    string? ClientSecret,
    string? ExtraEntiteit);

public sealed record MailInstellingenRequest(
    string? SmtpHost,
    int? SmtpPoort,
    bool? Ssl,
    string? Gebruiker,
    string? Wachtwoord,
    string? Afzender,
    string? Ontvangers);
