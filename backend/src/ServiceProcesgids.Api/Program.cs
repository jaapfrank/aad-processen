using System.Threading.RateLimiting;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using Microsoft.IdentityModel.Tokens;
using ServiceProcesgids.Api.Contract;
using ServiceProcesgids.Api.Data;
using ServiceProcesgids.Api.Data.Entities;
using ServiceProcesgids.Api.Models;
using ServiceProcesgids.Api.Services;

const string BootstrapLocalAdminArgument = "--bootstrap-local-admin";
var bootstrapLocalAdmin = args.Any(argument =>
    argument.Equals(BootstrapLocalAdminArgument, StringComparison.OrdinalIgnoreCase));
var hostArguments = args
    .Where(argument => !argument.Equals(BootstrapLocalAdminArgument, StringComparison.OrdinalIgnoreCase))
    .ToArray();

var builder = WebApplication.CreateBuilder(hostArguments);
builder.Services.AddWindowsService(options => options.ServiceName = "ServiceProcesgids");
var runtimeConfig = RuntimeConfig.From(builder.Configuration, builder.Environment);
var knownReverseProxies = HostingSecurityConfiguration.ReadKnownProxies(builder.Configuration);
if (knownReverseProxies.Length > 0)
{
    builder.Services.Configure<ForwardedHeadersOptions>(options =>
        HostingSecurityConfiguration.ConfigureForwarding(options, knownReverseProxies));
}
var bootstrapEnabledFromEnvironment = Environment.GetEnvironmentVariable(
    "ServiceProcesgids__LocalUser__BootstrapEnabled");
var bootstrapPasswordFromEnvironment = Environment.GetEnvironmentVariable(
    "ServiceProcesgids__LocalUser__Password");

if (bootstrapLocalAdmin)
{
    if (!runtimeConfig.IsLocalMode)
    {
        throw new InvalidOperationException(
            $"{BootstrapLocalAdminArgument} is alleen beschikbaar wanneer AuthMode=local.");
    }

    if (!string.Equals(bootstrapEnabledFromEnvironment, "true", StringComparison.OrdinalIgnoreCase) ||
        string.IsNullOrWhiteSpace(bootstrapPasswordFromEnvironment))
    {
        throw new InvalidOperationException(
            $"{BootstrapLocalAdminArgument} vereist de tijdelijke omgevingsvariabelen " +
            "ServiceProcesgids__LocalUser__BootstrapEnabled=true en ServiceProcesgids__LocalUser__Password.");
    }
}
else if (runtimeConfig.LocalUserBootstrapEnabled ||
         !string.IsNullOrWhiteSpace(bootstrapPasswordFromEnvironment))
{
    throw new InvalidOperationException(
        "Lokale-adminbootstrap mag niet tijdens een normale webstart actief zijn. " +
        $"Gebruik de eenmalige opdracht {BootstrapLocalAdminArgument} en verwijder daarna de tijdelijke omgevingsvariabelen.");
}

builder.Services.AddSingleton(runtimeConfig);
builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
    options.SerializerOptions.DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull;
    options.SerializerOptions.UnmappedMemberHandling =
        System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow;
});

var defaultAuthScheme = runtimeConfig.IsEntraMode
    ? JwtBearerDefaults.AuthenticationScheme
    : CookieAuthenticationDefaults.AuthenticationScheme;

var authentication = builder.Services
    .AddAuthentication(options =>
    {
        options.DefaultAuthenticateScheme = defaultAuthScheme;
        options.DefaultChallengeScheme = defaultAuthScheme;
        options.DefaultSignInScheme = CookieAuthenticationDefaults.AuthenticationScheme;
    })
    .AddCookie(CookieAuthenticationDefaults.AuthenticationScheme, options =>
    {
        options.Cookie.Name = "spg_session";
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Lax;
        options.Cookie.SecurePolicy = runtimeConfig.Online ? CookieSecurePolicy.Always : CookieSecurePolicy.SameAsRequest;
        options.ExpireTimeSpan = TimeSpan.FromHours(8);
        options.SlidingExpiration = true;
        options.Events.OnValidatePrincipal = async context =>
        {
            // A development cookie remains bound to the explicit local runtime
            // capability. It can never survive a switch to production auth.
            if (context.Principal?.FindFirst("bron")?.Value == DevelopmentLoginSession.Source)
            {
                if (runtimeConfig.DevelopmentLoginAvailable &&
                    System.Net.IPAddress.IsLoopback(context.HttpContext.Connection.RemoteIpAddress ?? System.Net.IPAddress.None))
                {
                    return;
                }
            }
            else if (runtimeConfig.IsLocalMode && context.Principal is not null &&
                await context.HttpContext.RequestServices.GetRequiredService<LocalAccountService>()
                    .IsSessionCurrentAsync(context.Principal, context.HttpContext.RequestAborted))
            {
                return;
            }

            context.RejectPrincipal();
            await context.HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        };
        options.Events.OnRedirectToLogin = context =>
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return context.Response.WriteAsJsonAsync(new ApiError("unauthorized", "Niet ingelogd."));
        };
        options.Events.OnRedirectToAccessDenied = context =>
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return context.Response.WriteAsJsonAsync(new ApiError("forbidden", "Onvoldoende rechten."));
        };
    });

if (runtimeConfig.IsEntraMode)
{
    var authority = runtimeConfig.Entra.EffectiveAuthority;
    var audience = runtimeConfig.Entra.EffectiveAudience;
    if (string.IsNullOrWhiteSpace(authority) || string.IsNullOrWhiteSpace(audience))
    {
        throw new InvalidOperationException("Configureer ServiceProcesgids:Entra:TenantId/Authority en ClientId/Audience wanneer AuthMode=entra.");
    }

    authentication.AddJwtBearer(JwtBearerDefaults.AuthenticationScheme, options =>
    {
        options.Authority = authority;
        options.Audience = audience;
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateAudience = true,
            ValidateIssuer = true,
            NameClaimType = "name",
            RoleClaimType = ClaimTypes.Role
        };
        options.Events = new JwtBearerEvents
        {
            OnTokenValidated = context =>
            {
                AddMappedEntraRoles(context.Principal, runtimeConfig);
                return Task.CompletedTask;
            }
        };
    });
}

builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("local-login", context => RateLimitPartition.GetFixedWindowLimiter(
        context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 20,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
            AutoReplenishment = true
        }));
});

builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("CanView", policy => policy.RequireAuthenticatedUser().RequireRole(RoleNames.CanView));
    options.AddPolicy("CanSuggest", policy => policy.RequireAuthenticatedUser().RequireRole(RoleNames.CanSuggest));
    options.AddPolicy("CanEdit", policy => policy.RequireAuthenticatedUser().RequireRole(RoleNames.CanEdit));
    options.AddPolicy("CanApprove", policy => policy.RequireAuthenticatedUser().RequireRole(RoleNames.CanApprove));
    options.AddPolicy("CanReview", policy => policy.RequireAuthenticatedUser().RequireRole(RoleNames.CanReview));
    options.AddPolicy("CanManage", policy => policy.RequireAuthenticatedUser().RequireRole(RoleNames.CanManage));
});

builder.Services.AddDbContext<AppDbContext>(options =>
{
    if (runtimeConfig.Storage.Equals("db", StringComparison.OrdinalIgnoreCase) &&
        !string.IsNullOrWhiteSpace(builder.Configuration.GetConnectionString("SqlServer")))
    {
        options.UseSqlServer(builder.Configuration.GetConnectionString("SqlServer"));
        return;
    }

    options.UseSqlite(GetSqliteConnectionString(builder.Configuration, builder.Environment.ContentRootPath));
});

builder.Services.AddScoped<DatabaseInitializer>();
builder.Services.AddHostedService<BackupService>();
builder.Services.AddHttpClient("ai");
builder.Services.AddScoped<AiService>();
builder.Services.AddScoped<IAiStructuredClient>(
    provider => provider.GetRequiredService<AiService>());
builder.Services.AddSingleton<ProcessMaintenanceValidator>();
builder.Services.AddScoped<ProcessMaintenanceContextService>();
builder.Services.AddScoped<AiRunLedgerService>();
builder.Services.AddScoped<ProcessMaintenanceService>();
var dataProtectionKeysPath = Path.Combine(builder.Environment.ContentRootPath, "App_Data", "data-protection-keys");
DataProtectionAiCredentialStore.EnsurePrivateDirectory(dataProtectionKeysPath);
var dataProtection = builder.Services.AddDataProtection()
    .SetApplicationName("ServiceProcesgids")
    .PersistKeysToFileSystem(new DirectoryInfo(dataProtectionKeysPath));
HostingSecurityConfiguration.ProtectKeyRing(dataProtection, builder.Configuration, runtimeConfig.Online);
builder.Services.AddSingleton<ProtectedSettingsStore>();
builder.Services.AddSingleton<IAiCredentialStore, DataProtectionAiCredentialStore>();
builder.Services.AddSingleton<AiSettingsService>();
builder.Services.AddScoped<BackupBeheerService>();
builder.Services.AddSingleton<BcService>();
builder.Services.AddSingleton<MeldingenService>();
builder.Services.AddSingleton<ChatGptOAuthService>();
builder.Services.AddSingleton<BrandingService>();
builder.Services.AddSingleton<PasswordHashService>();
builder.Services.AddScoped<LocalAccountService>();
builder.Services.AddScoped<CurrentUserService>();
builder.Services.AddScoped<AuditLogService>();
builder.Services.AddScoped<ProcessVersionService>();
builder.Services.AddScoped<ProcessWorkflowService>();
builder.Services.AddSingleton<ProcessDiffService>();
builder.Services.AddScoped<IsoService>();
builder.Services.AddScoped<AuditAssessmentService>();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddAssuranceFrameworkDrafts();
builder.Services.AddScoped<AssuranceFrameworkCatalogService>();
builder.Services.AddScoped<AssuranceSettingsService>();
builder.Services.AddScoped<AssuranceQuestionnaireService>();
builder.Services.AddScoped<AssuranceRunService>();
builder.Services.AddHostedService<ContinuousAssuranceWorker>();
builder.Services.AddScoped<PdfImportService>();
builder.Services.AddSingleton(_ => new DiagramPackageService());
builder.Services.AddSingleton<ProcessHealthService>();

var app = builder.Build();

if (runtimeConfig.DevelopmentLoginAvailable)
{
    app.Logger.LogWarning(
        "DEVELOPMENT-LOGINBYPASS ACTIEF: lokale verzoeken kunnen een tijdelijke beheerderssessie openen. " +
        "Deze runtime mag niet extern bereikbaar zijn.");
}

// Upgradegate: oude prototypecredentials worden vóór requestverwerking
// atomair uit plaintext naar Data Protection gemigreerd.
_ = app.Services.GetRequiredService<AiSettingsService>().Lees();
app.Services.GetRequiredService<ChatGptOAuthService>().SecureStoredTokens();
_ = app.Services.GetRequiredService<BcService>().Lees();
_ = app.Services.GetRequiredService<MeldingenService>().Lees();
_ = app.Services.GetRequiredService<MeldingenService>().LeesMail();

using (var scope = app.Services.CreateScope())
{
    var initializer = scope.ServiceProvider.GetRequiredService<DatabaseInitializer>();
    await initializer.InitializeAsync();
}

if (bootstrapLocalAdmin)
{
    Console.WriteLine("Database-migraties en lokale-adminbootstrap zijn voltooid; de webserver is niet gestart.");
    return;
}

// Bodybinding gebeurt vóór de endpoint-handler. Houd ook in Development het
// fail-closed JSON-contract schoon: geen framework-stacktrace of type-informatie
// terugsturen wanneer een request onbekende of ongeldige velden bevat.
app.Use(async (context, next) =>
{
    try
    {
        await next(context);
    }
    catch (BadHttpRequestException ex)
        when (ex.StatusCode == StatusCodes.Status400BadRequest &&
              !context.Response.HasStarted)
    {
        app.Logger.LogInformation(
            "Ongeldige JSON-request geweigerd. Path={Path}",
            context.Request.Path);
        context.Response.Clear();
        context.Response.StatusCode = StatusCodes.Status400BadRequest;
        await context.Response.WriteAsJsonAsync(
            new ApiError(
                "invalid-request",
                "Het verzoek bevat onbekende of ongeldige velden."),
            context.RequestAborted);
    }
});

// Never enable forwarding with an empty allowlist: ASP.NET would trust every proxy.
if (knownReverseProxies.Length > 0)
{
    app.UseForwardedHeaders();
}
if (runtimeConfig.Online)
{
    app.UseHsts();
    app.Use(async (context, next) =>
    {
        if (!context.Request.IsHttps && context.Request.Path != "/api/health" && context.Request.Path != "/api/health/ready")
        {
            context.Response.StatusCode = StatusCodes.Status400BadRequest;
            await context.Response.WriteAsJsonAsync(new ApiError("https-required", "Deze installatie vereist HTTPS via de vertrouwde proxy."));
            return;
        }
        await next(context);
    });
}

app.UseRateLimiter();
app.UseAuthentication();
app.Use(async (context, next) =>
{
    // Bearer-only Entra deployments have no ambient cookie authentication.
    // In local mode, an arbitrary Authorization header cannot bypass this gate.
    if (runtimeConfig.IsLocalMode && context.Request.Cookies.ContainsKey("spg_session") &&
        CookieRequestOrigin.IsUnsafe(context.Request) && !CookieRequestOrigin.IsAllowed(context.Request))
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        await context.Response.WriteAsJsonAsync(new ApiError("csrf-origin-denied",
            "Deze wijziging is alleen toegestaan vanuit deze applicatie."));
        return;
    }
    await next(context);
});
app.UseAuthorization();

app.MapGet("/api/config", () => Results.Ok(runtimeConfig.ToAppConfig()))
    .AllowAnonymous()
    .WithName("GetConfig");

app.MapGet("/api/me", (ClaimsPrincipal principal, CurrentUserService currentUser) =>
    Results.Ok(new MeResponse(currentUser.FromPrincipal(principal))))
    .RequireAuthorization()
    .WithName("GetMe");

app.MapPost("/api/auth/development-session", async (HttpContext httpContext) =>
{
    if (!runtimeConfig.DevelopmentLoginAvailable)
    {
        return Results.NotFound(new ApiError(
            "development-session-disabled",
            "De ontwikkelsessie is niet beschikbaar."));
    }

    if (!DevelopmentLoginSession.IsSafeLocalRequest(httpContext))
    {
        return Results.Json(
            new ApiError(
                "development-session-local-request-required",
                "De ontwikkelsessie vereist een directe loopbackaanvraag met de expliciete development-header."),
            statusCode: StatusCodes.Status403Forbidden);
    }

    var principal = DevelopmentLoginSession.CreatePrincipal();

    await httpContext.SignInAsync(
        CookieAuthenticationDefaults.AuthenticationScheme,
        principal,
        DevelopmentLoginSession.CreateAuthenticationProperties(DateTimeOffset.UtcNow));

    return Results.Ok(new MeResponse(new User(
        DevelopmentLoginSession.UserId,
        DevelopmentLoginSession.DisplayName,
        null,
        DevelopmentLoginSession.Source,
        RoleNames.All,
        [])));
})
.AllowAnonymous()
.WithName("DevelopmentSession");

app.MapPost("/api/auth/login", async (
    HttpContext httpContext,
    LocalLoginRequest request,
    LocalAccountService accounts,
    CurrentUserService currentUser) =>
{
    if (!runtimeConfig.IsLocalMode)
    {
        return Results.BadRequest(new ApiError("auth-mode-not-local", "Lokale login is alleen beschikbaar wanneer authMode=local."));
    }

    var user = await accounts.ValidateCredentialsAsync(request.Gebruikersnaam, request.Wachtwoord, httpContext.RequestAborted);
    if (user is null)
    {
        return Results.Unauthorized();
    }

    var principal = accounts.CreatePrincipal(user);
    await httpContext.SignInAsync(
        CookieAuthenticationDefaults.AuthenticationScheme,
        principal,
        new AuthenticationProperties
        {
            AllowRefresh = true,
            ExpiresUtc = DateTimeOffset.UtcNow.AddHours(8),
            IsPersistent = true
        });

    return Results.Ok(new MeResponse(currentUser.FromPrincipal(principal)));
})
.AllowAnonymous()
.RequireRateLimiting("local-login")
.WithName("LocalLogin");

app.MapPost("/api/auth/logout", async (HttpContext httpContext) =>
{
    await httpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
    return Results.NoContent();
})
    .RequireAuthorization()
    .WithName("Logout");

var localUsers = app.MapGroup("/api/admin/users")
    .RequireAuthorization("CanManage");

localUsers.MapGet("/", async (LocalAccountService accounts, HttpContext httpContext) =>
{
    if (!runtimeConfig.IsLocalMode)
    {
        return Results.BadRequest(new ApiError("auth-mode-not-local", "Lokaal gebruikersbeheer is alleen beschikbaar wanneer authMode=local."));
    }

    return Results.Ok(await accounts.GetUsersAsync(httpContext.RequestAborted));
})
.WithName("ListLocalUsers");

localUsers.MapGet("/{id}", async (LocalAccountService accounts, HttpContext httpContext, string id) =>
{
    if (!runtimeConfig.IsLocalMode)
    {
        return Results.BadRequest(new ApiError("auth-mode-not-local", "Lokaal gebruikersbeheer is alleen beschikbaar wanneer authMode=local."));
    }

    var user = await accounts.GetUserAsync(id, httpContext.RequestAborted);
    return user is null
        ? Results.NotFound(new ApiError("local-user-not-found", $"Lokale gebruiker '{id}' is niet gevonden."))
        : Results.Ok(user);
})
.WithName("GetLocalUser");

localUsers.MapPost("/", async (LocalAccountService accounts, HttpContext httpContext, LocalUserCreateRequest request) =>
{
    if (!runtimeConfig.IsLocalMode)
    {
        return Results.BadRequest(new ApiError("auth-mode-not-local", "Lokaal gebruikersbeheer is alleen beschikbaar wanneer authMode=local."));
    }

    if (string.IsNullOrWhiteSpace(request.Gebruikersnaam) ||
        string.IsNullOrWhiteSpace(request.Naam) ||
        string.IsNullOrWhiteSpace(request.Wachtwoord))
    {
        return Results.BadRequest(new ApiError("local-user-invalid", "Gebruikersnaam, naam en wachtwoord zijn verplicht."));
    }

    if (await accounts.UserNameExistsAsync(request.Gebruikersnaam, httpContext.RequestAborted))
    {
        return Results.Conflict(new ApiError("local-user-exists", $"Gebruiker '{request.Gebruikersnaam}' bestaat al."));
    }

    var created = await accounts.CreateUserAsync(request, httpContext.RequestAborted);
    return Results.Created($"/api/admin/users/{created.Id}", created);
})
.WithName("CreateLocalUser");

localUsers.MapPut("/{id}", async (LocalAccountService accounts, HttpContext httpContext, string id, LocalUserUpdateRequest request) =>
{
    if (!runtimeConfig.IsLocalMode)
    {
        return Results.BadRequest(new ApiError("auth-mode-not-local", "Lokaal gebruikersbeheer is alleen beschikbaar wanneer authMode=local."));
    }

    if (string.IsNullOrWhiteSpace(request.Naam))
    {
        return Results.BadRequest(new ApiError("local-user-invalid", "Naam is verplicht."));
    }

    try
    {
        var updated = await accounts.UpdateUserAsync(id, request, httpContext.RequestAborted);
        return updated is null
            ? Results.NotFound(new ApiError("local-user-not-found", $"Lokale gebruiker '{id}' is niet gevonden."))
            : Results.Ok(updated);
    }
    catch (LocalAccountException ex)
    {
        return Results.Conflict(new ApiError(ex.Code, ex.Message));
    }
})
.WithName("UpdateLocalUser");

localUsers.MapPost("/{id}/password", async (LocalAccountService accounts, HttpContext httpContext, string id, LocalPasswordChangeRequest request) =>
{
    if (!runtimeConfig.IsLocalMode)
    {
        return Results.BadRequest(new ApiError("auth-mode-not-local", "Lokaal gebruikersbeheer is alleen beschikbaar wanneer authMode=local."));
    }

    if (string.IsNullOrWhiteSpace(request.Wachtwoord))
    {
        return Results.BadRequest(new ApiError("local-password-invalid", "Wachtwoord is verplicht."));
    }

    var updated = await accounts.SetPasswordAsync(id, request.Wachtwoord, httpContext.RequestAborted);
    return updated is null
        ? Results.NotFound(new ApiError("local-user-not-found", $"Lokale gebruiker '{id}' is niet gevonden."))
        : Results.Ok(updated);
})
.WithName("SetLocalUserPassword");

app.MapMethods("/api/openapi.yaml", ["GET", "HEAD"], () =>
{
    var contractPath = FindContractOpenApi(app.Environment.ContentRootPath);
    return contractPath is null
        ? Results.NotFound(new ApiError("openapi-not-found", "contract/openapi.yaml is niet gevonden."))
        : Results.File(contractPath, "application/yaml");
})
.AllowAnonymous()
.WithName("GetOpenApiYaml");

app.MapGet("/swagger", () => Results.Content(GetOpenApiPage(), "text/html"))
    .AllowAnonymous()
    .WithName("OpenApiUi");

app.MapGet("/api/health", () => Results.Ok(new
{
    status = "ok",
    service = "Service Procesgids API",
    version = runtimeConfig.Version,
    runtimeMode = runtimeConfig.RuntimeMode,
    dataSource = runtimeConfig.DataSource,
    utc = DateTimeOffset.UtcNow
}))
.AllowAnonymous()
.WithName("Health");

app.MapGet("/api/health/ready", async (AppDbContext db, CancellationToken cancellationToken) =>
{
    // Requests are accepted only after DatabaseInitializer has completed.
    try
    {
        return await db.Database.CanConnectAsync(cancellationToken)
            ? Results.Ok(new { status = "ready" })
            : Results.Json(new { status = "unavailable" }, statusCode: StatusCodes.Status503ServiceUnavailable);
    }
    catch (Exception ex) when (ex is not OperationCanceledException)
    {
        app.Logger.LogWarning("Database-readinesscontrole mislukt. ErrorType={ErrorType}", ex.GetType().Name);
        return Results.Json(new { status = "unavailable" }, statusCode: StatusCodes.Status503ServiceUnavailable);
    }
})
.AllowAnonymous()
.WithName("Readiness");
var processRoutes = app.MapGroup("/api/processes");
processRoutes.RequireAuthorization("CanView");

processRoutes.MapGet("/", async (
    AppDbContext db,
    ProcessVersionService versions,
    string? status,
    string? q) =>
{
    if (!string.IsNullOrWhiteSpace(status) &&
        !status.Equals("live", StringComparison.OrdinalIgnoreCase))
    {
        return Results.Ok(Array.Empty<ProcessSummary>());
    }

    var activeProcessIds = await db.Processes
        .AsNoTracking()
        .Where(process => process.Status != "gearchiveerd")
        .Select(process => process.Id)
        .ToListAsync();

    var publishedVersions = await db.ProcessVersions
        .AsNoTracking()
        .Where(version => version.Status == "live" && activeProcessIds.Contains(version.ProcessId))
        .OrderBy(version => version.ProcessId)
        .ThenByDescending(version => version.VersionNr)
        .ToListAsync();

    var queryText = q?.Trim();
    var processes = publishedVersions
        .GroupBy(version => version.ProcessId, StringComparer.OrdinalIgnoreCase)
        .Select(group => versions.ToProcessDocument(group.First()))
        .Where(process =>
            string.IsNullOrWhiteSpace(queryText) ||
            process.Hoofdproces.Contains(queryText, StringComparison.OrdinalIgnoreCase) ||
            process.Detailproces.Contains(queryText, StringComparison.OrdinalIgnoreCase) ||
            process.Stappen.Any(step =>
                step.Activiteit.Contains(queryText, StringComparison.OrdinalIgnoreCase) ||
                (step.Toelichting?.Contains(queryText, StringComparison.OrdinalIgnoreCase) ?? false) ||
                (step.Opmerking?.Contains(queryText, StringComparison.OrdinalIgnoreCase) ?? false)))
        .OrderBy(process => process.Hoofdproces)
        .ThenBy(process => process.Detailproces)
        .Select(ProcessMapper.ToSummary)
        .ToList();

    return Results.Ok(processes);
})
.WithName("ListProcesses");

processRoutes.MapGet("/{id}", async (
    AppDbContext db,
    ProcessVersionService versions,
    string id) =>
{
    var isActive = await db.Processes
        .AsNoTracking()
        .AnyAsync(process => process.Id == id && process.Status != "gearchiveerd");
    if (!isActive)
    {
        return Results.NotFound(new ApiError("process-not-found", $"Proces '{id}' is niet gevonden."));
    }

    var publishedVersion = await db.ProcessVersions
        .AsNoTracking()
        .Where(version => version.ProcessId == id && version.Status == "live")
        .OrderByDescending(version => version.VersionNr)
        .FirstOrDefaultAsync();

    return publishedVersion is null
        ? Results.NotFound(new ApiError("process-not-found", $"Proces '{id}' is niet gevonden."))
        : Results.Ok(versions.ToProcessDocument(publishedVersion));
})
.WithName("GetProcess");

var workspaceRoutes = app.MapGroup("/api/workspace/processes")
    .RequireAuthorization("CanReview");

workspaceRoutes.MapGet("/", async (AppDbContext db, string? status, string? q) =>
{
    var query = db.Processes.AsNoTracking();

    if (!string.IsNullOrWhiteSpace(status))
    {
        query = query.Where(process => process.Status == status);
    }

    if (!string.IsNullOrWhiteSpace(q))
    {
        var like = $"%{q.Trim()}%";
        query = query.Where(process =>
            EF.Functions.Like(process.Hoofdproces, like) ||
            EF.Functions.Like(process.Detailproces, like) ||
            EF.Functions.Like(process.DocumentJson, like));
    }

    var processes = await query
        .OrderBy(process => process.Hoofdproces)
        .ThenBy(process => process.Detailproces)
        .Select(process => ProcessMapper.ToSummary(process))
        .ToListAsync();

    return Results.Ok(processes);
})
.WithName("ListWorkspaceProcesses");

workspaceRoutes.MapGet("/{id}", async (AppDbContext db, string id) =>
{
    var entity = await db.Processes.AsNoTracking().FirstOrDefaultAsync(process => process.Id == id);
    return entity is null
        ? Results.NotFound(new ApiError("process-not-found", $"Werkversie van proces '{id}' is niet gevonden."))
        : Results.Ok(ProcessMapper.ToDocument(entity));
})
.WithName("GetWorkspaceProcess");

processRoutes.MapPost("/", async (
    AppDbContext db,
    ProcessVersionService versions,
    AuditLogService audit,
    CurrentUserService currentUser,
    ClaimsPrincipal principal,
    ProcessDocument process) =>
{
    if (await db.Processes.AnyAsync(existing => existing.Id == process.Id))
    {
        return Results.Conflict(new ApiError("process-exists", $"Proces '{process.Id}' bestaat al."));
    }

    var document = process with
    {
        Status = "concept",
        Revision = 1,
        LaatsteWijziging = NormalizeDate(process.LaatsteWijziging)
    };

    var entity = ProcessMapper.ToEntity(document, 1);
    await using var transaction = await db.Database.BeginTransactionAsync();
    db.Processes.Add(entity);
    await db.SaveChangesAsync();

    var actor = currentUser.FromPrincipal(principal);
    await versions.CreateSnapshotAsync(entity, actor.Naam, "Proces aangemaakt", null);
    await audit.WriteAsync("process.create", "process", entity.Id, actor, new { entity.Revision });
    await transaction.CommitAsync();

    return Results.Created($"/api/processes/{entity.Id}", ProcessMapper.ToDocument(entity));
})
.RequireAuthorization("CanEdit")
.WithName("CreateProcess");

processRoutes.MapPut("/{id}", async (
    AppDbContext db,
    ProcessVersionService versions,
    AuditLogService audit,
    CurrentUserService currentUser,
    ClaimsPrincipal principal,
    string id,
    ProcessDocument process) =>
{
    if (!id.Equals(process.Id, StringComparison.OrdinalIgnoreCase))
    {
        return Results.BadRequest(new ApiError("id-mismatch", "Het proces-id in de URL en body moet gelijk zijn."));
    }

    var entity = await db.Processes.FirstOrDefaultAsync(existing => existing.Id == id);
    if (entity is null)
    {
        return Results.NotFound(new ApiError("process-not-found", $"Proces '{id}' is niet gevonden."));
    }

    if (process.Revision is null || process.Revision.Value != entity.Revision)
    {
        return Results.Conflict(new ApiError(
            "revision-conflict",
            $"Proces '{id}' is ondertussen gewijzigd. Verwacht revisie {entity.Revision}, ontvangen {process.Revision?.ToString() ?? "geen"}; laad het proces opnieuw."));
    }

    if (entity.Status.Equals("gearchiveerd", StringComparison.OrdinalIgnoreCase))
    {
        return Results.Conflict(new ApiError("workflow-invalid-status", "Een gearchiveerd proces kan niet via een gewone wijziging worden heropend."));
    }

    var nextRevision = entity.Revision + 1;
    var document = process with
    {
        Status = "concept",
        Revision = nextRevision,
        LaatsteWijziging = NormalizeDate(process.LaatsteWijziging)
    };

    await using var transaction = await db.Database.BeginTransactionAsync();
    ProcessMapper.UpdateEntity(entity, document, nextRevision);
    try
    {
        await db.SaveChangesAsync();

        var actor = currentUser.FromPrincipal(principal);
        await versions.CreateSnapshotAsync(entity, actor.Naam, "Proces gewijzigd", null);
        await audit.WriteAsync("process.update", "process", entity.Id, actor, new { entity.Revision });
        await transaction.CommitAsync();
    }
    catch (DbUpdateConcurrencyException)
    {
        await transaction.RollbackAsync();
        return Results.Conflict(new ApiError(
            "revision-conflict",
            $"Proces '{id}' is ondertussen gewijzigd; laad het proces opnieuw."));
    }

    return Results.Ok(ProcessMapper.ToDocument(entity));
})
.RequireAuthorization("CanEdit")
.WithName("UpdateProcess");

processRoutes.MapDelete("/{id}", async (
    AppDbContext db,
    ProcessVersionService versions,
    AuditLogService audit,
    CurrentUserService currentUser,
    ClaimsPrincipal principal,
    string id) =>
{
    var entity = await db.Processes.FirstOrDefaultAsync(existing => existing.Id == id);
    if (entity is null)
    {
        return Results.NotFound(new ApiError("process-not-found", $"Proces '{id}' is niet gevonden."));
    }

    var document = ProcessMapper.ToDocument(entity) with
    {
        Status = "gearchiveerd",
        Revision = entity.Revision + 1,
        LaatsteWijziging = DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd")
    };

    await using var transaction = await db.Database.BeginTransactionAsync();
    ProcessMapper.UpdateEntity(entity, document, document.Revision ?? entity.Revision + 1);
    await db.SaveChangesAsync();

    var actor = currentUser.FromPrincipal(principal);
    await versions.CreateSnapshotAsync(entity, actor.Naam, "Proces gearchiveerd", null);
    await audit.WriteAsync("process.archive", "process", entity.Id, actor, new { entity.Revision });
    await transaction.CommitAsync();

    return Results.NoContent();
})
.RequireAuthorization("CanManage")
.WithName("ArchiveProcess");

processRoutes.MapGet("/{id}/health", async (AppDbContext db, ProcessHealthService healthService, string id) =>
{
    var entity = await db.Processes.AsNoTracking().FirstOrDefaultAsync(process => process.Id == id);
    if (entity is null)
    {
        return Results.NotFound(new ApiError("process-not-found", $"Proces '{id}' is niet gevonden."));
    }

    var knownProcessIds = (await db.Processes.AsNoTracking().Select(process => process.Id).ToListAsync())
        .ToHashSet(StringComparer.OrdinalIgnoreCase);

    return Results.Ok(healthService.CreateReport(ProcessMapper.ToDocument(entity), knownProcessIds));
})
.RequireAuthorization("CanReview")
.WithName("GetProcessHealth");

processRoutes.MapGet("/{id}/export", async (AppDbContext db, string id) =>
{
    var entity = await db.Processes.AsNoTracking().FirstOrDefaultAsync(process => process.Id == id);
    return entity is null
        ? Results.NotFound(new ApiError("process-not-found", $"Proces '{id}' is niet gevonden."))
        : Results.Ok(ProcessMapper.ToDocument(entity));
})
.RequireAuthorization("CanReview")
.WithName("ExportProcess");

processRoutes.MapGet("/{id}/iso", async (
    AppDbContext db,
    IsoService iso,
    string id) =>
{
    if (!await db.Processes.AsNoTracking().AnyAsync(process => process.Id == id))
    {
        return Results.NotFound(new ApiError("process-not-found", $"Proces '{id}' is niet gevonden."));
    }

    return Results.Ok(await iso.GetConfigAsync(id));
})
.RequireAuthorization("CanReview")
.WithName("GetProcessIso");

processRoutes.MapPut("/{id}/iso", async (
    AppDbContext db,
    IsoService iso,
    AuditLogService audit,
    CurrentUserService currentUser,
    ClaimsPrincipal principal,
    string id,
    IsoProcessConfig config) =>
{
    if (!id.Equals(config.ProcesId, StringComparison.OrdinalIgnoreCase))
    {
        return Results.BadRequest(new ApiError("id-mismatch", "Het proces-id in de URL en body moet gelijk zijn."));
    }

    if (!await db.Processes.AsNoTracking().AnyAsync(process => process.Id == id))
    {
        return Results.NotFound(new ApiError("process-not-found", $"Proces '{id}' is niet gevonden."));
    }

    var actor = currentUser.FromPrincipal(principal);
    var saved = await iso.SaveConfigAsync(config, actor.Naam);
    await audit.WriteAsync("iso.update", "process", id, actor, new { mappings = saved.Mappings.Count });

    return Results.Ok(saved);
})
.RequireAuthorization("CanEdit")
.WithName("UpdateProcessIso");

processRoutes.MapPost("/{id}/audit/start", async (
    AuditAssessmentService assessments,
    CurrentUserService currentUser,
    ClaimsPrincipal principal,
    string id,
    AuditBeoordelingStartRequest request,
    CancellationToken cancellationToken) =>
{
    try
    {
        var actor = currentUser.FromPrincipal(principal);
        return Results.Ok(await assessments.StartAsync(
            id,
            request.KaderId,
            actor,
            cancellationToken));
    }
    catch (AuditAssessmentException ex)
    {
        return Results.Json(
            new ApiError(ex.Code, ex.Message),
            statusCode: ex.StatusCode);
    }
})
.RequireAuthorization("CanReview")
.WithName("StartAuditAssessment");

processRoutes.MapPost("/{id}/audit/confirmations", async (
    AuditAssessmentService assessments,
    CurrentUserService currentUser,
    ClaimsPrincipal principal,
    string id,
    AuditBevestigingRequest request,
    CancellationToken cancellationToken) =>
{
    try
    {
        var actor = currentUser.FromPrincipal(principal);
        return Results.Ok(await assessments.ConfirmAsync(
            id,
            request,
            actor,
            cancellationToken));
    }
    catch (AuditAssessmentException ex)
    {
        return Results.Json(
            new ApiError(ex.Code, ex.Message),
            statusCode: ex.StatusCode);
    }
})
.RequireAuthorization("CanReview")
.WithName("ConfirmAuditAssessment");

processRoutes.MapPost("/{id}/submit", async (
    ProcessWorkflowService workflow,
    MeldingenService meldingen,
    CurrentUserService currentUser,
    ClaimsPrincipal principal,
    string id,
    WorkflowCommentRequest request,
    CancellationToken cancellationToken) =>
{
    try
    {
        var actor = currentUser.FromPrincipal(principal);
        var version = await workflow.TransitionAsync(id, ProcessWorkflowAction.Submit,
            request.ExpectedRevision, request.Opmerking, actor, cancellationToken);
        meldingen.StuurIndienen(id, actor.Naam);
        return Results.Ok(version);
    }
    catch (ProcessWorkflowException ex)
    {
        return Results.Json(new ApiError(ex.Code, ex.Message), statusCode: ex.StatusCode);
    }
})
.RequireAuthorization("CanEdit")
.WithName("SubmitProcess");

processRoutes.MapPost("/{id}/approve", async (
    ProcessWorkflowService workflow,
    MeldingenService meldingen,
    CurrentUserService currentUser,
    ClaimsPrincipal principal,
    string id,
    WorkflowCommentRequest request,
    CancellationToken cancellationToken) =>
{
    try
    {
        var actor = currentUser.FromPrincipal(principal);
        var version = await workflow.TransitionAsync(id, ProcessWorkflowAction.Approve,
            request.ExpectedRevision, request.Opmerking, actor, cancellationToken);
        meldingen.StuurGoedkeuren(id, actor.Naam);
        return Results.Ok(version);
    }
    catch (ProcessWorkflowException ex)
    {
        return Results.Json(new ApiError(ex.Code, ex.Message), statusCode: ex.StatusCode);
    }
})
.RequireAuthorization("CanApprove")
.WithName("ApproveProcess");

processRoutes.MapPost("/{id}/reject", async (
    ProcessWorkflowService workflow,
    CurrentUserService currentUser,
    ClaimsPrincipal principal,
    string id,
    RejectRequest request,
    CancellationToken cancellationToken) =>
{
    try
    {
        var version = await workflow.TransitionAsync(id, ProcessWorkflowAction.Reject,
            request.ExpectedRevision, request.Reden, currentUser.FromPrincipal(principal), cancellationToken);
        return Results.Ok(version);
    }
    catch (ProcessWorkflowException ex)
    {
        return Results.Json(new ApiError(ex.Code, ex.Message), statusCode: ex.StatusCode);
    }
})
.RequireAuthorization("CanApprove")
.WithName("RejectProcess");
processRoutes.MapGet("/{id}/versions", async (
    AppDbContext db,
    ProcessVersionService versions,
    string id) =>
{
    if (!await db.Processes.AsNoTracking().AnyAsync(process => process.Id == id))
    {
        return Results.NotFound(new ApiError("process-not-found", $"Proces '{id}' is niet gevonden."));
    }

    return Results.Ok(await versions.GetVersionsAsync(id));
})
.RequireAuthorization("CanReview")
.WithName("ListProcessVersions");

processRoutes.MapGet("/{id}/versions/{v:int}", async (
    ProcessVersionService versions,
    string id,
    int v) =>
{
    var version = await versions.GetVersionEntityAsync(id, v);
    return version is null
        ? Results.NotFound(new ApiError("process-version-not-found", $"Versie {v} van proces '{id}' is niet gevonden."))
        : Results.Ok(versions.ToProcessDocument(version));
})
.RequireAuthorization("CanReview")
.WithName("GetProcessVersion");

processRoutes.MapGet("/{id}/diff", async (
    ProcessVersionService versions,
    ProcessDiffService diffService,
    HttpContext httpContext,
    string id) =>
{
    if (!TryReadIntQuery(httpContext, "from", out var from) ||
        !TryReadIntQuery(httpContext, "to", out var to))
    {
        return Results.BadRequest(new ApiError("diff-query-invalid", "Queryparameters 'from' en 'to' zijn verplicht en moeten gehele getallen zijn."));
    }

    var fromVersion = await versions.GetVersionEntityAsync(id, from);
    var toVersion = await versions.GetVersionEntityAsync(id, to);
    if (fromVersion is null || toVersion is null)
    {
        return Results.NotFound(new ApiError("process-version-not-found", $"Een of beide versies van proces '{id}' zijn niet gevonden."));
    }

    return Results.Ok(diffService.CreateReport(
        versions.ToProcessDocument(fromVersion),
        versions.ToProcessDocument(toVersion),
        from,
        to));
})
.RequireAuthorization("CanReview")
.WithName("GetProcessDiff");

processRoutes.MapPost("/{id}/steps/{stepId}/suggestions", async (
    AppDbContext db,
    ProcessVersionService versions,
    AuditLogService audit,
    MeldingenService meldingen,
    CurrentUserService currentUser,
    ClaimsPrincipal principal,
    string id,
    string stepId,
    SuggestionCreateRequest request) =>
{
    if (!IsValidSuggestionType(request.Type) || string.IsNullOrWhiteSpace(request.Tekst))
    {
        return Results.BadRequest(new ApiError("suggestion-invalid", "Suggestietype en tekst zijn verplicht."));
    }

    var isActive = await db.Processes
        .AsNoTracking()
        .AnyAsync(process => process.Id == id && process.Status != "gearchiveerd");
    if (!isActive)
    {
        return Results.NotFound(new ApiError("process-not-found", $"Gepubliceerd proces '{id}' is niet gevonden."));
    }

    var publishedVersion = await db.ProcessVersions
        .AsNoTracking()
        .Where(version => version.ProcessId == id && version.Status == "live")
        .OrderByDescending(version => version.VersionNr)
        .FirstOrDefaultAsync();
    if (publishedVersion is null)
    {
        return Results.NotFound(new ApiError("process-not-found", $"Gepubliceerd proces '{id}' is niet gevonden."));
    }

    var process = versions.ToProcessDocument(publishedVersion);
    if (!process.Stappen.Any(step => step.Id.Equals(stepId, StringComparison.OrdinalIgnoreCase)))
    {
        return Results.NotFound(new ApiError("step-not-found", $"Stap '{stepId}' is niet gevonden in proces '{id}'."));
    }

    var actor = currentUser.FromPrincipal(principal);
    var suggestion = new SuggestionEntity
    {
        Id = $"sug-{Guid.NewGuid():N}",
        ProcessId = id,
        StepId = stepId,
        Type = request.Type,
        Text = request.Tekst.Trim(),
        CreatedBy = actor.Naam,
        CreatedAtUtc = DateTimeOffset.UtcNow,
        Status = "open"
    };

    db.Suggestions.Add(suggestion);
    await db.SaveChangesAsync();
    await audit.WriteAsync("suggestion.create", "suggestion", suggestion.Id, actor, new { id, stepId, suggestion.Type });

    meldingen.StuurSuggestie(id, suggestion.CreatedBy);
    return Results.Created($"/api/suggestions/{suggestion.Id}", ToSuggestionDocument(suggestion));
})
.RequireAuthorization("CanSuggest")
.WithName("CreateStepSuggestion");

processRoutes.MapPost("/import-json", async (
    AppDbContext db,
    ProcessVersionService versions,
    AuditLogService audit,
    CurrentUserService currentUser,
    ClaimsPrincipal principal,
    ProcessDocument process) =>
{
    if (await db.Processes.AnyAsync(existing => existing.Id == process.Id))
    {
        return Results.Conflict(new ApiError("process-exists", $"Proces '{process.Id}' bestaat al."));
    }

    var document = process with
    {
        Status = "concept",
        Revision = 1,
        LaatsteWijziging = NormalizeDate(process.LaatsteWijziging)
    };

    var entity = ProcessMapper.ToEntity(document, 1);
    await using var transaction = await db.Database.BeginTransactionAsync();
    db.Processes.Add(entity);
    await db.SaveChangesAsync();

    var actor = currentUser.FromPrincipal(principal);
    await versions.CreateSnapshotAsync(entity, actor.Naam, "Proces geïmporteerd uit JSON", null);
    await audit.WriteAsync("process.import-json", "process", entity.Id, actor, new { entity.Revision });
    await transaction.CommitAsync();

    return Results.Created($"/api/processes/{entity.Id}", ProcessMapper.ToDocument(entity));
})
.RequireAuthorization("CanEdit")
.WithName("ImportProcessJson");

// Huisstijl (white-label): GET anoniem (inlogscherm), PUT/reset rol beheren.
app.MapGet("/api/branding", (BrandingService branding) => Results.Ok(branding.Lees()))
    .AllowAnonymous()
    .WithName("GetBranding");

app.MapPut("/api/admin/branding", (BrandingService branding, Branding request) =>
{
    try
    {
        branding.Bewaar(request);
        return Results.NoContent();
    }
    catch (InvalidOperationException ex)
    {
        return Results.BadRequest(new ApiError("branding-ongeldig", ex.Message));
    }
})
.RequireAuthorization("CanManage")
.WithName("PutBranding");

app.MapPost("/api/admin/branding/reset", (BrandingService branding) =>
{
    branding.Reset();
    return Results.NoContent();
})
.RequireAuthorization("CanManage")
.WithName("ResetBranding");

// Lokale ChatGPT/Codex OAuth — koppelen met een ChatGPT-abonnement (rol beheren).
app.MapPost("/api/admin/chatgpt-oauth/start", (ChatGptOAuthService chatgpt) =>
{
    if (!chatgpt.IsAvailable)
    {
        return Results.NotFound(new ApiError(
            "ai-legacy-oauth-disabled",
            "De lokale ChatGPT/Codex OAuth-koppeling is alleen beschikbaar in een lokale offline installatie."));
    }

    try
    {
        var url = chatgpt.StartLogin();
        return Results.Ok(new { authorizationUrl = url });
    }
    catch (AiConfigurationException ex)
    {
        return Results.Conflict(new ApiError(ex.Code, ex.Message));
    }
})
.RequireAuthorization("CanManage")
.WithName("StartChatGptOAuth");

app.MapGet("/api/admin/chatgpt-oauth/status", (ChatGptOAuthService chatgpt) =>
{
    var t = chatgpt.Lees();
    return Results.Ok(new
    {
        available = chatgpt.IsAvailable,
        connectionKind = "local-oauth",
        standaloneOnly = true,
        // Compatibiliteitsveld voor bestaande clients.
        legacy = true,
        productionAllowed = false,
        gekoppeld = t is not null,
        accountId = t?.AccountId,
        verlooptOp = t?.VerlooptOp,
        wachtOpCallback = chatgpt.ListenerActief
    });
})
.RequireAuthorization("CanManage")
.WithName("ChatGptOAuthStatus");

app.MapPost("/api/admin/chatgpt-oauth/logout", (ChatGptOAuthService chatgpt) =>
{
    if (!chatgpt.IsAvailable)
    {
        return Results.NotFound(new ApiError(
            "ai-legacy-oauth-disabled",
            "De lokale ChatGPT/Codex OAuth-koppeling is alleen beschikbaar in een lokale offline installatie."));
    }

    chatgpt.Ontkoppel();
    return Results.NoContent();
})
.RequireAuthorization("CanManage")
.WithName("ChatGptOAuthLogout");

// Meldingen (Teams/Slack-webhook) — rol beheren.
app.MapGet("/api/admin/meldingen-instellingen", (MeldingenService meldingen) =>
{
    var s = meldingen.Lees();
    return Results.Ok(new
    {
        webhookUrl = s?.WebhookUrl ?? "",
        bijSuggestie = s?.BijSuggestie ?? true,
        bijIndienen = s?.BijIndienen ?? true,
        bijGoedkeuren = s?.BijGoedkeuren ?? true,
        geconfigureerd = !string.IsNullOrWhiteSpace(s?.WebhookUrl)
    });
})
.RequireAuthorization("CanManage")
.WithName("GetMeldingenInstellingen");

app.MapPut("/api/admin/meldingen-instellingen", (MeldingenService meldingen, MeldingenInstellingen request) =>
{
    meldingen.Bewaar(request);
    return Results.NoContent();
})
.RequireAuthorization("CanManage")
.WithName("PutMeldingenInstellingen");

app.MapGet("/api/admin/mail-instellingen", (MeldingenService meldingen) =>
{
    var m = meldingen.LeesMail();
    return Results.Ok(new
    {
        smtpHost = m?.SmtpHost ?? "",
        smtpPoort = m?.SmtpPoort ?? 587,
        ssl = m?.Ssl ?? true,
        gebruiker = m?.Gebruiker ?? "",
        heeftWachtwoord = !string.IsNullOrWhiteSpace(m?.Wachtwoord),
        afzender = m?.Afzender ?? "",
        ontvangers = m?.Ontvangers ?? "",
        geconfigureerd = !string.IsNullOrWhiteSpace(m?.SmtpHost)
    });
})
.RequireAuthorization("CanManage")
.WithName("GetMailInstellingen");

app.MapPut("/api/admin/mail-instellingen", (MeldingenService meldingen, MailInstellingenRequest request) =>
{
    var bestaand = meldingen.LeesMail();
    meldingen.BewaarMail(new MailInstellingen(
        request.SmtpHost ?? "",
        request.SmtpPoort is > 0 and < 65536 ? request.SmtpPoort.Value : 587,
        request.Ssl ?? true,
        string.IsNullOrWhiteSpace(request.Gebruiker) ? null : request.Gebruiker,
        string.IsNullOrWhiteSpace(request.Wachtwoord) ? bestaand?.Wachtwoord : request.Wachtwoord,
        request.Afzender ?? "",
        request.Ontvangers ?? ""));
    return Results.NoContent();
})
.RequireAuthorization("CanManage")
.WithName("PutMailInstellingen");

app.MapPost("/api/admin/mail-instellingen/test", async (MeldingenService meldingen, CancellationToken ct) =>
{
    try
    {
        await meldingen.TestMailAsync(ct);
        return Results.Ok(new { melding = "Testmail verstuurd." });
    }
    catch (Exception ex) when (ex is not OperationCanceledException)
    {
        return Results.Json(new ApiError("mail-fout", ex.Message), statusCode: StatusCodes.Status502BadGateway);
    }
})
.RequireAuthorization("CanManage")
.WithName("TestMail");

app.MapPost("/api/admin/meldingen-instellingen/test", async (MeldingenService meldingen, CancellationToken ct) =>
{
    try
    {
        await meldingen.TestAsync(ct);
        return Results.Ok(new { melding = "Testmelding verstuurd." });
    }
    catch (Exception ex) when (ex is not OperationCanceledException)
    {
        return Results.Json(new ApiError("webhook-fout", ex.Message), statusCode: StatusCodes.Status502BadGateway);
    }
})
.RequireAuthorization("CanManage")
.WithName("TestMeldingen");

// Business Central-koppeling: instellingen (rol beheren) + RMA/order-lookup (rol kijken).
app.MapGet("/api/admin/bc-instellingen", (BcService bc) =>
{
    var s = bc.Lees();
    return Results.Ok(new
    {
        tenantId = s?.TenantId ?? "",
        environment = s?.Environment ?? "production",
        companyId = s?.CompanyId ?? "",
        clientId = s?.ClientId ?? "",
        heeftSecret = !string.IsNullOrWhiteSpace(s?.ClientSecret),
        extraEntiteit = s?.ExtraEntiteit ?? "",
        geconfigureerd = bc.IsGeconfigureerd
    });
})
.RequireAuthorization("CanManage")
.WithName("GetBcInstellingen");

app.MapPut("/api/admin/bc-instellingen", (BcService bc, BcInstellingenRequest request) =>
{
    var bestaand = bc.Lees();
    bc.Bewaar(new BcInstellingen(
        request.TenantId ?? "",
        string.IsNullOrWhiteSpace(request.Environment) ? "production" : request.Environment,
        request.CompanyId ?? "",
        request.ClientId ?? "",
        string.IsNullOrWhiteSpace(request.ClientSecret) ? bestaand?.ClientSecret ?? "" : request.ClientSecret,
        string.IsNullOrWhiteSpace(request.ExtraEntiteit) ? null : request.ExtraEntiteit));
    return Results.NoContent();
})
.RequireAuthorization("CanManage")
.WithName("PutBcInstellingen");

app.MapGet("/api/bc/zoek/{nummer}", async (BcService bc, string nummer, CancellationToken ct) =>
{
    if (!bc.IsGeconfigureerd)
    {
        return Results.Json(
            new ApiError("bc-niet-geconfigureerd", "Business Central is nog niet gekoppeld. Een beheerder kan dit instellen via Beheer → Business Central."),
            statusCode: StatusCodes.Status503ServiceUnavailable);
    }

    try
    {
        return Results.Ok(await bc.ZoekAsync(nummer, ct));
    }
    catch (Exception ex) when (ex is not OperationCanceledException)
    {
        return Results.Json(new ApiError("bc-fout", ex.Message), statusCode: StatusCodes.Status502BadGateway);
    }
})
.RequireAuthorization("CanView")
.WithName("BcZoek");

// Back-upbeheer (rol beheren, alleen storage=local): lijst, nu back-uppen, downloaden.
app.MapGet("/api/admin/backups", async (BackupBeheerService backups, CancellationToken ct) =>
    Results.Ok(await backups.LijstAsync(ct)))
.RequireAuthorization("CanManage")
.WithName("ListBackups");

app.MapPost("/api/admin/backups", async (BackupBeheerService backups, CancellationToken ct) =>
{
    var retention = Math.Max(1, backups.LeesInstellingen().Retentie);
    try
    {
        var pad = await backups.MaakBackupAsync(retention, ct);
        return Results.Ok(new { naam = Path.GetFileName(pad), waarschuwing = (string?)null });
    }
    catch (BackupBeheerService.BackupKopieWaarschuwing w)
    {
        return Results.Ok(new { naam = Path.GetFileName(w.Pad), waarschuwing = (string?)w.Message });
    }
})
.RequireAuthorization("CanManage")
.WithName("CreateBackup");

app.MapGet("/api/admin/backup-instellingen", (BackupBeheerService backups) =>
    Results.Ok(backups.LeesInstellingen()))
.RequireAuthorization("CanManage")
.WithName("GetBackupInstellingen");

app.MapPut("/api/admin/backup-instellingen", (BackupBeheerService backups, BackupInstellingen request) =>
{
    backups.BewaarInstellingen(new BackupInstellingen(
        Math.Clamp(request.IntervalUren, 0.25, 720),
        Math.Clamp(request.Retentie, 1, 365),
        string.IsNullOrWhiteSpace(request.ExtraDoelmap) ? null : request.ExtraDoelmap.Trim()));
    return Results.NoContent();
})
.RequireAuthorization("CanManage")
.WithName("PutBackupInstellingen");

app.MapGet("/api/admin/backups/{naam}", async (BackupBeheerService backups, string naam, CancellationToken ct) =>
{
    var pad = await backups.BestandAsync(naam, ct);
    return pad is null
        ? Results.NotFound(new ApiError("niet-gevonden", "Back-up niet gevonden."))
        : Results.File(pad, "application/octet-stream", naam);
})
.RequireAuthorization("CanManage")
.WithName("DownloadBackup");

// AD/Entra-instellingen (rol beheren): opgeslagen naast de database; worden
// bij de volgende start van de service actief (auth-pipeline is opstart-config).
app.MapGet("/api/admin/entra-instellingen", (RuntimeConfig cfg, IWebHostEnvironment env) =>
{
    var pad = Path.Combine(env.ContentRootPath, "App_Data", "entra-instellingen.json");
    return Results.Ok(new
    {
        actieveAuthMode = cfg.AuthMode,
        tenantId = cfg.Entra.TenantId ?? "",
        clientId = cfg.Entra.ClientId ?? "",
        groupRoleMappings = cfg.Entra.GroupRoleMappings,
        wachtOpHerstart = File.Exists(pad)
    });
})
.RequireAuthorization("CanManage")
.WithName("GetEntraInstellingen");

app.MapPut("/api/admin/entra-instellingen", (EntraInstellingenRequest request, IWebHostEnvironment env) =>
{
    var map = Path.Combine(env.ContentRootPath, "App_Data");
    Directory.CreateDirectory(map);
    File.WriteAllText(
        Path.Combine(map, "entra-instellingen.json"),
        JsonSerializer.Serialize(request, new JsonSerializerOptions { WriteIndented = true }));
    return Results.Ok(new { melding = "Opgeslagen. Herstart de service om de AD/Entra-koppeling te activeren." });
})
.RequireAuthorization("CanManage")
.WithName("PutEntraInstellingen");

// AI-instellingen (rol beheren). Dit contract bevat uitsluitend metadata;
// providercredentials worden nooit teruggegeven.
app.MapGet("/api/admin/ai-instellingen", (
    AiService ai,
    AiSettingsService settings,
    ChatGptOAuthService chatgpt) =>
    Results.Ok(CreateAiSettingsResponse(ai, settings, chatgpt)))
.RequireAuthorization("CanManage")
.WithName("GetAiInstellingen");

app.MapPut("/api/admin/ai-instellingen", async (
    AiSettingsService settings,
    AiService ai,
    ChatGptOAuthService chatgpt,
    AuditLogService audit,
    CurrentUserService currentUser,
    ClaimsPrincipal principal,
    AiInstellingenRequest request,
    CancellationToken cancellationToken) =>
{
    try
    {
        var current = settings.LeesOfStandaard();
        var mode = AiSettingsService.ResolveRequestedMode(
            request.Mode,
            !string.IsNullOrWhiteSpace(request.ApiKey),
            current.Mode);
        var updated = new AiInstellingen(
            string.IsNullOrWhiteSpace(request.Provider) ? current.Provider : request.Provider,
            request.Endpoint is null ? current.Endpoint : request.Endpoint,
            request.Model is null ? current.Model : request.Model,
            mode);
        if (updated.Mode.Equals(AiSettingsService.ManagedMode, StringComparison.OrdinalIgnoreCase))
        {
            var managed = settings.GetManagedAiCapability();
            if (!managed.Available || managed.Profile is null)
            {
                throw new AiConfigurationException(managed.ReasonCode, managed.NextStep);
            }

            // Provider/model/endpoint van Managed AI zijn platformbeleid en
            // worden niet door een tenantformulier overschreven.
            updated = managed.Profile;
        }
        AiSettingsService.Validate(updated);
        if (!string.IsNullOrWhiteSpace(request.ApiKey))
        {
            // Settings + tenantsecret vormen voor runtimelezers één
            // gelockte snapshot; er is geen tussenvenster met een nieuwe
            // provider en een oude credential (of andersom).
            settings.SaveWithCredential(updated, request.ApiKey);
        }
        else
        {
            settings.Bewaar(updated);
        }

        var actor = currentUser.FromPrincipal(principal);
        await audit.WriteAsync(
            "ai.settings.update",
            "ai-settings",
            "single-tenant",
            actor,
            new
            {
                provider = updated.Provider,
                mode,
                model = updated.Model,
                credentialRotated = !string.IsNullOrWhiteSpace(request.ApiKey)
            },
            cancellationToken);
        return Results.Ok(CreateAiSettingsResponse(ai, settings, chatgpt));
    }
    catch (AiConfigurationException ex)
    {
        return Results.BadRequest(new ApiError(ex.Code, ex.Message));
    }
})
.RequireAuthorization("CanManage")
.WithName("PutAiInstellingen");

app.MapPost("/api/admin/ai-instellingen/credential/rotate", async (
    AiSettingsService settings,
    AiService ai,
    ChatGptOAuthService chatgpt,
    AuditLogService audit,
    CurrentUserService currentUser,
    ClaimsPrincipal principal,
    AiCredentialRotateRequest request,
    CancellationToken cancellationToken) =>
{
    try
    {
        var metadata = settings.RotateCredential(request.Secret ?? "");
        var actor = currentUser.FromPrincipal(principal);
        await audit.WriteAsync(
            "ai.credential.rotate",
            "ai-credential",
            "single-tenant",
            actor,
            new { metadata.Fingerprint, metadata.UpdatedAt },
            cancellationToken);
        return Results.Ok(CreateAiSettingsResponse(ai, settings, chatgpt));
    }
    catch (AiConfigurationException ex)
    {
        return Results.BadRequest(new ApiError(ex.Code, ex.Message));
    }
})
.RequireAuthorization("CanManage")
.WithName("RotateAiCredential");

app.MapPost("/api/admin/ai-instellingen/credential/revoke", async (
    AiSettingsService settings,
    AuditLogService audit,
    CurrentUserService currentUser,
    ClaimsPrincipal principal,
    CancellationToken cancellationToken) =>
{
    try
    {
        settings.RevokeCredential();
        var actor = currentUser.FromPrincipal(principal);
        await audit.WriteAsync(
            "ai.credential.revoke",
            "ai-credential",
            "single-tenant",
            actor,
            cancellationToken: cancellationToken);
        return Results.NoContent();
    }
    catch (AiConfigurationException ex)
    {
        return Results.BadRequest(new ApiError(ex.Code, ex.Message));
    }
})
.RequireAuthorization("CanManage")
.WithName("RevokeAiCredential");

// Compatibele alias; dezelfde fail-closed revoke-semantiek.
app.MapPost("/api/admin/ai-instellingen/credential/clear", async (
    AiSettingsService settings,
    AuditLogService audit,
    CurrentUserService currentUser,
    ClaimsPrincipal principal,
    CancellationToken cancellationToken) =>
{
    try
    {
        settings.RevokeCredential();
        var actor = currentUser.FromPrincipal(principal);
        await audit.WriteAsync(
            "ai.credential.revoke",
            "ai-credential",
            "single-tenant",
            actor,
            new { alias = "clear" },
            cancellationToken);
        return Results.NoContent();
    }
    catch (AiConfigurationException ex)
    {
        return Results.BadRequest(new ApiError(ex.Code, ex.Message));
    }
})
.RequireAuthorization("CanManage")
.WithName("ClearAiCredential");

app.MapPost("/api/admin/ai-instellingen/test", async (
    AiService ai,
    AuditLogService audit,
    CurrentUserService currentUser,
    ClaimsPrincipal principal,
    CancellationToken cancellationToken) =>
{
    var actor = currentUser.FromPrincipal(principal);
    var status = ai.LeesEffectieveInstellingen();
    try
    {
        await ai.TestConnectionAsync(cancellationToken);
        var testedAt = DateTimeOffset.UtcNow;
        await audit.WriteAsync(
            "ai.connection.test",
            "ai-settings",
            "single-tenant",
            actor,
            new { ok = true, status.Provider, status.Mode, status.Model },
            cancellationToken);
        return Results.Ok(new
        {
            ok = true,
            provider = status.Provider,
            model = status.Model,
            testedAt
        });
    }
    catch (AiConfigurationException ex)
    {
        await audit.WriteAsync(
            "ai.connection.test",
            "ai-settings",
            "single-tenant",
            actor,
            new { ok = false, status.Provider, status.Mode, errorCode = ex.Code },
            cancellationToken);
        return Results.Conflict(new ApiError(ex.Code, ex.Message));
    }
    catch (AiProviderException ex)
    {
        await audit.WriteAsync(
            "ai.connection.test",
            "ai-settings",
            "single-tenant",
            actor,
            new { ok = false, provider = ex.Provider, status.Mode, errorCode = "ai-provider-unavailable" },
            cancellationToken);
        return Results.Json(
            new ApiError("ai-provider-unavailable", "De AI-provider wees de connectietest af of was niet bereikbaar."),
            statusCode: StatusCodes.Status502BadGateway);
    }
    catch (Exception ex) when (ex is not OperationCanceledException)
    {
        app.Logger.LogError(
            "Onverwachte fout tijdens AI-connectietest. ErrorType={ErrorType}",
            ex.GetType().Name);
        await audit.WriteAsync(
            "ai.connection.test",
            "ai-settings",
            "single-tenant",
            actor,
            new { ok = false, status.Provider, status.Mode, errorCode = "ai-test-failed" },
            cancellationToken);
        return Results.Json(
            new ApiError("ai-test-failed", "De connectietest kon niet veilig worden uitgevoerd."),
            statusCode: StatusCodes.Status502BadGateway);
    }
})
.RequireAuthorization("CanManage")
.WithName("TestAiConnection");

// Audit-log-inzage voor beheerders: wie wijzigde wat, wanneer (ISO 27001 A.8.15).
app.MapGet("/api/audit", async (AppDbContext db, int? limit) =>
{
    var max = Math.Clamp(limit ?? 200, 1, 1000);
    // Sorteer op Id (auto-increment): zelfde volgorde als CreatedAtUtc en
    // wél door SQLite ondersteund (DateTimeOffset niet in ORDER BY).
    var entries = await db.AuditLogs.AsNoTracking()
        .OrderByDescending(e => e.Id)
        .Take(max)
        .ToListAsync();

    return Results.Ok(entries.Select(e => new
    {
        id = e.Id,
        actie = e.Action,
        entiteitType = e.EntityType,
        entiteitId = e.EntityId,
        doorGebruiker = e.ActorName,
        op = e.CreatedAtUtc,
        details = e.DetailsJson
    }));
})
.RequireAuthorization("CanManage")
.WithName("ListAuditLog");

// AI-assistent: vraag over de processen (zoeken/verbeteren/structureren).
app.MapPost("/api/ai/vraag", async (AiService ai, AiVraagRequest request, CancellationToken ct) =>
{
    if (!ai.IsGeconfigureerd)
    {
        return Results.Json(
            new ApiError("ai-niet-geconfigureerd",
                "De AI-assistent is niet actief. Een beheerder moet expliciet provider, model en mode managed of byo activeren."),
            statusCode: StatusCodes.Status503ServiceUnavailable);
    }

    if (string.IsNullOrWhiteSpace(request.Vraag))
    {
        return Results.BadRequest(new ApiError("lege-vraag", "Stel een vraag."));
    }

    try
    {
        if (request.Vraag.Length > 100_000 || request.Geschiedenis is { Count: > 20 } ||
            (request.Geschiedenis?.Any(b => b is null || b.Rol is not ("gebruiker" or "ai") || string.IsNullOrWhiteSpace(b.Tekst)) ?? false) ||
            (request.Geschiedenis?.Sum(b => (long)b.Tekst.Length) ?? 0) > 100_000)
            return Results.BadRequest(new ApiError("ongeldig-gesprek", "Het gesprek is te lang of ongeldig. Begin een nieuw gesprek."));
        var antwoord = await ai.VraagAsync(request.Vraag.Trim(), ct, request.Geschiedenis);
        return Results.Ok(new { antwoord });
    }
    catch (AiConfigurationException ex)
    {
        return Results.Json(new ApiError(ex.Code, ex.Message), statusCode: StatusCodes.Status503ServiceUnavailable);
    }
    catch (AiProviderException)
    {
        return Results.Json(
            new ApiError("ai-provider-unavailable", "De AI-provider wees de aanvraag af of was niet bereikbaar."),
            statusCode: StatusCodes.Status502BadGateway);
    }
    catch (Exception ex) when (ex is not OperationCanceledException)
    {
        app.Logger.LogError(
            "Onverwachte AI-fout. ErrorType={ErrorType}",
            ex.GetType().Name);
        return Results.Json(
            new ApiError("ai-fout", "De AI-aanvraag kon niet veilig worden verwerkt."),
            statusCode: StatusCodes.Status502BadGateway);
    }
})
.RequireAuthorization("CanView")
.WithName("AiVraag");

// AI Process Steward: analyseert uitsluitend de gepinde werkversie van één proces.
// De response bevat alleen vragen, stapmarkeringen en whitelisted tekstwijzigingen
// als concept; deze route muteert of publiceert nooit een proces.
app.MapPost("/api/processes/{id}/ai/maintenance-analysis", async (
    string id,
    ProcessMaintenanceAnalysisRequest request,
    ProcessMaintenanceService maintenance,
    CurrentUserService currentUser,
    ClaimsPrincipal principal,
    CancellationToken cancellationToken) =>
{
    var actor = currentUser.FromPrincipal(principal);
    var runId = Guid.NewGuid().ToString("N");

    try
    {
        var result = await maintenance.AnalyseerAsync(
            runId,
            actor,
            id,
            request,
            cancellationToken);
        return Results.Ok(result.Analysis);
    }
    catch (ProcessMaintenanceException ex)
    {
        return Results.Json(
            new ApiError(ex.Code, ex.Message),
            statusCode: ex.StatusCode);
    }
    catch (AiConfigurationException ex)
    {
        return Results.Json(
            new ApiError(ex.Code, ex.Message),
            statusCode: StatusCodes.Status503ServiceUnavailable);
    }
    catch (AiProviderException)
    {
        return Results.Json(
            new ApiError(
                "ai-provider-unavailable",
                "De AI-provider wees de onderhoudsanalyse af of was niet bereikbaar."),
            statusCode: StatusCodes.Status502BadGateway);
    }
    catch (AiRunLedgerException ex)
    {
        return Results.Json(
            new ApiError(ex.Code, ex.Message),
            statusCode: ex.StatusCode);
    }
    catch (Exception ex) when (ex is not OperationCanceledException)
    {
        app.Logger.LogError(
            ex,
            "Onverwachte fout in AI-procesonderhoud. RunId={RunId} ProcessId={ProcessId}",
            runId,
            id);
        return Results.Json(
            new ApiError(
                "ai-maintenance-unexpected",
                "De onderhoudsanalyse kon niet veilig worden afgerond."),
            statusCode: StatusCodes.Status502BadGateway);
    }
})
.RequireAuthorization("CanEdit")
.WithName("AnalyzeProcessMaintenance");

app.MapGet("/api/processes/{id}/ai/runs", async (
    string id,
    int? limit,
    AiRunLedgerService ledger,
    CancellationToken cancellationToken) =>
{
    try
    {
        return Results.Ok(await ledger.ListAsync(id, limit, cancellationToken));
    }
    catch (AiRunLedgerException ex)
    {
        return Results.Json(
            new ApiError(ex.Code, ex.Message),
            statusCode: ex.StatusCode);
    }
    catch (Exception ex) when (ex is not OperationCanceledException)
    {
        app.Logger.LogError(
            ex,
            "AI-runhistorie kon niet worden gelezen. ProcessId={ProcessId}",
            id);
        return Results.Json(
            new ApiError(
                "ai-run-storage-unavailable",
                "De AI-runhistorie is tijdelijk niet beschikbaar."),
            statusCode: StatusCodes.Status503ServiceUnavailable);
    }
})
.RequireAuthorization("CanReview")
.WithName("ListProcessAiRuns");

app.MapPost("/api/processes/{id}/ai/runs/{runId}/feedback", async (
    string id,
    string runId,
    AiRunFeedbackRequest request,
    AppDbContext db,
    AiRunLedgerService ledger,
    AuditLogService audit,
    CurrentUserService currentUser,
    ClaimsPrincipal principal,
    CancellationToken cancellationToken) =>
{
    var actor = currentUser.FromPrincipal(principal);
    try
    {
        // De feedbackmutatie en haar auditregel vormen één atomaire grens.
        // Bij een auditfout wordt de feedback dus niet stil zonder audit bewaard.
        await using var transaction =
            await db.Database.BeginTransactionAsync(cancellationToken);
        var write = await ledger.RecordFeedbackAsync(
            id,
            runId,
            request,
            actor,
            cancellationToken);
        if (write.Created)
        {
            await audit.WriteAsync(
                "ai.process-maintenance.feedback",
                "ai-run",
                runId,
                actor,
                new
                {
                    processId = id,
                    write.Run.ProcessRevision,
                    beslissing = write.Run.Feedback?.Beslissing,
                    acceptedChangeCount =
                        write.Run.Feedback?.GeaccepteerdeWijzigingIds.Count ?? 0,
                    hasReason = !string.IsNullOrWhiteSpace(write.Run.Feedback?.Reden)
                },
                cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
        return Results.Ok(write.Run);
    }
    catch (AiRunLedgerException ex)
    {
        return Results.Json(
            new ApiError(ex.Code, ex.Message),
            statusCode: ex.StatusCode);
    }
    catch (Exception ex) when (ex is not OperationCanceledException)
    {
        app.Logger.LogError(
            ex,
            "AI-runfeedback kon niet veilig worden vastgelegd. RunId={RunId} ProcessId={ProcessId}",
            runId,
            id);
        return Results.Json(
            new ApiError(
                "ai-run-storage-unavailable",
                "De AI-runfeedback kon tijdelijk niet veilig worden vastgelegd."),
            statusCode: StatusCodes.Status503ServiceUnavailable);
    }
})
.RequireAuthorization("CanEdit")
.WithName("RecordProcessAiRunFeedback");

var suggestionRoutes = app.MapGroup("/api/suggestions");

suggestionRoutes.MapGet("/", async (AppDbContext db, string? status) =>
{
    var query = db.Suggestions.AsNoTracking();

    if (!string.IsNullOrWhiteSpace(status))
    {
        query = query.Where(suggestion => suggestion.Status == status);
    }

    var suggestions = (await query.ToListAsync())
        .OrderByDescending(suggestion => suggestion.CreatedAtUtc)
        .ToList();

    return Results.Ok(suggestions.Select(ToSuggestionDocument).ToList());
})
.RequireAuthorization("CanEdit")
.WithName("ListSuggestions");

suggestionRoutes.MapPost("/{id}/resolve", async (
    AppDbContext db,
    AuditLogService audit,
    CurrentUserService currentUser,
    ClaimsPrincipal principal,
    string id,
    SuggestionResolveRequest request) =>
{
    if (!IsValidSuggestionStatus(request.Status))
    {
        return Results.BadRequest(new ApiError("suggestion-status-invalid", "Status moet open, in-behandeling, verwerkt of afgewezen zijn."));
    }

    var suggestion = await db.Suggestions.FirstOrDefaultAsync(existing => existing.Id == id);
    if (suggestion is null)
    {
        return Results.NotFound(new ApiError("suggestion-not-found", $"Suggestie '{id}' is niet gevonden."));
    }

    var actor = currentUser.FromPrincipal(principal);
    suggestion.Status = request.Status;
    suggestion.ResolvedBy = actor.Naam;
    suggestion.ResolvedAtUtc = DateTimeOffset.UtcNow;
    await db.SaveChangesAsync();

    await audit.WriteAsync("suggestion.resolve", "suggestion", suggestion.Id, actor, new { suggestion.Status });

    return Results.Ok(ToSuggestionDocument(suggestion));
})
.RequireAuthorization("CanEdit")
.WithName("ResolveSuggestion");

app.MapGet("/api/admin/assurance-settings", async (
    AssuranceSettingsService assuranceSettings,
    CancellationToken cancellationToken) =>
{
    try
    {
        return Results.Ok(await assuranceSettings.GetAsync(cancellationToken));
    }
    catch (AssuranceException ex)
    {
        return Results.Json(
            new ApiError(ex.Code, ex.Message),
            statusCode: ex.StatusCode);
    }
})
.RequireAuthorization("CanManage")
.WithName("GetAssuranceSettings");

app.MapPut("/api/admin/assurance-settings", async (
    AssuranceSettingsUpdateRequest request,
    AssuranceSettingsService assuranceSettings,
    CurrentUserService currentUser,
    ClaimsPrincipal principal,
    CancellationToken cancellationToken) =>
{
    try
    {
        var actor = currentUser.FromPrincipal(principal);
        return Results.Ok(await assuranceSettings.SaveAsync(
            request,
            actor,
            cancellationToken));
    }
    catch (AssuranceException ex)
    {
        return Results.Json(
            new ApiError(ex.Code, ex.Message),
            statusCode: ex.StatusCode);
    }
})
.RequireAuthorization("CanManage")
.WithName("UpdateAssuranceSettings");

var assuranceRoutes = app.MapGroup("/api/assurance");

app.MapAssuranceFrameworkDraftEndpoints();

assuranceRoutes.MapGet("/frameworks", async (
    AssuranceFrameworkCatalogService catalog,
    AssuranceSettingsService assuranceSettings,
    CancellationToken cancellationToken) =>
{
    try
    {
        var active = await assuranceSettings.GetActiveFrameworkIdsAsync(
            cancellationToken);
        return Results.Ok(catalog.CreateCatalog(active));
    }
    catch (AssuranceException ex)
    {
        return Results.Json(
            new ApiError(ex.Code, ex.Message),
            statusCode: ex.StatusCode);
    }
})
.RequireAuthorization("CanView")
.WithName("GetAssuranceFrameworks");

assuranceRoutes.MapPost("/questionnaires", async (
    AssuranceQuestionnaireStartRequest request,
    AssuranceQuestionnaireService questionnaireService,
    CurrentUserService currentUser,
    ClaimsPrincipal principal,
    CancellationToken cancellationToken) =>
{
    try
    {
        var actor = currentUser.FromPrincipal(principal);
        var result = await questionnaireService.StartAsync(
            request.KaderId,
            actor,
            cancellationToken);
        return Results.Created(
            $"/api/assurance/questionnaires/{result.SessionId}",
            result);
    }
    catch (AssuranceException ex)
    {
        return Results.Json(
            new ApiError(ex.Code, ex.Message),
            statusCode: ex.StatusCode);
    }
})
.RequireAuthorization("CanReview")
.WithName("StartAssuranceQuestionnaire");

assuranceRoutes.MapGet("/questionnaires", async (
    string? frameworkId,
    int? limit,
    AssuranceQuestionnaireService questionnaireService,
    CancellationToken cancellationToken) =>
{
    try
    {
        return Results.Ok(await questionnaireService.ListAsync(
            frameworkId,
            limit,
            cancellationToken));
    }
    catch (AssuranceException ex)
    {
        return Results.Json(
            new ApiError(ex.Code, ex.Message),
            statusCode: ex.StatusCode);
    }
})
.RequireAuthorization("CanReview")
.WithName("ListAssuranceQuestionnaires");

assuranceRoutes.MapGet("/questionnaires/{sessionId}", async (
    string sessionId,
    AssuranceQuestionnaireService questionnaireService,
    CancellationToken cancellationToken) =>
{
    try
    {
        return Results.Ok(await questionnaireService.GetAsync(
            sessionId,
            cancellationToken));
    }
    catch (AssuranceException ex)
    {
        return Results.Json(
            new ApiError(ex.Code, ex.Message),
            statusCode: ex.StatusCode);
    }
})
.RequireAuthorization("CanReview")
.WithName("GetAssuranceQuestionnaire");

assuranceRoutes.MapPost("/questionnaires/{sessionId}/answers", async (
    string sessionId,
    AssuranceQuestionnaireAnswerRequest request,
    AssuranceQuestionnaireService questionnaireService,
    CurrentUserService currentUser,
    ClaimsPrincipal principal,
    CancellationToken cancellationToken) =>
{
    try
    {
        var actor = currentUser.FromPrincipal(principal);
        return Results.Ok(await questionnaireService.AnswerAsync(
            sessionId,
            request,
            actor,
            cancellationToken));
    }
    catch (AssuranceException ex)
    {
        return Results.Json(
            new ApiError(ex.Code, ex.Message),
            statusCode: ex.StatusCode);
    }
})
.RequireAuthorization("CanReview")
.WithName("AnswerAssuranceQuestionnaire");

assuranceRoutes.MapGet("/monitoring/status", async (
    AssuranceRunService runService,
    CancellationToken cancellationToken) =>
{
    try
    {
        return Results.Ok(await runService.GetMonitoringStatusAsync(
            cancellationToken));
    }
    catch (AssuranceException ex)
    {
        return Results.Json(
            new ApiError(ex.Code, ex.Message),
            statusCode: ex.StatusCode);
    }
})
.RequireAuthorization("CanView")
.WithName("GetAssuranceMonitoringStatus");

assuranceRoutes.MapPost("/runs", async (
    AssuranceRunService runService,
    CurrentUserService currentUser,
    ClaimsPrincipal principal,
    CancellationToken cancellationToken) =>
{
    try
    {
        var actor = currentUser.FromPrincipal(principal);
        return Results.Ok(await runService.RunManualAsync(
            actor,
            cancellationToken));
    }
    catch (AssuranceException ex)
    {
        return Results.Json(
            new ApiError(ex.Code, ex.Message),
            statusCode: ex.StatusCode);
    }
    catch (Exception ex) when (ex is not OperationCanceledException)
    {
        app.Logger.LogError(
            ex,
            "Handmatige assurancecontrole is onverwacht mislukt.");
        return Results.Json(
            new ApiError(
                "assurance-run-failed",
                "De assurancecontrole kon niet veilig worden afgerond."),
            statusCode: StatusCodes.Status503ServiceUnavailable);
    }
})
.RequireAuthorization("CanReview")
.WithName("StartAssuranceRun");

assuranceRoutes.MapGet("/runs", async (
    int? limit,
    AssuranceRunService runService,
    CancellationToken cancellationToken) =>
{
    try
    {
        return Results.Ok(await runService.ListAsync(
            limit,
            cancellationToken));
    }
    catch (AssuranceException ex)
    {
        return Results.Json(
            new ApiError(ex.Code, ex.Message),
            statusCode: ex.StatusCode);
    }
})
.RequireAuthorization("CanReview")
.WithName("ListAssuranceRuns");

assuranceRoutes.MapGet("/runs/{runId}", async (
    string runId,
    AssuranceRunService runService,
    CancellationToken cancellationToken) =>
{
    try
    {
        return Results.Ok(await runService.GetAsync(
            runId,
            cancellationToken));
    }
    catch (AssuranceException ex)
    {
        return Results.Json(
            new ApiError(ex.Code, ex.Message),
            statusCode: ex.StatusCode);
    }
})
.RequireAuthorization("CanReview")
.WithName("GetAssuranceRun");

var isoRoutes = app.MapGroup("/api/iso")
    .RequireAuthorization("CanView");

isoRoutes.MapGet("/overview", async (IsoService iso, string? norm) =>
{
    if (!string.IsNullOrWhiteSpace(norm) && !IsoService.IsValidNorm(norm))
    {
        return Results.BadRequest(new ApiError("iso-norm-invalid", "Norm moet iso27001, iso9001 of iso14001 zijn."));
    }

    return Results.Ok(await iso.CreateOverviewAsync(norm));
})
.WithName("GetIsoOverview");

isoRoutes.MapGet("/export", async (IsoService iso, string? norm, string? format) =>
{
    if (!string.IsNullOrWhiteSpace(norm) && !IsoService.IsValidNorm(norm))
    {
        return Results.BadRequest(new ApiError("iso-norm-invalid", "Norm moet iso27001, iso9001 of iso14001 zijn."));
    }

    var normalizedFormat = string.IsNullOrWhiteSpace(format) ? "csv" : format.Trim().ToLowerInvariant();
    var overview = await iso.CreateOverviewAsync(norm);

    return normalizedFormat switch
    {
        "json" => Results.Ok(overview),
        "csv" => Results.Text(iso.CreateCsv(overview), "text/csv; charset=utf-8"),
        _ => Results.BadRequest(new ApiError("iso-export-format-invalid", "Format moet csv of json zijn."))
    };
})
.WithName("ExportIsoOverview");

var importRoutes = app.MapGroup("/api/import");

importRoutes.MapPost("/pdf", async (
    HttpContext httpContext,
    PdfImportService importer,
    AuditLogService audit,
    CurrentUserService currentUser,
    ClaimsPrincipal principal) =>
{
    if (!httpContext.Request.HasFormContentType)
    {
        return Results.BadRequest(new ApiError("import-invalid-content-type", "Upload de PDF als multipart/form-data met veld 'bestand'."));
    }

    var form = await httpContext.Request.ReadFormAsync(httpContext.RequestAborted);
    var file = form.Files.GetFile("bestand") ?? form.Files.FirstOrDefault();
    if (file is null || file.Length == 0)
    {
        return Results.BadRequest(new ApiError("import-file-missing", "PDF-bestand ontbreekt."));
    }

    if (!Path.GetExtension(file.FileName).Equals(".pdf", StringComparison.OrdinalIgnoreCase))
    {
        return Results.BadRequest(new ApiError("import-file-not-pdf", "Alleen PDF-bestanden worden in deze importstap ondersteund."));
    }

    var actor = currentUser.FromPrincipal(principal);
    var job = await importer.StartAsync(file, httpContext.RequestAborted);
    await audit.WriteAsync("import.pdf", "import-job", job.Id, actor, new { job.Bestandsnaam, job.Status });

    return Results.Accepted($"/api/import/{job.Id}", job);
})
.RequireAuthorization("CanEdit")
.WithName("StartPdfImport");

importRoutes.MapGet("/{jobId}", async (PdfImportService importer, string jobId) =>
{
    var job = await importer.GetJobAsync(jobId);
    return job is null
        ? Results.NotFound(new ApiError("import-job-not-found", $"Import-job '{jobId}' is niet gevonden."))
        : Results.Ok(job);
})
.RequireAuthorization("CanView")
.WithName("GetImportJob");

importRoutes.MapPost("/{jobId}/commit", async (
    AppDbContext db,
    ProcessVersionService versions,
    AuditLogService audit,
    CurrentUserService currentUser,
    ClaimsPrincipal principal,
    string jobId,
    ProcessDocument process) =>
{
    var job = await db.ImportJobs.AsNoTracking().FirstOrDefaultAsync(existing => existing.Id == jobId);
    if (job is null)
    {
        return Results.NotFound(new ApiError("import-job-not-found", $"Import-job '{jobId}' is niet gevonden."));
    }

    if (!job.Status.Equals("gereed", StringComparison.OrdinalIgnoreCase))
    {
        return Results.Conflict(new ApiError("import-job-not-ready", "Alleen een gereed importresultaat kan worden vastgelegd."));
    }

    if (await db.Processes.AnyAsync(existing => existing.Id == process.Id))
    {
        return Results.Conflict(new ApiError("process-exists", $"Proces '{process.Id}' bestaat al."));
    }

    var document = process with
    {
        Status = "concept",
        Revision = 1,
        LaatsteWijziging = NormalizeDate(process.LaatsteWijziging),
        Bron = process.Bron ?? new ProcessSource(
            "pdf-import",
            job.FileName,
            null,
            Today(),
            null)
    };

    var entity = ProcessMapper.ToEntity(document, 1);
    await using var transaction = await db.Database.BeginTransactionAsync();
    db.Processes.Add(entity);
    await db.SaveChangesAsync();

    var actor = currentUser.FromPrincipal(principal);
    await versions.CreateSnapshotAsync(entity, actor.Naam, $"Import-job {jobId} vastgelegd", null);
    await audit.WriteAsync("import.commit", "process", entity.Id, actor, new { jobId, job.SourceFileId });
    await transaction.CommitAsync();

    return Results.Created($"/api/processes/{entity.Id}", ProcessMapper.ToDocument(entity));
})
.RequireAuthorization("CanEdit")
.WithName("CommitImportJob");

var diagramRoutes = app.MapGroup("/api/diagrams");

diagramRoutes.MapPost("/lucid/export", (
    DiagramPackageService exchange,
    ProcessDocument process) =>
{
    var result = exchange.ExportLucidStandard(process);
    return result.Ok && result.Content is not null
        ? Results.File(result.Content, result.MediaType, result.FileName)
        : Results.BadRequest(result);
})
.RequireAuthorization("CanView")
.WithName("ExportLucidStandard");

diagramRoutes.MapPost("/lucid/import", async (
    HttpContext httpContext,
    DiagramPackageService exchange) =>
{
    var upload = await ReadDiagramUploadAsync(httpContext, [".lucid"]);
    if (upload.Error is not null)
    {
        return upload.Error;
    }

    var result = exchange.ImportLucidStandard(upload.Content);
    return Results.Ok(result);
})
.RequireAuthorization("CanEdit")
.WithName("ImportLucidStandard");

diagramRoutes.MapPost("/visio/import", async (
    HttpContext httpContext,
    DiagramPackageService exchange) =>
{
    var upload = await ReadDiagramUploadAsync(httpContext, [".vsdx"]);
    if (upload.Error is not null)
    {
        return upload.Error;
    }

    var result = exchange.ImportVisioVsdx(upload.Content,
        httpContext.Request.Query["pageId"].FirstOrDefault(),
        httpContext.Request.Query["defaultRole"].FirstOrDefault());
    return Results.Ok(result);
})
.RequireAuthorization("CanEdit")
.WithName("ImportVisioVsdx");

diagramRoutes.MapPost("/visio/export", (
    DiagramPackageService exchange,
    ProcessDocument process) =>
{
    var result = exchange.ExportVisioVsdx(process);
    return result.Ok && result.Content is not null
        ? Results.File(result.Content, result.MediaType, result.FileName)
        : Results.BadRequest(result);
})
.RequireAuthorization("CanView")
.WithName("ExportVisioVsdx");

diagramRoutes.MapGet("/visio/export-capability", (DiagramPackageService exchange) =>
    Results.Ok(exchange.GetVisioExportBlocker()))
    .RequireAuthorization("CanView")
    .WithName("GetVisioExportCapability");

app.MapGet("/api/files/{id}", async (AppDbContext db, string id) =>
{
    var file = await db.Files.AsNoTracking().FirstOrDefaultAsync(existing => existing.Id == id);
    return file is null
        ? Results.NotFound(new ApiError("file-not-found", $"Bestand '{id}' is niet gevonden."))
        : Results.File(file.Content, file.ContentType, file.FileName);
})
.RequireAuthorization("CanView")
.WithName("GetFile");

var webRoot = Path.Combine(app.Environment.ContentRootPath, "wwwroot");
if (Directory.Exists(webRoot))
{
    app.UseDefaultFiles(new DefaultFilesOptions
    {
        FileProvider = new PhysicalFileProvider(webRoot)
    });
    app.UseStaticFiles(new StaticFileOptions
    {
        FileProvider = new PhysicalFileProvider(webRoot)
    });
    app.MapFallbackToFile("index.html");
}

app.Run();

static string? FindContractOpenApi(string contentRoot)
{
    var current = new DirectoryInfo(contentRoot);
    while (current is not null)
    {
        var candidate = Path.Combine(current.FullName, "contract", "openapi.yaml");
        if (File.Exists(candidate))
        {
            return candidate;
        }

        current = current.Parent;
    }

    return null;
}

static string GetSqliteConnectionString(IConfiguration configuration, string contentRoot)
{
    var configured = configuration.GetConnectionString("Sqlite");
    var connectionString = string.IsNullOrWhiteSpace(configured)
        ? "Data Source=App_Data/service-procesgids.db"
        : configured;

    const string prefix = "Data Source=";
    if (connectionString.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
    {
        var path = connectionString[prefix.Length..];
        if (!Path.IsPathRooted(path))
        {
            var fullPath = Path.Combine(contentRoot, path);
            Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);
            return $"{prefix}{fullPath}";
        }
    }

    return connectionString;
}

static string NormalizeDate(string value)
{
    return string.IsNullOrWhiteSpace(value)
        ? DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd")
        : value;
}

static object CreateAiSettingsResponse(
    AiService ai,
    AiSettingsService settings,
    ChatGptOAuthService chatgpt)
{
    var status = ai.LeesEffectieveInstellingen();
    var managed = settings.GetManagedAiCapability();
    var tenantCredential = settings.GetTenantCredentialMetadata();
    var tenantCredentialProvider = settings.GetTenantCredentialProvider();
    return new
    {
        provider = status.Provider,
        endpoint = status.Endpoint,
        model = status.Model,
        mode = status.Mode,
        heeftSleutel = status.HeeftSleutel,
        geconfigureerd = status.Geconfigureerd,
        activationState = status.ActivationState,
        credentialSource = status.CredentialSource,
        credentialFingerprint = status.CredentialFingerprint ?? tenantCredential.Fingerprint,
        credentialUpdatedAt = status.CredentialUpdatedAt ?? tenantCredential.UpdatedAt,
        storedTenantCredentialPresent = tenantCredential.Present,
        storedTenantCredentialProvider = tenantCredentialProvider,
        errorCode = status.ErrorCode,
        legacy = status.Legacy,
        productionAllowed = status.ProductionAllowed,
        canTest = status.Geconfigureerd,
        managedAi = new
        {
            available = managed.Available,
            reasonCode = managed.ReasonCode,
            nextStep = managed.NextStep
        },
        localOAuth = new
        {
            available = chatgpt.IsAvailable,
            linked = chatgpt.IsAvailable && chatgpt.IsGekoppeld,
            standaloneOnly = true,
            connectionKind = "local-oauth"
        },
        // Compatibele alias voor clients die het bestaande contract gebruiken.
        legacyOAuth = new
        {
            available = chatgpt.IsAvailable,
            linked = chatgpt.IsAvailable && chatgpt.IsGekoppeld,
            productionAllowed = false
        }
    };
}

static string Today() => DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd");

static async Task<(ReadOnlyMemory<byte> Content, IResult? Error)> ReadDiagramUploadAsync(
    HttpContext httpContext,
    string[] allowedExtensions)
{
    const long maxPackageBytes = 50L * 1024 * 1024;
    if (!httpContext.Request.HasFormContentType)
    {
        return (ReadOnlyMemory<byte>.Empty, Results.BadRequest(
            new ApiError("diagram-invalid-content-type", "Upload het diagrambestand als multipart/form-data met veld 'bestand'.")));
    }

    var form = await httpContext.Request.ReadFormAsync(httpContext.RequestAborted);
    var file = form.Files.GetFile("bestand") ?? form.Files.FirstOrDefault();
    if (file is null || file.Length == 0)
    {
        return (ReadOnlyMemory<byte>.Empty, Results.BadRequest(
            new ApiError("diagram-file-missing", "Diagrambestand ontbreekt.")));
    }

    if (file.Length > maxPackageBytes)
    {
        return (ReadOnlyMemory<byte>.Empty, Results.Json(
            new ApiError("diagram-file-too-large", "Diagrambestand overschrijdt de veilige limiet van 50 MB."),
            statusCode: StatusCodes.Status413PayloadTooLarge));
    }

    var extension = Path.GetExtension(file.FileName);
    if (!allowedExtensions.Contains(extension, StringComparer.OrdinalIgnoreCase))
    {
        return (ReadOnlyMemory<byte>.Empty, Results.BadRequest(
            new ApiError("diagram-extension-invalid", $"Bestandstype '{extension}' wordt voor deze import niet ondersteund.")));
    }

    using var output = new MemoryStream((int)file.Length);
    await file.CopyToAsync(output, httpContext.RequestAborted);
    return (output.ToArray(), null);
}

static bool TryReadIntQuery(HttpContext httpContext, string name, out int value)
{
    value = default;
    var raw = httpContext.Request.Query[name].ToString();
    return !string.IsNullOrWhiteSpace(raw) &&
        int.TryParse(raw, System.Globalization.NumberStyles.Integer, System.Globalization.CultureInfo.InvariantCulture, out value);
}

static bool IsValidSuggestionType(string value)
{
    return value is "klopt-niet" or "mist" or "onduidelijk" or "werkt-anders";
}

static bool IsValidSuggestionStatus(string value)
{
    return value is "open" or "in-behandeling" or "verwerkt" or "afgewezen";
}

static SuggestionDocument ToSuggestionDocument(SuggestionEntity entity) => new(
    entity.Id,
    entity.ProcessId,
    entity.StepId,
    entity.Type,
    entity.Text,
    entity.CreatedBy,
    entity.CreatedAtUtc.ToString("O"),
    entity.Status);

static void AddMappedEntraRoles(ClaimsPrincipal? principal, RuntimeConfig runtimeConfig)
{
    if (principal?.Identity is not ClaimsIdentity identity)
    {
        return;
    }

    var existingRoles = new HashSet<string>(
        principal.FindAll(ClaimTypes.Role).Concat(principal.FindAll("roles")).Select(claim => claim.Value),
        StringComparer.OrdinalIgnoreCase);

    foreach (var groupId in GetGroupClaimValues(principal))
    {
        if (!runtimeConfig.Entra.GroupRoleMappings.TryGetValue(groupId, out var mappedRoles))
        {
            continue;
        }

        foreach (var role in RoleNames.Normalize(mappedRoles))
        {
            if (existingRoles.Add(role))
            {
                identity.AddClaim(new Claim(ClaimTypes.Role, role));
            }
        }
    }
}

static IEnumerable<string> GetGroupClaimValues(ClaimsPrincipal principal)
{
    return principal.FindAll("groups")
        .Concat(principal.FindAll("group"))
        .Concat(principal.FindAll(ClaimTypes.GroupSid))
        .Select(claim => claim.Value)
        .Where(value => !string.IsNullOrWhiteSpace(value))
        .Distinct(StringComparer.OrdinalIgnoreCase);
}

static string GetOpenApiPage() => """
<!doctype html>
<html lang="nl">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Service Procesgids API</title>
    <style>
      body { font-family: Segoe UI, Arial, sans-serif; margin: 3rem; max-width: 920px; color: #1f2937; }
      a { color: #c2410c; font-weight: 700; }
      code { background: #f3f4f6; padding: .15rem .35rem; border-radius: .25rem; }
      .panel { border: 1px solid #d1d5db; border-radius: .5rem; padding: 1rem; background: #fff7ed; }
    </style>
  </head>
  <body>
    <h1>Service Procesgids API</h1>
    <p>De backend draait. Het actuele OpenAPI-contract staat op <a href="/api/openapi.yaml">/api/openapi.yaml</a>.</p>
    <div class="panel">
      <p><strong>M0 endpoints</strong></p>
      <p><code>GET /api/config</code> · <code>GET /api/me</code> · <code>GET /api/health</code></p>
    </div>
  </body>
</html>
""";
