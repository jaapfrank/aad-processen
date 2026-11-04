using System.Security.Claims;
using ServiceProcesgids.Api.Models;

namespace ServiceProcesgids.Api.Services;

public sealed class CurrentUserService(RuntimeConfig runtimeConfig)
{
    public User FromPrincipal(ClaimsPrincipal principal)
    {
        var source = principal.FindFirst("bron")?.Value ??
            (runtimeConfig.IsEntraMode ? "entra" : "local");

        var id = FirstClaimValue(principal, ClaimTypes.NameIdentifier, "oid", "sub") ?? "unknown";
        var name = FirstClaimValue(principal, ClaimTypes.Name, "name", "preferred_username", "upn") ?? id;
        var email = FirstClaimValue(principal, ClaimTypes.Email, "email", "preferred_username", "upn");
        var roles = RoleNames.Normalize(principal.FindAll(ClaimTypes.Role).Concat(principal.FindAll("roles")).Select(claim => claim.Value));
        var groups = principal.FindAll("groups")
            .Concat(principal.FindAll("group"))
            .Concat(principal.FindAll(ClaimTypes.GroupSid))
            .Select(claim => claim.Value)
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        return new User(id, name, email, source, roles, groups);
    }

    private static string? FirstClaimValue(ClaimsPrincipal principal, params string[] claimTypes)
    {
        foreach (var claimType in claimTypes)
        {
            var value = principal.FindFirst(claimType)?.Value;
            if (!string.IsNullOrWhiteSpace(value))
            {
                return value;
            }
        }

        return null;
    }
}
