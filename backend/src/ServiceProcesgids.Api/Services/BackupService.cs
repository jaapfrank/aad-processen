using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using ServiceProcesgids.Api.Contract;
using ServiceProcesgids.Api.Data;
using ServiceProcesgids.Api.Models;

namespace ServiceProcesgids.Api.Services;

/// <summary>
/// Automatische back-ups van de lokale SQLite-database (zelfstandige modus).
/// Draait bij opstarten en daarna elke <c>IntervalHours</c>; bewaart de laatste
/// <c>Retention</c> bestanden in <c>App_Data/backups</c>. In db-modus (SQL Server)
/// geldt het reguliere back-upbeleid van de organisatie en doet deze service niets.
/// Dit ondersteunt ISO 27001 control A.8.13 (Information backup).
/// </summary>
public sealed class BackupService(
    IServiceScopeFactory scopeFactory,
    RuntimeConfig runtimeConfig,
    IConfiguration configuration,
    ILogger<BackupService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var enabled = configuration.GetValue("ServiceProcesgids:Backup:Enabled", true);
        var isLocalStorage = runtimeConfig.Storage.Equals("local", StringComparison.OrdinalIgnoreCase);
        if (!enabled || !isLocalStorage)
        {
            logger.LogInformation("Back-upservice inactief (enabled={Enabled}, storage={Storage}).", enabled, runtimeConfig.Storage);
            return;
        }

        // Korte vertraging zodat migraties/seed eerst afronden.
        await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken);

        while (!stoppingToken.IsCancellationRequested)
        {
            // Interval/retentie per ronde uit de UI-instellingen lezen, zodat een
            // gewijzigd schema zonder herstart ingaat.
            double intervalHours;
            int retention;
            using (var instellingenScope = scopeFactory.CreateScope())
            {
                var inst = instellingenScope.ServiceProvider.GetRequiredService<BackupBeheerService>().LeesInstellingen();
                intervalHours = Math.Max(0.25, inst.IntervalUren);
                retention = Math.Max(1, inst.Retentie);
            }

            try
            {
                var pad = await MaakBackupAsync(retention, stoppingToken);
                logger.LogInformation("Database-back-up gemaakt: {Pad}", pad);
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch (BackupBeheerService.BackupKopieWaarschuwing w)
            {
                logger.LogWarning("{Bericht}", w.Message);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Database-back-up mislukt; volgende poging over {Uren} uur.", intervalHours);
            }

            await Task.Delay(TimeSpan.FromHours(intervalHours), stoppingToken);
        }
    }

    private async Task<string> MaakBackupAsync(int retention, CancellationToken cancellationToken)
    {
        using var scope = scopeFactory.CreateScope();
        var beheer = scope.ServiceProvider.GetRequiredService<BackupBeheerService>();
        return await beheer.MaakBackupAsync(retention, cancellationToken);
    }
}
