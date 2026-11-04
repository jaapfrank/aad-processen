namespace ServiceProcesgids.Api.Services;

/// <summary>Checks browser origin for unsafe requests authenticated with ambient cookies.</summary>
public static class CookieRequestOrigin
{
    public static bool IsAllowed(HttpRequest request)
    {
        var fetchSite = request.Headers["Sec-Fetch-Site"];
        if (fetchSite.Count > 1) return false;
        if (fetchSite.Count == 1 && fetchSite[0] is not "same-origin" and not "none") return false;

        var origins = request.Headers.Origin;
        // Non-browser API clients do not send Origin or Fetch Metadata. They
        // must already possess the cookie. Browser cross-site and opaque-origin
        // requests are rejected, including siblings beneath the same site.
        if (origins.Count == 0) return true;
        if (origins.Count != 1 ||
            !Uri.TryCreate(origins[0], UriKind.Absolute, out var origin) ||
            !Uri.TryCreate($"{request.Scheme}://{request.Host}", UriKind.Absolute, out var target))
            return false;
        return origin.Scheme is "http" or "https" &&
            string.IsNullOrEmpty(origin.UserInfo) && origin.AbsolutePath == "/" &&
            string.IsNullOrEmpty(origin.Query) && string.IsNullOrEmpty(origin.Fragment) &&
            string.Equals(origin.Scheme, target.Scheme, StringComparison.OrdinalIgnoreCase) &&
            string.Equals(origin.IdnHost, target.IdnHost, StringComparison.OrdinalIgnoreCase) &&
            origin.Port == target.Port;
    }

    public static bool IsUnsafe(HttpRequest request) =>
        !HttpMethods.IsGet(request.Method) && !HttpMethods.IsHead(request.Method) && !HttpMethods.IsOptions(request.Method);
}