using System.Net.Http.Json;
using System.Text.Json;

namespace Looksy.Client;

public sealed class LooksyClient : IDisposable
{
  public const string DefaultHostUrl = "http://127.0.0.1:4064";
  public const string DefaultProtocolVersion = LooksyProtocol.DefaultVersion;

  private static readonly System.Text.Json.JsonSerializerOptions JsonOptions = new(System.Text.Json.JsonSerializerDefaults.Web)
  {
    DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
  };

  private readonly HttpClient _httpClient;
  private readonly bool _ownsHttpClient;
  private readonly string? _authToken;
  private string _protocolVersion;
  private string? _sessionId;

  public LooksyClient(
    string baseUrl = DefaultHostUrl,
    string? authToken = null,
    TimeSpan? timeout = null,
    HttpClient? httpClient = null)
  {
    _ownsHttpClient = httpClient is null;
    _httpClient = httpClient ?? new HttpClient();
    _httpClient.BaseAddress = new Uri(NormalizeBaseUrl(baseUrl), UriKind.Absolute);
    _authToken = authToken;
    _protocolVersion = DefaultProtocolVersion;

    if (!string.IsNullOrWhiteSpace(authToken))
    {
      _httpClient.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", authToken);
    }

    if (timeout is not null)
    {
      _httpClient.Timeout = timeout.Value;
    }
  }

  public Task<HandshakeResponse> HandshakeAsync(HandshakeRequest request, CancellationToken cancellationToken = default)
  {
    var authToken = !string.IsNullOrWhiteSpace(request.AuthToken) ? request.AuthToken : _authToken;
    if (string.IsNullOrWhiteSpace(authToken))
    {
      throw new InvalidOperationException("Handshake requires authToken. Provide request.AuthToken or client authToken.");
    }

    var normalized = request with
    {
      ProtocolVersion = string.IsNullOrWhiteSpace(request.ProtocolVersion) ? _protocolVersion : request.ProtocolVersion,
      RequestId = string.IsNullOrWhiteSpace(request.RequestId) ? CreateRequestId() : request.RequestId,
      AuthToken = authToken,
    };

    return HandshakeInternalAsync(normalized, cancellationToken);
  }

  public void SetSessionId(string sessionId)
  {
    if (string.IsNullOrWhiteSpace(sessionId))
    {
      throw new ArgumentException("sessionId must be non-empty.", nameof(sessionId));
    }

    _sessionId = sessionId;
  }

  public string? GetSessionId()
  {
    return _sessionId;
  }

  public Task<CommandResponse<TResponse>> CommandAsync<TResponse>(CommandRequest request, CancellationToken cancellationToken = default)
  {
    var sessionId = !string.IsNullOrWhiteSpace(request.SessionId) ? request.SessionId : _sessionId;
    if (string.IsNullOrWhiteSpace(sessionId))
    {
      throw new InvalidOperationException("Command requires sessionId. Call HandshakeAsync first or provide request.SessionId.");
    }

    var normalized = request with
    {
      ProtocolVersion = string.IsNullOrWhiteSpace(request.ProtocolVersion) ? _protocolVersion : request.ProtocolVersion,
      RequestId = string.IsNullOrWhiteSpace(request.RequestId) ? CreateRequestId() : request.RequestId,
      SessionId = sessionId,
    };

    return PostAsync<CommandRequest, CommandResponse<TResponse>>("/v1/command", normalized, cancellationToken);
  }

  public Task<CommandResponse<HealthResult>> HealthAsync(CancellationToken cancellationToken = default)
  {
    return CommandAsync<HealthResult>(new CommandRequest(new HealthPingCommand()), cancellationToken);
  }

  public Task<CommandResponse<CapabilitiesResult>> CapabilitiesAsync(CancellationToken cancellationToken = default)
  {
    return CommandAsync<CapabilitiesResult>(new CommandRequest(new HealthGetCapabilitiesCommand()), cancellationToken);
  }

  public Task<CommandResponse<ScreenshotResult>> ScreenshotAsync(ScreenshotRequest? request = null, CancellationToken cancellationToken = default)
  {
    var payload = request ?? new ScreenshotRequest();
    var command = new ScreenCaptureCommand(Format: payload.Format, Region: payload.Region);
    return CommandAsync<ScreenshotResult>(new CommandRequest(command), cancellationToken);
  }

  public Task<CommandResponse<WindowsListResult>> ListWindowsAsync(WindowsListRequest? request = null, CancellationToken cancellationToken = default)
  {
    var payload = request ?? new WindowsListRequest();
    var command = new AppListWindowsCommand(
      IncludeMinimized: payload.IncludeMinimized,
      DesktopOnly: payload.DesktopOnly
    );
    return CommandAsync<WindowsListResult>(new CommandRequest(command), cancellationToken);
  }

  public void Dispose()
  {
    if (_ownsHttpClient)
    {
      _httpClient.Dispose();
    }
  }

  private static string NormalizeBaseUrl(string baseUrl)
  {
    if (baseUrl.EndsWith('/'))
    {
      return baseUrl[..^1];
    }

    return baseUrl;
  }

  private async Task<HandshakeResponse> HandshakeInternalAsync(HandshakeRequest request, CancellationToken cancellationToken)
  {
    var response = await PostAsync<HandshakeRequest, HandshakeResponse>("/v1/handshake", request, cancellationToken).ConfigureAwait(false);
    if (response.Ok && response.Session is not null)
    {
      _protocolVersion = response.ProtocolVersion;
      _sessionId = response.Session.SessionId;
    }

    return response;
  }

  private async Task<TResponse> PostAsync<TRequest, TResponse>(string path, TRequest request, CancellationToken cancellationToken)
  {
    using var httpResponse = await _httpClient.PostAsJsonAsync(path, request, JsonOptions, cancellationToken).ConfigureAwait(false);
    var responseBody = await httpResponse.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
    if (!string.IsNullOrWhiteSpace(responseBody))
    {
      var parsed = JsonSerializer.Deserialize<TResponse>(responseBody, JsonOptions);
      if (parsed is not null)
      {
        return parsed;
      }
    }

    if (!httpResponse.IsSuccessStatusCode)
    {
      throw new HttpRequestException(
        $"Host request to {path} failed with {(int)httpResponse.StatusCode} {httpResponse.ReasonPhrase}. Body: {responseBody}",
        null,
        httpResponse.StatusCode
      );
    }

    throw new InvalidOperationException($"Received an empty response payload from {path}.");
  }

  private static string CreateRequestId()
  {
    return Guid.NewGuid().ToString("N");
  }
}
