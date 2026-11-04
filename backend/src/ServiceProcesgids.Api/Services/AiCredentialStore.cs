using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;

namespace ServiceProcesgids.Api.Services;

public sealed record AiCredentialMetadata(
    bool Present,
    string? Fingerprint,
    DateTimeOffset? UpdatedAt);

public interface IAiCredentialStore
{
    AiCredentialMetadata GetMetadata();
    string? Read();
    AiCredentialMetadata Rotate(string secret);
    void Revoke();
}

/// <summary>
/// R0 single-tenant secretopslag. De providercredential staat versleuteld met
/// ASP.NET Core Data Protection op disk. De interface kan later zonder
/// API-contractwijziging door een tenant-vault worden vervangen.
/// </summary>
public sealed class DataProtectionAiCredentialStore(
    IDataProtectionProvider dataProtection,
    IWebHostEnvironment environment) : IAiCredentialStore
{
    private sealed record Envelope(
        int Version,
        string ProtectedPayload,
        string Fingerprint,
        DateTimeOffset UpdatedAt);

    private readonly IDataProtector _protector =
        dataProtection.CreateProtector("ServiceProcesgids.AiProviderCredential.v1");
    private readonly string _path =
        Path.Combine(environment.ContentRootPath, "App_Data", "ai-provider-credential.json");
    private readonly object _gate = new();

    public AiCredentialMetadata GetMetadata()
    {
        lock (_gate)
        {
            var envelope = ReadEnvelope();
            return envelope is null
                ? new AiCredentialMetadata(false, null, null)
                : new AiCredentialMetadata(true, envelope.Fingerprint, envelope.UpdatedAt);
        }
    }

    public string? Read()
    {
        lock (_gate)
        {
            var envelope = ReadEnvelope();
            if (envelope is null)
            {
                return null;
            }

            try
            {
                return _protector.Unprotect(envelope.ProtectedPayload);
            }
            catch (CryptographicException ex)
            {
                throw new AiConfigurationException(
                    "ai-credential-unreadable",
                    "De beheerde AI-credential kan niet worden ontsleuteld. Roteer de credential.",
                    ex);
            }
        }
    }

    public AiCredentialMetadata Rotate(string secret)
    {
        if (string.IsNullOrWhiteSpace(secret))
        {
            throw new AiConfigurationException(
                "ai-credential-empty",
                "Een niet-lege providercredential is verplicht.");
        }

        lock (_gate)
        {
            var normalized = secret.Trim();
            var envelope = new Envelope(
                1,
                _protector.Protect(normalized),
                Fingerprint(normalized),
                DateTimeOffset.UtcNow);
            AtomicWrite(_path, JsonSerializer.Serialize(envelope, JsonOptions));
            return new AiCredentialMetadata(true, envelope.Fingerprint, envelope.UpdatedAt);
        }
    }

    public void Revoke()
    {
        lock (_gate)
        {
            if (File.Exists(_path))
            {
                File.Delete(_path);
            }
        }
    }

    public static string Fingerprint(string secret)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(secret));
        return $"sha256:{Convert.ToHexString(hash)[..12].ToLowerInvariant()}";
    }

    private Envelope? ReadEnvelope()
    {
        if (!File.Exists(_path))
        {
            return null;
        }

        try
        {
            var envelope = JsonSerializer.Deserialize<Envelope>(
                File.ReadAllText(_path),
                JsonOptions);
            if (envelope is null ||
                envelope.Version != 1 ||
                string.IsNullOrWhiteSpace(envelope.ProtectedPayload))
            {
                throw new JsonException("Ongeldige credential-envelope.");
            }

            return envelope;
        }
        catch (AiConfigurationException)
        {
            throw;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException)
        {
            throw new AiConfigurationException(
                "ai-credential-unreadable",
                "De beheerde AI-credential is onleesbaar. Roteer de credential.",
                ex);
        }
    }

    internal static void AtomicWrite(string path, string content)
    {
        var directory = Path.GetDirectoryName(path)!;
        EnsurePrivateDirectory(directory);
        var temporaryPath = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        File.WriteAllText(temporaryPath, content, Encoding.UTF8);
        if (!OperatingSystem.IsWindows())
        {
            File.SetUnixFileMode(
                temporaryPath,
                UnixFileMode.UserRead | UnixFileMode.UserWrite);
        }
        File.Move(temporaryPath, path, true);
    }

    internal static void EnsurePrivateDirectory(string path)
    {
        Directory.CreateDirectory(path);
        if (!OperatingSystem.IsWindows())
        {
            File.SetUnixFileMode(
                path,
                UnixFileMode.UserRead |
                UnixFileMode.UserWrite |
                UnixFileMode.UserExecute);
        }
    }

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = true
    };
}
