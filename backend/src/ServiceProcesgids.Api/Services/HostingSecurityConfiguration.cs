using System.Net;
using System.Security.Cryptography.X509Certificates;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.HttpOverrides;

namespace ServiceProcesgids.Api.Services;

public static class HostingSecurityConfiguration
{
    public static IPAddress[] ReadKnownProxies(IConfiguration configuration)
    {
        var values = configuration.GetSection("ServiceProcesgids:ReverseProxy:KnownProxies").Get<string[]>() ?? [];
        return values.Select(value => IPAddress.TryParse(value, out var address)
            ? address
            : throw new InvalidOperationException("ReverseProxy:KnownProxies bevat een ongeldig IP-adres."))
            .Distinct().ToArray();
    }

    public static void ConfigureForwarding(ForwardedHeadersOptions options, IReadOnlyList<IPAddress> addresses)
    {
        if (addresses.Count == 0)
            throw new InvalidOperationException("Forwarding vereist minstens één expliciet vertrouwd proxy-IP.");
        options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
        options.ForwardLimit = 1;
        options.KnownIPNetworks.Clear();
        options.KnownProxies.Clear();
        foreach (var address in addresses) options.KnownProxies.Add(address);
    }

    public static IDataProtectionBuilder ProtectKeyRing(
        IDataProtectionBuilder builder, IConfiguration configuration, bool online)
    {
        var certificatePath = configuration["ServiceProcesgids:DataProtection:CertificatePath"];
        var privateKeyPath = configuration["ServiceProcesgids:DataProtection:PrivateKeyPath"];
        if (string.IsNullOrWhiteSpace(certificatePath) && string.IsNullOrWhiteSpace(privateKeyPath) && !online)
            return builder;
        if (string.IsNullOrWhiteSpace(certificatePath) || string.IsNullOrWhiteSpace(privateKeyPath))
            throw new InvalidOperationException("Online hosting vereist DataProtection:CertificatePath én DataProtection:PrivateKeyPath voor beveiligde installatiesleutels.");
        var certificate = X509Certificate2.CreateFromPemFile(certificatePath, privateKeyPath);
        if (!certificate.HasPrivateKey)
            throw new InvalidOperationException("Het Data Protection-certificaat bevat geen bruikbare privésleutel.");
        return builder.ProtectKeysWithCertificate(certificate).UnprotectKeysWithAnyCertificate(certificate);
    }
}