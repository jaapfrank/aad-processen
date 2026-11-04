using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ServiceProcesgids.Api.Contract;
using ServiceProcesgids.Api.Data.Entities;
using ServiceProcesgids.Api.Models;
using ServiceProcesgids.Api.Services;

namespace ServiceProcesgids.Api.Data;

public sealed class DatabaseInitializer(
    AppDbContext dbContext,
    IWebHostEnvironment environment,
    RuntimeConfig runtimeConfig,
    PasswordHashService passwordHashService,
    ProcessVersionService processVersionService)
{
    public async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        await dbContext.Database.MigrateAsync(cancellationToken);

        await SeedLocalAdminAsync(cancellationToken);
        await SeedProcessFixtureAsync(cancellationToken);
        await SeedInitialProcessVersionsAsync(cancellationToken);
    }

    private async Task SeedLocalAdminAsync(CancellationToken cancellationToken)
    {
        if (!runtimeConfig.IsLocalMode)
        {
            return;
        }

        if (await dbContext.LocalUsers.AnyAsync(cancellationToken))
        {
            return;
        }

        if (!runtimeConfig.LocalUserBootstrapEnabled)
        {
            throw new InvalidOperationException(
                "De lokale database bevat nog geen gebruiker. Voer eerst de eenmalige opdracht " +
                "--bootstrap-local-admin uit met de tijdelijke omgevingsvariabelen " +
                "ServiceProcesgids__LocalUser__BootstrapEnabled=true en ServiceProcesgids__LocalUser__Password. " +
                "Een normale webstart maakt nooit stil een beheerder aan.");
        }

        var roles = RoleNames.Normalize(runtimeConfig.LocalRoles);
        dbContext.LocalUsers.Add(new LocalUserEntity
        {
            Id = runtimeConfig.LocalUserId,
            UserName = runtimeConfig.LocalUserName,
            NormalizedUserName = LocalAccountService.NormalizeUserName(runtimeConfig.LocalUserName),
            DisplayName = runtimeConfig.LocalUserName,
            Email = runtimeConfig.LocalUserEmail,
            PasswordHash = passwordHashService.HashPassword(runtimeConfig.LocalUserPassword),
            RolesJson = JsonSerializer.Serialize(roles.Length == 0 ? RoleNames.All : roles),
            IsActive = true,
            CreatedAtUtc = DateTimeOffset.UtcNow
        });

        await dbContext.SaveChangesAsync(cancellationToken);
    }

    private async Task SeedProcessFixtureAsync(CancellationToken cancellationToken)
    {
        if (!runtimeConfig.ShouldSeedDemoFixtures)
        {
            return;
        }

        var fixturesDir = FindFixturesDirectory(environment.ContentRootPath);
        if (fixturesDir is null)
        {
            return;
        }

        // Seed elke fixture waarvan het proces-id nog niet bestaat, zodat
        // nieuw toegevoegde proces-fixtures ook in bestaande databases landen.
        var bestaandeIds = (await dbContext.Processes
                .AsNoTracking()
                .Select(p => p.Id)
                .ToListAsync(cancellationToken))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var toegevoegd = false;
        foreach (var fixturePath in Directory.EnumerateFiles(fixturesDir, "*.json"))
        {
            var json = await File.ReadAllTextAsync(fixturePath, cancellationToken);
            var process = JsonSerializer.Deserialize<ProcessDocument>(json, ProcessJson.Options);
            if (process is null || string.IsNullOrWhiteSpace(process.Id) || bestaandeIds.Contains(process.Id))
            {
                continue;
            }

            dbContext.Processes.Add(ProcessMapper.ToEntity(process, process.Revision ?? 1));
            bestaandeIds.Add(process.Id);
            toegevoegd = true;
        }

        if (toegevoegd)
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
    }

    private async Task SeedInitialProcessVersionsAsync(CancellationToken cancellationToken)
    {
        var processIdsWithVersions = await dbContext.ProcessVersions
            .AsNoTracking()
            .Select(version => version.ProcessId)
            .Distinct()
            .ToListAsync(cancellationToken);

        var knownVersionProcessIds = processIdsWithVersions.ToHashSet(StringComparer.OrdinalIgnoreCase);
        var processes = await dbContext.Processes.ToListAsync(cancellationToken);
        var processesWithoutVersions = processes
            .Where(process => !knownVersionProcessIds.Contains(process.Id))
            .ToList();

        foreach (var process in processesWithoutVersions)
        {
            await processVersionService.EnsureInitialSnapshotAsync(
                process,
                "Systeem",
                cancellationToken);
        }
    }

    private static string? FindFixturesDirectory(string contentRoot)
    {
        var current = new DirectoryInfo(contentRoot);
        while (current is not null)
        {
            var candidate = Path.Combine(current.FullName, "contract", "fixtures");
            if (Directory.Exists(candidate))
            {
                return candidate;
            }

            current = current.Parent;
        }

        return null;
    }
}
