namespace ServiceProcesgids.Api.Models;

public sealed record User(
    string Id,
    string Naam,
    string? Email,
    string Bron,
    string[] Rollen,
    string[] Groepen);
