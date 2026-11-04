using System.Net;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.Extensions.Primitives;
using ServiceProcesgids.Api.Models;

namespace ServiceProcesgids.Api.Services;

/// <summary>
/// Bouwstenen voor de expliciete lokale ontwikkelsessie. Dit is geen
/// authenticatieschema: Program.cs moet de sessie alleen uitgeven wanneer
/// RuntimeConfig.DevelopmentLoginAvailable waar is én IsSafeLocalRequest slaagt.
/// </summary>
public static class DevelopmentLoginSession
{
    public const string HeaderName = "X-SPG-Development-Session";
    public const string HeaderValue = "1";
    public const string UserId = "dev-local-admin";
    public const string DisplayName = "Development beheerder";
    public const string Source = "development-bypass";

    public static ClaimsPrincipal CreatePrincipal()
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, UserId),
            new(ClaimTypes.Name, DisplayName),
            new("bron", Source)
        };
        claims.AddRange(RoleNames.All.Select(role => new Claim(ClaimTypes.Role, role)));

        return new ClaimsPrincipal(new ClaimsIdentity(
            claims,
            CookieAuthenticationDefaults.AuthenticationScheme,
            ClaimTypes.Name,
            ClaimTypes.Role));
    }

    public static AuthenticationProperties CreateAuthenticationProperties(DateTimeOffset now) => new()
    {
        AllowRefresh = false,
        ExpiresUtc = now.AddHours(1),
        IsPersistent = false,
        IssuedUtc = now
    };

    /// <summary>
    /// Extra requestgrens voor de endpointintegratie: uitsluitend directe
    /// loopbackrequests, nooit via forwarded proxyheaders, met een custom header
    /// die eenvoudige cross-site formulierrequests blokkeert. De header is geen
    /// geheim en vervangt de RuntimeConfig-gates niet.
    /// </summary>
    public static bool IsSafeLocalRequest(HttpContext context)
    {
        var remoteAddress = context.Connection.RemoteIpAddress;
        if (remoteAddress is null || !IPAddress.IsLoopback(remoteAddress))
        {
            return false;
        }

        if (HasForwardedHeaders(context.Request.Headers))
        {
            return false;
        }

        var developmentHeader = context.Request.Headers[HeaderName];
        if (developmentHeader.Count != 1 ||
            !string.Equals(developmentHeader[0], HeaderValue, StringComparison.Ordinal))
        {
            return false;
        }

        var origin = context.Request.Headers.Origin;
        if (StringValues.IsNullOrEmpty(origin))
        {
            return true;
        }

        return origin.Count == 1 &&
            Uri.TryCreate(origin[0], UriKind.Absolute, out var originUri) &&
            originUri.IsLoopback &&
            (originUri.Scheme == Uri.UriSchemeHttp || originUri.Scheme == Uri.UriSchemeHttps);
    }

    private static bool HasForwardedHeaders(IHeaderDictionary headers) =>
        headers.ContainsKey("Forwarded") ||
        headers.ContainsKey("X-Forwarded-For") ||
        headers.ContainsKey("X-Forwarded-Host") ||
        headers.ContainsKey("X-Forwarded-Proto");
}
