using System.Text.Json;
using System.Text.Json.Serialization;

namespace Looksy.Client;

public sealed record HandshakeRequest(
  [property: JsonPropertyName("protocolVersion")] string ProtocolVersion,
  [property: JsonPropertyName("client")] HandshakeClientInfo Client,
  [property: JsonPropertyName("capabilities")] IReadOnlyList<string>? Capabilities = null,
  [property: JsonPropertyName("authToken")] string? AuthToken = null
);

public sealed record HandshakeClientInfo(
  [property: JsonPropertyName("name")] string Name,
  [property: JsonPropertyName("version")] string Version
);

public sealed record HandshakeResponse(
  [property: JsonPropertyName("protocolVersion")] string? ProtocolVersion,
  [property: JsonPropertyName("sessionId")] string? SessionId,
  [property: JsonPropertyName("capabilities")] IReadOnlyList<string>? Capabilities,
  [property: JsonPropertyName("server")] JsonElement? Server,
  [property: JsonPropertyName("error")] HostError? Error
);

public sealed record CommandRequest(
  [property: JsonPropertyName("command")] string Command,
  [property: JsonPropertyName("type")] string? Type = null,
  [property: JsonPropertyName("payload")] JsonElement? Payload = null,
  [property: JsonPropertyName("requestId")] string? RequestId = null,
  [property: JsonPropertyName("timeoutMs")] int? TimeoutMs = null
);

public sealed record CommandResponse<T>(
  [property: JsonPropertyName("ok")] bool? Ok,
  [property: JsonPropertyName("result")] T? Result,
  [property: JsonPropertyName("error")] HostError? Error,
  [property: JsonPropertyName("requestId")] string? RequestId
);

public sealed record HostError(
  [property: JsonPropertyName("code")] string Code,
  [property: JsonPropertyName("message")] string Message,
  [property: JsonPropertyName("details")] JsonElement? Details = null
);

public sealed record HealthResult(
  [property: JsonPropertyName("status")] string Status,
  [property: JsonPropertyName("uptimeMs")] long? UptimeMs = null
);

public sealed record CapabilitiesResult(
  [property: JsonPropertyName("capabilities")] IReadOnlyList<string> Capabilities
);

public sealed record ScreenshotRequest(
  [property: JsonPropertyName("format")] string? Format = null,
  [property: JsonPropertyName("quality")] int? Quality = null,
  [property: JsonPropertyName("displayId")] string? DisplayId = null,
  [property: JsonPropertyName("includeCursor")] bool? IncludeCursor = null
);

public sealed record ScreenshotResult(
  [property: JsonPropertyName("imageBase64")] string? ImageBase64,
  [property: JsonPropertyName("mimeType")] string? MimeType,
  [property: JsonPropertyName("width")] int? Width,
  [property: JsonPropertyName("height")] int? Height
);

public sealed record WindowsListRequest(
  [property: JsonPropertyName("includeMinimized")] bool? IncludeMinimized = null,
  [property: JsonPropertyName("desktopOnly")] bool? DesktopOnly = null
);

public sealed record WindowInfo(
  [property: JsonPropertyName("id")] string Id,
  [property: JsonPropertyName("title")] string? Title,
  [property: JsonPropertyName("processName")] string? ProcessName,
  [property: JsonPropertyName("bounds")] JsonElement? Bounds,
  [property: JsonPropertyName("isFocused")] bool? IsFocused
);
