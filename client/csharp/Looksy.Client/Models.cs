using System.Text.Json;
using System.Text.Json.Serialization;
using Looksy.Client.Generated;

namespace Looksy.Client;

public static class LooksyProtocol
{
  public const string DefaultVersion = "1.0.0";
}

public sealed record HandshakeRequest(
  [property: JsonPropertyName("client")] HandshakeClientInfo Client,
  [property: JsonPropertyName("protocolVersion")] string? ProtocolVersion = null,
  [property: JsonPropertyName("requestId")] string? RequestId = null,
  [property: JsonPropertyName("authToken")] string? AuthToken = null,
  [property: JsonPropertyName("requestedCapabilities")] IReadOnlyList<string>? RequestedCapabilities = null
);

public sealed record HandshakeClientInfo(
  [property: JsonPropertyName("name")] string Name,
  [property: JsonPropertyName("version")] string Version
);

public sealed record HandshakeResponse(
  [property: JsonPropertyName("protocolVersion")] string ProtocolVersion,
  [property: JsonPropertyName("requestId")] string RequestId,
  [property: JsonPropertyName("ok")] bool Ok,
  [property: JsonPropertyName("session")] SessionInfo? Session = null,
  [property: JsonPropertyName("error")] HostError? Error = null
);

public sealed record SessionInfo(
  [property: JsonPropertyName("sessionId")] string SessionId,
  [property: JsonPropertyName("adapter")] string Adapter,
  [property: JsonPropertyName("capabilities")] IReadOnlyList<string> Capabilities,
  [property: JsonPropertyName("issuedAt")] string IssuedAt
);

public sealed record CommandRequest(
  [property: JsonPropertyName("command")] object Command,
  [property: JsonPropertyName("protocolVersion")] string? ProtocolVersion = null,
  [property: JsonPropertyName("requestId")] string? RequestId = null,
  [property: JsonPropertyName("sessionId")] string? SessionId = null,
  [property: JsonPropertyName("timeoutMs")] int? TimeoutMs = null
);

public sealed record CommandResponse<T>(
  [property: JsonPropertyName("protocolVersion")] string ProtocolVersion,
  [property: JsonPropertyName("requestId")] string RequestId,
  [property: JsonPropertyName("ok")] bool Ok,
  [property: JsonPropertyName("result")] T? Result = default,
  [property: JsonPropertyName("error")] HostError? Error = null
);

public sealed record HostError(
  [property: JsonPropertyName("code")] string Code,
  [property: JsonPropertyName("message")] string Message,
  [property: JsonPropertyName("retriable")] bool Retriable,
  [property: JsonPropertyName("details")] JsonElement? Details = null
);

public sealed record HealthResult(
  [property: JsonPropertyName("type")] string Type,
  [property: JsonPropertyName("status")] string Status,
  [property: JsonPropertyName("adapter")] string Adapter,
  [property: JsonPropertyName("now")] string Now
);

public sealed record CapabilitiesResult(
  [property: JsonPropertyName("type")] string Type,
  [property: JsonPropertyName("capabilities")] IReadOnlyList<string> Capabilities
);

public sealed record ScreenshotRequest(
  [property: JsonPropertyName("format")] string? Format = null,
  [property: JsonPropertyName("region")] Rect? Region = null
);

public sealed record ScreenshotResult(
  [property: JsonPropertyName("type")] string Type,
  [property: JsonPropertyName("artifactId")] string ArtifactId,
  [property: JsonPropertyName("mimeType")] string MimeType,
  [property: JsonPropertyName("capturedAt")] string CapturedAt,
  [property: JsonPropertyName("artifactUrl")] string? ArtifactUrl = null,
  [property: JsonPropertyName("region")] Rect? Region = null
);

public sealed record WindowsListRequest(
  [property: JsonPropertyName("includeMinimized")] bool? IncludeMinimized = null,
  [property: JsonPropertyName("desktopOnly")] bool? DesktopOnly = null
);

public sealed record WindowsListResult(
  [property: JsonPropertyName("type")] string Type,
  [property: JsonPropertyName("windows")] IReadOnlyList<WindowInfo> Windows
);

public sealed record WindowInfo(
  [property: JsonPropertyName("windowId")] string WindowId,
  [property: JsonPropertyName("title")] string Title,
  [property: JsonPropertyName("appName")] string AppName,
  [property: JsonPropertyName("focused")] bool Focused,
  [property: JsonPropertyName("bounds")] Rect Bounds
);

public sealed record Point(
  [property: JsonPropertyName("x")] double X,
  [property: JsonPropertyName("y")] double Y,
  [property: JsonPropertyName("space")] string Space
);

public sealed record Rect(
  [property: JsonPropertyName("x")] double X,
  [property: JsonPropertyName("y")] double Y,
  [property: JsonPropertyName("width")] double Width,
  [property: JsonPropertyName("height")] double Height,
  [property: JsonPropertyName("space")] string Space
);

public sealed record HealthPingCommand(
  [property: JsonPropertyName("type")] string Type = ProtocolCommandIds.HealthPing
);

public sealed record HealthGetCapabilitiesCommand(
  [property: JsonPropertyName("type")] string Type = ProtocolCommandIds.HealthGetCapabilities
);

public sealed record ScreenCaptureCommand(
  [property: JsonPropertyName("type")] string Type = ProtocolCommandIds.ScreenCapture,
  [property: JsonPropertyName("format")] string? Format = null,
  [property: JsonPropertyName("region")] Rect? Region = null
);

public sealed record AppListWindowsCommand(
  [property: JsonPropertyName("type")] string Type = ProtocolCommandIds.AppListWindows,
  [property: JsonPropertyName("includeMinimized")] bool? IncludeMinimized = null,
  [property: JsonPropertyName("desktopOnly")] bool? DesktopOnly = null
);
