namespace ServiceProcesgids.Api.Models;

public sealed record LocalUserCreateRequest(
    string Gebruikersnaam,
    string Naam,
    string? Email,
    string Wachtwoord,
    string[] Rollen,
    bool? Actief);

public sealed record LocalUserUpdateRequest(
    string Naam,
    string? Email,
    string[] Rollen,
    bool Actief);

public sealed record LocalPasswordChangeRequest(string Wachtwoord);

public sealed record LocalUserResponse(
    string Id,
    string Gebruikersnaam,
    string Naam,
    string? Email,
    string[] Rollen,
    bool Actief,
    string AangemaaktOp,
    string? GewijzigdOp);
