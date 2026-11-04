namespace ServiceProcesgids.Api.Services;

public sealed class ContinuousAssuranceWorker(
    IServiceScopeFactory scopeFactory,
    ILogger<ContinuousAssuranceWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Delay(TimeSpan.FromSeconds(15), stoppingToken);
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = scopeFactory.CreateScope();
                var runs = scope.ServiceProvider
                    .GetRequiredService<AssuranceRunService>();
                var result = await runs.RunDueAsync(stoppingToken);
                if (result is not null)
                {
                    logger.LogInformation(
                        "Geplande assurancecontrole {RunId} afgerond met {FindingCount} bevindingen.",
                        result.RunId,
                        result.FindingCount);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (AssuranceException ex) when (ex.Code == "assurance-run-active")
            {
                logger.LogInformation(
                    "Geplande assurancecontrole wacht omdat al een run actief is.");
            }
            catch (Exception ex)
            {
                logger.LogError(
                    ex,
                    "Geplande assurancecontrole is mislukt; de worker probeert het opnieuw.");
            }

            await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken);
        }
    }
}
