namespace ServiceProcesgids.Api.Services;

public sealed record AiStructuredTextResult(
    string Output,
    string Provider,
    string Model);

public interface IAiStructuredClient
{
    Task<AiStructuredTextResult> CompleteStructuredAsync(
        string capability,
        string systemInstructions,
        string inputJson,
        int maxOutputTokens,
        CancellationToken cancellationToken);
}
