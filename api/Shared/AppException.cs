namespace Erp.Api;

/// Throw this anywhere for an expected business error. It becomes a ProblemDetails response.
public class AppException(int status, string code, string message) : Exception(message)
{
    public int Status => status;
    public string Code => code;
}
