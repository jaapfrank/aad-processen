namespace ServiceProcesgids.Api.Models;

public static class RoleNames
{
    public const string View = "kijken";
    public const string Suggest = "suggesties";
    public const string Edit = "bewerken";
    public const string Approve = "goedkeuren";
    public const string Manage = "beheren";

    public static readonly string[] All = [View, Suggest, Edit, Approve, Manage];

    public static readonly string[] CanView = [View, Suggest, Edit, Approve, Manage];
    public static readonly string[] CanSuggest = [Suggest, Edit, Approve, Manage];
    public static readonly string[] CanEdit = [Edit, Manage];
    public static readonly string[] CanApprove = [Approve, Manage];
    public static readonly string[] CanReview = [Edit, Approve, Manage];
    public static readonly string[] CanManage = [Manage];

    public static string[] Normalize(IEnumerable<string>? roles)
    {
        if (roles is null)
        {
            return [];
        }

        var knownRoles = All.ToHashSet(StringComparer.OrdinalIgnoreCase);

        return roles
            .Where(role => !string.IsNullOrWhiteSpace(role))
            .Select(role => role.Trim().ToLowerInvariant())
            .Where(knownRoles.Contains)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(role => Array.IndexOf(All, role))
            .ToArray();
    }
}
