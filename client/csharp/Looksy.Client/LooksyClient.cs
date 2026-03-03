using System.Net.Http.Json;
using System.Text.Json;

namespace Looksy.Client;

public sealed class LooksyClient : IDisposable
{
  private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
  {
    DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull
  };

  private readonly HttpClient _httpClient;
  private readonly bool _ownsHttpClient;

  public LooksyClient(string baseUrl, string? authToken = null, TimeSpan? timeout = null, HttpClient? httpClient = null)
  {
    _ownsHttpClient = httpClient is null;
    _httpClient = httpClient ?? new HttpClient();
    _httpClient.BaseAddress = new Uri(NormalizeBaseUrl(baseUrl), UriKind.Absolute);

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
    return PostAsync<HandshakeRequest, HandshakeResponse>("/v1/handshake", request, cancellationToken);
  }

  public Task<CommandResponse<TResponse>> CommandAsync<TResponse>(CommandRequest request, CancellationToken cancellationToken = default)
  {
    return PostAsync<CommandRequest, CommandResponse<TResponse>>("/v1/command", request, cancellationToken);
  }

  public Task<CommandResponse<HealthResult>> HealthAsync(CancellationToken cancellationToken = default)
  {
    return CommandAsync<HealthResult>(new CommandRequest("health.ping", "health.ping"), cancellationToken);
  }

  public Task<CommandResponse<CapabilitiesResult>> CapabilitiesAsync(CancellationToken cancellationToken = default)
  {
    return CommandAsync<CapabilitiesResult>(new CommandRequest("capabilities", "capabilities"), cancellationToken);
  }

  public Task<CommandResponse<ScreenshotResult>> ScreenshotAsync(ScreenshotRequest request, CancellationToken cancellationToken = default)
  {
    var payload = JsonSerializer.SerializeToElement(request, JsonOptions);
    return CommandAsync<ScreenshotResult>(new CommandRequest("screenshot", "screenshot", payload), cancellationToken);
  }

  public Task<CommandResponse<IReadOnlyList<WindowInfo>>> ListWindowsAsync(WindowsListRequest request, CancellationToken cancellationToken = default)
  {
    var payload = JsonSerializer.SerializeToElement(request, JsonOptions);
    return CommandAsync<IReadOnlyList<WindowInfo>>(new CommandRequest("app.listWindows", "app.listWindows", payload), cancellationToken);
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

  private async Task<TResponse> PostAsync<TRequest, TResponse>(string path, TRequest request, CancellationToken cancellationToken)
  {
    using var httpResponse = await _httpClient.PostAsJsonAsync(path, request, JsonOptions, cancellationToken).ConfigureAwait(false);
    var responseBody = await httpResponse.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

    if (!httpResponse.IsSuccessStatusCode)
    {
      throw new HttpRequestException(
        $"Host request to {path} failed with {(int)httpResponse.StatusCode} {httpResponse.ReasonPhrase}. Body: {responseBody}",
        null,
        httpResponse.StatusCode
      );
    }

    var parsed = JsonSerializer.Deserialize<TResponse>(responseBody, JsonOptions);
    if (parsed is null)
    {
      throw new InvalidOperationException($"Received an empty response payload from {path}.");
    }

    return parsed;
  }
}
