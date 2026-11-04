using System.Security.Claims;
using ServiceProcesgids.Api.Contract;
using ServiceProcesgids.Api.Models;

namespace ServiceProcesgids.Api.Services;

public static class AssuranceFrameworkDraftEndpoints
{
    public static IServiceCollection AddAssuranceFrameworkDrafts(
        this IServiceCollection services) =>
        services.AddScoped<AssuranceFrameworkDraftService>();

    public static IEndpointRouteBuilder MapAssuranceFrameworkDraftEndpoints(
        this IEndpointRouteBuilder endpoints)
    {
        var routes = endpoints
            .MapGroup("/api/admin/assurance-framework-drafts")
            .RequireAuthorization("CanManage");

        routes.MapGet("/", async (
            AssuranceFrameworkDraftService service,
            CancellationToken cancellationToken) =>
        {
            try
            {
                return Results.Ok(await service.ListAsync(cancellationToken));
            }
            catch (AssuranceFrameworkDraftException ex)
            {
                return Error(ex);
            }
        })
        .WithName("ListAssuranceFrameworkDrafts");

        routes.MapPost("/ai", async (
            AssuranceFrameworkDraftCreateRequest request,
            AssuranceFrameworkDraftService service,
            CurrentUserService currentUser,
            ClaimsPrincipal principal,
            ILoggerFactory loggerFactory,
            CancellationToken cancellationToken) =>
        {
            try
            {
                var actor = currentUser.FromPrincipal(principal);
                var draft = await service.CreateWithAiAsync(
                    actor,
                    request,
                    cancellationToken);
                return Results.Created(
                    $"/api/admin/assurance-framework-drafts/{draft.DraftId}",
                    draft);
            }
            catch (AssuranceFrameworkDraftException ex)
            {
                return Error(ex);
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
                        "De AI-provider wees de kaderaanvraag af of was niet bereikbaar. Er is niets opgeslagen."),
                    statusCode: StatusCodes.Status502BadGateway);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                loggerFactory
                    .CreateLogger("AssuranceFrameworkDraftEndpoints")
                    .LogError(
                        ex,
                        "Onverwachte fout tijdens AI-kaderintake. ErrorType={ErrorType}",
                        ex.GetType().Name);
                return Results.Json(
                    new ApiError(
                        "assurance-framework-draft-unexpected",
                        "Het kaderconcept kon niet veilig worden aangemaakt. Er is niets gepubliceerd."),
                    statusCode: StatusCodes.Status500InternalServerError);
            }
        })
        .WithName("CreateAssuranceFrameworkDraftWithAi");

        routes.MapPost("/{draftId}/publish", async (
            string draftId,
            AssuranceFrameworkDraftPublishRequest request,
            AssuranceFrameworkDraftService service,
            CurrentUserService currentUser,
            ClaimsPrincipal principal,
            ILoggerFactory loggerFactory,
            CancellationToken cancellationToken) =>
        {
            try
            {
                var actor = currentUser.FromPrincipal(principal);
                return Results.Ok(await service.PublishAsync(
                    draftId,
                    actor,
                    request,
                    cancellationToken));
            }
            catch (AssuranceFrameworkDraftException ex)
            {
                return Error(ex);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                loggerFactory
                    .CreateLogger("AssuranceFrameworkDraftEndpoints")
                    .LogError(
                        ex,
                        "Onverwachte fout tijdens kaderpublicatie. DraftId={DraftId} ErrorType={ErrorType}",
                        draftId,
                        ex.GetType().Name);
                return Results.Json(
                    new ApiError(
                        "assurance-framework-publish-unexpected",
                        "Het kaderconcept kon niet veilig worden gepubliceerd."),
                    statusCode: StatusCodes.Status500InternalServerError);
            }
        })
        .WithName("PublishAssuranceFrameworkDraft");

        routes.MapPost("/{draftId}/reject", async (
            string draftId,
            AssuranceFrameworkDraftRejectRequest request,
            AssuranceFrameworkDraftService service,
            CurrentUserService currentUser,
            ClaimsPrincipal principal,
            ILoggerFactory loggerFactory,
            CancellationToken cancellationToken) =>
        {
            try
            {
                var actor = currentUser.FromPrincipal(principal);
                return Results.Ok(await service.RejectAsync(
                    draftId,
                    actor,
                    request,
                    cancellationToken));
            }
            catch (AssuranceFrameworkDraftException ex)
            {
                return Error(ex);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                loggerFactory
                    .CreateLogger("AssuranceFrameworkDraftEndpoints")
                    .LogError(
                        ex,
                        "Onverwachte fout tijdens kaderafwijzing. DraftId={DraftId} ErrorType={ErrorType}",
                        draftId,
                        ex.GetType().Name);
                return Results.Json(
                    new ApiError(
                        "assurance-framework-reject-unexpected",
                        "Het kaderconcept kon niet veilig worden afgewezen."),
                    statusCode: StatusCodes.Status500InternalServerError);
            }
        })
        .WithName("RejectAssuranceFrameworkDraft");

        return endpoints;
    }

    private static IResult Error(AssuranceFrameworkDraftException exception) =>
        Results.Json(
            new ApiError(exception.Code, exception.Message),
            statusCode: exception.StatusCode);
}
