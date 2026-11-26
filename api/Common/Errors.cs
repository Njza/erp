using Microsoft.AspNetCore.Diagnostics;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Erp.Api;

/// Throw this anywhere for an expected business error. It becomes a ProblemDetails response.
public class AppException(int status, string code, string message) : Exception(message)
{
    public int Status => status;
    public string Code => code;
}

/// The single place that turns exceptions into the error contract:
/// { status, title (message for the user), code (stable, for programs), traceId }.
public class AppExceptionHandler(IProblemDetailsService problems, ILogger<AppExceptionHandler> log) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext ctx, Exception ex, CancellationToken ct)
    {
        var (status, code, message) = ex switch
        {
            AppException a => (a.Status, a.Code, a.Message),
            DbUpdateException { InnerException: PostgresException { SqlState: PostgresErrorCodes.UniqueViolation } }
                => (409, "DUPLICATE", "已存在相同的记录。"),
            DbUpdateException { InnerException: PostgresException { SqlState: PostgresErrorCodes.ForeignKeyViolation } }
                => (409, "IN_USE", "该记录正被其他数据引用，无法操作。"),
            BadHttpRequestException b => (b.StatusCode, "BAD_REQUEST", "请求格式不正确。"),
            _ => (500, "INTERNAL", "服务器发生错误，请稍后重试或联系管理员。"),
        };
        if (status >= 500) log.LogError(ex, "Unhandled exception");

        ctx.Response.StatusCode = status;
        return await problems.TryWriteAsync(new()
        {
            HttpContext = ctx,
            ProblemDetails = { Status = status, Title = message, Extensions = { ["code"] = code } },
        });
    }
}
