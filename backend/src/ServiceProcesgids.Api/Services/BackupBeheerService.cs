using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using ServiceProcesgids.Api.Contract;
using ServiceProcesgids.Api.Data;

namespace ServiceProcesgids.Api.Services;

public sealed record BackupInfo(string Naam, long Bytes, DateTimeOffset GemaaktOp);

/// <summary>UI-beheerde back-upinstellingen (App_Data/backup-instellingen.json).</summary>
public sealed record BackupInstellingen(double IntervalUren, int Retentie, string? ExtraDoelmap);

/// <summary>
/// Gedeelde back-uplogica (SQLite + JSON-export): gebruikt door de automatische
/// BackupService én door de beheer-endpoints (lijst / nu back-uppen / downloaden).
/// </summary>
public sealed class BackupBeheerService(AppDbContext db, IWebHostEnvironment environment)
{
    private string InstellingenPad => Path.Combine(environment.ContentRootPath, "App_Data", "backup-instellingen.json");

    public BackupInstellingen LeesInstellingen()
    {
        try
        {
            if (File.Exists(InstellingenPad))
            {
                var s = System.Text.Json.JsonSerializer.Deserialize<BackupInstellingen>(File.ReadAllText(InstellingenPad));
                if (s is not null) return s;
            }
        }
        catch
        {
            // onleesbaar bestand: standaardwaarden
        }
        return new BackupInstellingen(24, 14, null);
    }

    public void BewaarInstellingen(BackupInstellingen instellingen)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(InstellingenPad)!);
        File.WriteAllText(InstellingenPad, System.Text.Json.JsonSerializer.Serialize(instellingen, new System.Text.Json.JsonSerializerOptions { WriteIndented = true }));
    }

    public async Task<string> MaakBackupAsync(int retention, CancellationToken cancellationToken)
    {
        var connection = db.Database.GetDbConnection() as SqliteConnection
            ?? throw new InvalidOperationException("Back-up wordt alleen ondersteund voor SQLite (storage=local).");

        await connection.OpenAsync(cancellationToken);
        var backupDir = BackupMap(connection);
        Directory.CreateDirectory(backupDir);

        var doel = Path.Combine(backupDir, $"service-procesgids-{DateTimeOffset.UtcNow:yyyyMMdd-HHmmss}.db");

        // VACUUM INTO maakt een consistente kopie terwijl de app gewoon doordraait.
        using (var cmd = connection.CreateCommand())
        {
            cmd.CommandText = $"VACUUM INTO '{doel.Replace("'", "''")}'";
            await cmd.ExecuteNonQueryAsync(cancellationToken);
        }

        // Tweede bewijslijn: alle processen ook als leesbare JSON-export.
        var processen = await db.Processes.AsNoTracking().ToListAsync(cancellationToken);
        var jsonDoel = Path.Combine(backupDir, $"processen-{DateTimeOffset.UtcNow:yyyyMMdd-HHmmss}.json");
        var documenten = processen.Select(p => ProcessMapper.ToDocument(p)).ToList();
        await File.WriteAllTextAsync(
            jsonDoel,
            System.Text.Json.JsonSerializer.Serialize(documenten, ProcessJson.Options),
            cancellationToken);

        // Retentie: bewaar alleen de nieuwste N back-ups (db én json).
        foreach (var patroon in new[] { "service-procesgids-*.db", "processen-*.json" })
        {
            foreach (var f in Directory.GetFiles(backupDir, patroon)
                         .OrderByDescending(f => f, StringComparer.Ordinal)
                         .Skip(retention))
            {
                File.Delete(f);
            }
        }

        // Extra doelmap (UNC-netwerkpad of lokale OneDrive-map): kopie van beide
        // bestanden; een haperende share mag de back-up zelf nooit laten falen.
        var instellingen = LeesInstellingen();
        if (!string.IsNullOrWhiteSpace(instellingen.ExtraDoelmap))
        {
            try
            {
                Directory.CreateDirectory(instellingen.ExtraDoelmap);
                File.Copy(doel, Path.Combine(instellingen.ExtraDoelmap, Path.GetFileName(doel)), overwrite: true);
                File.Copy(jsonDoel, Path.Combine(instellingen.ExtraDoelmap, Path.GetFileName(jsonDoel)), overwrite: true);
            }
            catch (Exception ex)
            {
                throw new BackupKopieWaarschuwing(doel, $"Back-up gemaakt, maar kopiëren naar '{instellingen.ExtraDoelmap}' mislukte: {ex.Message}");
            }
        }

        return doel;
    }

    /// <summary>Back-up zelf is gelukt; alleen de kopie naar de extra doelmap faalde.</summary>
    public sealed class BackupKopieWaarschuwing(string pad, string bericht) : Exception(bericht)
    {
        public string Pad { get; } = pad;
    }

    public async Task<IReadOnlyList<BackupInfo>> LijstAsync(CancellationToken cancellationToken)
    {
        var connection = db.Database.GetDbConnection() as SqliteConnection;
        if (connection is null)
        {
            return [];
        }

        await connection.OpenAsync(cancellationToken);
        var backupDir = BackupMap(connection);
        if (!Directory.Exists(backupDir))
        {
            return [];
        }

        return Directory.GetFiles(backupDir)
            .Select(f => new FileInfo(f))
            .OrderByDescending(f => f.Name, StringComparer.Ordinal)
            .Select(f => new BackupInfo(f.Name, f.Length, f.LastWriteTimeUtc))
            .ToList();
    }

    /// <summary>Veilig pad naar één back-upbestand (geen path traversal).</summary>
    public async Task<string?> BestandAsync(string naam, CancellationToken cancellationToken)
    {
        if (naam.Contains("..") || naam.Contains('/') || naam.Contains('\\'))
        {
            return null;
        }

        var connection = db.Database.GetDbConnection() as SqliteConnection;
        if (connection is null)
        {
            return null;
        }

        await connection.OpenAsync(cancellationToken);
        var pad = Path.Combine(BackupMap(connection), naam);
        return File.Exists(pad) ? pad : null;
    }

    private static string BackupMap(SqliteConnection connection) =>
        Path.Combine(Path.GetDirectoryName(Path.GetFullPath(connection.DataSource))!, "backups");
}
