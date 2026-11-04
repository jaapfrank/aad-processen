using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;

namespace ServiceProcesgids.Api.Services;

/// <summary>Installation-bound encrypted settings, including one-time legacy migration.</summary>
public sealed class ProtectedSettingsStore(IDataProtectionProvider provider)
{
    private const string Format = "spg-protected-settings-v1";
    private sealed record Envelope(string Format, string ProtectedPayload);
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public T? Read<T>(string path, string purpose) where T : class
    {
        if (!File.Exists(path)) return null;
        try
        {
            var content = File.ReadAllText(path);
            using var document = JsonDocument.Parse(content);
            if (document.RootElement.TryGetProperty("format", out var format))
            {
                if (format.GetString() != Format) throw new JsonException("Unsupported settings envelope.");
                var envelope = JsonSerializer.Deserialize<Envelope>(content, JsonOptions)
                    ?? throw new JsonException("Missing settings envelope.");
                return JsonSerializer.Deserialize<T>(provider.CreateProtector(purpose).Unprotect(envelope.ProtectedPayload))
                    ?? throw new JsonException("Empty protected settings.");
            }

            var legacy = JsonSerializer.Deserialize<T>(content)
                ?? throw new JsonException("Empty legacy settings.");
            Write(path, purpose, legacy);
            return legacy;
        }
        catch (Exception ex) when (ex is JsonException or CryptographicException or IOException or UnauthorizedAccessException)
        {
            throw new InvalidOperationException(
                $"De opgeslagen instellingen in '{Path.GetFileName(path)}' kunnen niet veilig worden gelezen. Herstel de installatie-instellingen en bijbehorende sleutels.", ex);
        }
    }

    public void Write<T>(string path, string purpose, T value)
    {
        var envelope = new Envelope(Format, provider.CreateProtector(purpose).Protect(JsonSerializer.Serialize(value)));
        DataProtectionAiCredentialStore.AtomicWrite(path, JsonSerializer.Serialize(envelope, JsonOptions));
    }
}