namespace ServiceProcesgids.Api.Services;

public sealed class AiConfigurationException : Exception
{
    public AiConfigurationException(string code, string message, Exception? innerException = null)
        : base(message, innerException)
    {
        Code = code;
    }

    public string Code { get; }
}

public sealed class AiProviderException : Exception
{
    public AiProviderException(string provider, int? statusCode = null, Exception? innerException = null)
        : base("De AI-provider kon de aanvraag niet veilig verwerken.", innerException)
    {
        Provider = provider;
        StatusCode = statusCode;
    }

    public string Provider { get; }
    public int? StatusCode { get; }
}
