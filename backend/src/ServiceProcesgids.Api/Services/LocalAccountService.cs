using System.Data;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ServiceProcesgids.Api.Data;
using ServiceProcesgids.Api.Data.Entities;
using ServiceProcesgids.Api.Models;

namespace ServiceProcesgids.Api.Services;

public sealed class LocalAccountService(AppDbContext dbContext, PasswordHashService passwordHashService)
{
    public const string SessionStampClaim = "spg_session_stamp";

    // Bind the signed cookie to the current account state. No database migration
    // is needed; existing cookies without a stamp are deliberately signed out.
    private static string SessionStamp(LocalUserEntity user) => Convert.ToHexString(
        SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new
        {
            user.Id,
            user.PasswordHash,
            user.RolesJson,
            user.IsActive,
            UpdatedAt = user.UpdatedAtUtc?.UtcTicks
        }))));

    public async Task<bool> IsSessionCurrentAsync(
        ClaimsPrincipal principal,
        CancellationToken cancellationToken = default)
    {
        var id = principal.FindFirstValue(ClaimTypes.NameIdentifier);
        var stamp = principal.FindFirstValue(SessionStampClaim);
        if (principal.FindFirstValue("bron") != "local" ||
            string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(stamp))
        {
            return false;
        }

        var user = await dbContext.LocalUsers.AsNoTracking()
            .SingleOrDefaultAsync(user => user.Id == id, cancellationToken);
        return user is { IsActive: true } &&
            string.Equals(stamp, SessionStamp(user), StringComparison.Ordinal);
    }

    public async Task<LocalUserEntity?> ValidateCredentialsAsync(
        string username,
        string password,
        CancellationToken cancellationToken = default)
    {
        var normalized = NormalizeUserName(username);
        if (string.IsNullOrWhiteSpace(normalized))
        {
            return null;
        }

        var user = await dbContext.LocalUsers
            .AsNoTracking()
            .FirstOrDefaultAsync(
                localUser => localUser.NormalizedUserName == normalized && localUser.IsActive,
                cancellationToken);

        return user is not null && passwordHashService.VerifyPassword(password, user.PasswordHash)
            ? user
            : null;
    }

    public ClaimsPrincipal CreatePrincipal(LocalUserEntity user)
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, user.Id),
            new(ClaimTypes.Name, user.DisplayName),
            new("spg_username", user.UserName),
            new("bron", "local"),
            new(SessionStampClaim, SessionStamp(user))
        };

        if (!string.IsNullOrWhiteSpace(user.Email))
        {
            claims.Add(new Claim(ClaimTypes.Email, user.Email));
        }

        claims.AddRange(ReadRoles(user.RolesJson).Select(role => new Claim(ClaimTypes.Role, role)));

        return new ClaimsPrincipal(new ClaimsIdentity(claims, "spg-local", ClaimTypes.Name, ClaimTypes.Role));
    }

    public async Task<IReadOnlyList<LocalUserResponse>> GetUsersAsync(CancellationToken cancellationToken = default)
    {
        var users = await dbContext.LocalUsers
            .AsNoTracking()
            .OrderBy(user => user.DisplayName)
            .ThenBy(user => user.UserName)
            .ToListAsync(cancellationToken);

        return users.Select(ToResponse).ToList();
    }

    public async Task<LocalUserResponse?> GetUserAsync(string id, CancellationToken cancellationToken = default)
    {
        var user = await dbContext.LocalUsers.AsNoTracking().FirstOrDefaultAsync(localUser => localUser.Id == id, cancellationToken);
        return user is null ? null : ToResponse(user);
    }

    public async Task<bool> UserNameExistsAsync(string username, CancellationToken cancellationToken = default)
    {
        var normalized = NormalizeUserName(username);
        return await dbContext.LocalUsers.AnyAsync(user => user.NormalizedUserName == normalized, cancellationToken);
    }

    public async Task<LocalUserResponse> CreateUserAsync(
        LocalUserCreateRequest request,
        CancellationToken cancellationToken = default)
    {
        var roles = RoleNames.Normalize(request.Rollen);
        if (roles.Length == 0)
        {
            roles = [RoleNames.View];
        }

        var user = new LocalUserEntity
        {
            Id = $"u-local-{Guid.NewGuid():N}",
            UserName = request.Gebruikersnaam.Trim(),
            NormalizedUserName = NormalizeUserName(request.Gebruikersnaam),
            DisplayName = request.Naam.Trim(),
            Email = string.IsNullOrWhiteSpace(request.Email) ? null : request.Email.Trim(),
            PasswordHash = passwordHashService.HashPassword(request.Wachtwoord),
            RolesJson = JsonSerializer.Serialize(roles),
            IsActive = request.Actief ?? true,
            CreatedAtUtc = DateTimeOffset.UtcNow
        };

        dbContext.LocalUsers.Add(user);
        await dbContext.SaveChangesAsync(cancellationToken);

        return ToResponse(user);
    }

    public async Task<LocalUserResponse?> UpdateUserAsync(
        string id,
        LocalUserUpdateRequest request,
        CancellationToken cancellationToken = default)
    {
        // Serialize the check and mutation so two administrators cannot both
        // remove the last other administrator in concurrent requests.
        await using var transaction = await dbContext.Database.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken);
        var user = await dbContext.LocalUsers.SingleOrDefaultAsync(localUser => localUser.Id == id, cancellationToken);
        if (user is null) return null;
        var roles = RoleNames.Normalize(request.Rollen);
        var removesManagement = user.IsActive && ReadRoles(user.RolesJson).Contains(RoleNames.Manage) &&
            (!request.Actief || !roles.Contains(RoleNames.Manage));
        if (removesManagement)
        {
            var otherRoles = await dbContext.LocalUsers.AsNoTracking()
                .Where(other => other.IsActive && other.Id != id)
                .Select(other => other.RolesJson).ToListAsync(cancellationToken);
            if (!otherRoles.Any(value => ReadRoles(value).Contains(RoleNames.Manage)))
            {
                throw new LocalAccountException("last-active-administrator",
                    "Er moet minstens één actieve beheerder overblijven. Maak eerst een andere beheerder aan voordat je dit account deactiveert of de beheerrol verwijdert.");
            }
        }
        user.DisplayName = request.Naam.Trim();
        user.Email = string.IsNullOrWhiteSpace(request.Email) ? null : request.Email.Trim();
        user.RolesJson = JsonSerializer.Serialize(roles.Length == 0 ? [RoleNames.View] : roles);
        user.IsActive = request.Actief;
        user.UpdatedAtUtc = DateTimeOffset.UtcNow;
        await dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return ToResponse(user);
    }
    public async Task<LocalUserResponse?> SetPasswordAsync(
        string id,
        string password,
        CancellationToken cancellationToken = default)
    {
        var user = await dbContext.LocalUsers.FirstOrDefaultAsync(localUser => localUser.Id == id, cancellationToken);
        if (user is null)
        {
            return null;
        }

        user.PasswordHash = passwordHashService.HashPassword(password);
        user.UpdatedAtUtc = DateTimeOffset.UtcNow;
        await dbContext.SaveChangesAsync(cancellationToken);

        return ToResponse(user);
    }

    public static string NormalizeUserName(string? username) =>
        string.IsNullOrWhiteSpace(username) ? "" : username.Trim().ToUpperInvariant();

    public static string[] ReadRoles(string rolesJson)
    {
        if (string.IsNullOrWhiteSpace(rolesJson))
        {
            return [];
        }

        try
        {
            return RoleNames.Normalize(JsonSerializer.Deserialize<string[]>(rolesJson));
        }
        catch (JsonException)
        {
            return [];
        }
    }

    public static LocalUserResponse ToResponse(LocalUserEntity user) => new(
        user.Id,
        user.UserName,
        user.DisplayName,
        user.Email,
        ReadRoles(user.RolesJson),
        user.IsActive,
        user.CreatedAtUtc.ToString("O"),
        user.UpdatedAtUtc?.ToString("O"));
}

public sealed class LocalAccountException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}