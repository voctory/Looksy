use crate::generated::command_ids;
use crate::models::{
    CommandRequest, CommandResponse, HandshakeRequest, HandshakeResponse, HandshakeClientInfo, ScreenshotRequest,
    WindowsListRequest,
};
use reqwest::StatusCode;
use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;

const DEFAULT_PROTOCOL_VERSION: &str = "1.0.0";
static REQUEST_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone)]
pub struct LooksyClient {
    base_url: String,
    auth_token: Option<String>,
    protocol_version: String,
    session_id: Option<String>,
    client: reqwest::Client,
}

impl LooksyClient {
    pub fn new(base_url: impl Into<String>) -> Self {
        Self {
            base_url: normalize_base_url(base_url.into()),
            auth_token: None,
            protocol_version: DEFAULT_PROTOCOL_VERSION.to_string(),
            session_id: None,
            client: reqwest::Client::new(),
        }
    }

    pub fn with_auth_token(mut self, token: impl Into<String>) -> Self {
        self.auth_token = Some(token.into());
        self
    }

    pub fn with_protocol_version(mut self, protocol_version: impl Into<String>) -> Self {
        self.protocol_version = protocol_version.into();
        self
    }

    pub fn set_session_id(&mut self, session_id: impl Into<String>) {
        self.session_id = Some(session_id.into());
    }

    pub fn session_id(&self) -> Option<&str> {
        self.session_id.as_deref()
    }

    pub async fn handshake(&mut self, request: &HandshakeRequest) -> Result<HandshakeResponse, LooksyError> {
        let envelope = normalize_handshake_request(self, request)?;
        let response: HandshakeResponse = self.post_json("/v1/handshake", &envelope).await?;
        if response.ok {
            if let Some(session) = &response.session {
                self.session_id = Some(session.session_id.clone());
            }
            self.protocol_version = response.protocol_version.clone();
        }
        Ok(response)
    }

    pub async fn command<TCommand, TResult>(
        &self,
        request: &CommandRequest<TCommand>,
    ) -> Result<CommandResponse<TResult>, LooksyError>
    where
        TCommand: Serialize + Clone,
        TResult: DeserializeOwned,
    {
        let envelope = normalize_command_request(self, request)?;
        self.post_json("/v1/command", &envelope).await
    }

    pub async fn health<TResult: DeserializeOwned>(&self) -> Result<CommandResponse<TResult>, LooksyError> {
        let request = named_command(command_ids::HEALTH_PING, EmptyCommandPayload::default());
        self.command(&request).await
    }

    pub async fn capabilities<TResult: DeserializeOwned>(&self) -> Result<CommandResponse<TResult>, LooksyError> {
        let request = named_command(
            command_ids::HEALTH_GET_CAPABILITIES,
            EmptyCommandPayload::default(),
        );
        self.command(&request).await
    }

    pub async fn screenshot<TResult: DeserializeOwned>(
        &self,
        payload: ScreenshotRequest,
    ) -> Result<CommandResponse<TResult>, LooksyError> {
        let request = named_command(command_ids::SCREEN_CAPTURE, payload);
        self.command(&request).await
    }

    pub async fn windows_list<TResult: DeserializeOwned>(
        &self,
        payload: WindowsListRequest,
    ) -> Result<CommandResponse<TResult>, LooksyError> {
        let request = named_command(command_ids::APP_LIST_WINDOWS, payload);
        self.command(&request).await
    }

    async fn post_json<TRequest, TResponse>(&self, path: &str, body: &TRequest) -> Result<TResponse, LooksyError>
    where
        TRequest: Serialize + ?Sized,
        TResponse: DeserializeOwned,
    {
        let url = format!("{}{}", self.base_url, path);
        let mut request_builder = self.client.post(url).json(body);

        if let Some(token) = &self.auth_token {
            request_builder = request_builder.bearer_auth(token);
        }

        let response = request_builder.send().await.map_err(LooksyError::Transport)?;
        let status = response.status();

        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            if let Ok(parsed) = serde_json::from_str::<TResponse>(&body) {
                return Ok(parsed);
            }
            return Err(LooksyError::HttpStatus { status, body });
        }

        response.json::<TResponse>().await.map_err(LooksyError::Decode)
    }
}

fn normalize_base_url(base_url: String) -> String {
    base_url.trim_end_matches('/').to_string()
}

fn named_command<TPayload>(command_name: &str, payload: TPayload) -> CommandRequest<Value>
where
    TPayload: Serialize,
{
    let mut command = match serde_json::to_value(payload).expect("command payload must be serializable") {
        Value::Object(map) => map,
        Value::Null => serde_json::Map::new(),
        value => {
            let mut map = serde_json::Map::new();
            map.insert("value".to_string(), value);
            map
        }
    };
    command.retain(|_, value| !value.is_null());
    command.insert("type".to_string(), Value::String(command_name.to_string()));

    CommandRequest {
        protocol_version: None,
        request_id: None,
        session_id: None,
        timeout_ms: None,
        command: Value::Object(command),
    }
}

fn normalize_handshake_request(
    client: &LooksyClient,
    request: &HandshakeRequest,
) -> Result<HandshakeEnvelope, LooksyError> {
    let auth_token = request
        .auth_token
        .clone()
        .or_else(|| client.auth_token.clone())
        .ok_or(LooksyError::MissingAuthToken)?;

    Ok(HandshakeEnvelope {
        protocol_version: request
            .protocol_version
            .clone()
            .unwrap_or_else(|| client.protocol_version.clone()),
        request_id: request.request_id.clone().unwrap_or_else(generate_request_id),
        auth_token,
        client: request.client.clone(),
        requested_capabilities: request.requested_capabilities.clone(),
    })
}

fn normalize_command_request<TCommand>(
    client: &LooksyClient,
    request: &CommandRequest<TCommand>,
) -> Result<CommandEnvelope<TCommand>, LooksyError>
where
    TCommand: Serialize + Clone,
{
    let session_id = request
        .session_id
        .clone()
        .or_else(|| client.session_id.clone())
        .ok_or(LooksyError::MissingSessionId)?;

    Ok(CommandEnvelope {
        protocol_version: request
            .protocol_version
            .clone()
            .unwrap_or_else(|| client.protocol_version.clone()),
        request_id: request.request_id.clone().unwrap_or_else(generate_request_id),
        session_id,
        timeout_ms: request.timeout_ms,
        command: request.command.clone(),
    })
}

fn generate_request_id() -> String {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let seq = REQUEST_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("req_{ts}_{seq}")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HandshakeEnvelope {
    protocol_version: String,
    request_id: String,
    auth_token: String,
    client: HandshakeClientInfo,
    #[serde(skip_serializing_if = "Option::is_none")]
    requested_capabilities: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CommandEnvelope<TCommand> {
    protocol_version: String,
    request_id: String,
    session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    timeout_ms: Option<u64>,
    command: TCommand,
}

#[derive(Debug, Clone, Default, Serialize)]
struct EmptyCommandPayload {}

#[derive(Debug, Error)]
pub enum LooksyError {
    #[error("handshake requires auth token in request.authToken or client auth token")]
    MissingAuthToken,
    #[error("command requires session id in request.sessionId or client session id")]
    MissingSessionId,
    #[error("transport error: {0}")]
    Transport(reqwest::Error),
    #[error("response decode error: {0}")]
    Decode(reqwest::Error),
    #[error("host returned {status}: {body}")]
    HttpStatus { status: StatusCode, body: String },
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn capabilities_wrapper_uses_health_get_capabilities_command_name() {
        let req = named_command(
            command_ids::HEALTH_GET_CAPABILITIES,
            EmptyCommandPayload::default(),
        );
        let command_json = serde_json::to_value(req.command).expect("serialize command");
        assert_eq!(
            command_json,
            json!({
                "type": "health.getCapabilities"
            })
        );
    }

    #[test]
    fn screenshot_wrapper_uses_screen_capture_command_name() {
        let req = named_command(
            command_ids::SCREEN_CAPTURE,
            ScreenshotRequest {
                format: Some("png".to_string()),
                region: None,
            },
        );
        let command_json = serde_json::to_value(req.command).expect("serialize command");
        assert_eq!(
            command_json,
            json!({
                "type": "screen.capture",
                "format": "png"
            })
        );
    }

    #[test]
    fn command_normalization_fills_protocol_and_request_identifiers() {
        let mut client = LooksyClient::new("http://127.0.0.1:4064")
            .with_protocol_version("1.0.0")
            .with_auth_token("token-fixture-valid");
        client.set_session_id("sess_123");

        let request = named_command(command_ids::HEALTH_PING, EmptyCommandPayload::default());
        let normalized = normalize_command_request(&client, &request).expect("normalize");
        let envelope = serde_json::to_value(normalized).expect("serialize envelope");

        assert_eq!(envelope["protocolVersion"], "1.0.0");
        assert_eq!(envelope["sessionId"], "sess_123");
        assert_eq!(envelope["command"]["type"], "health.ping");
        assert!(envelope["requestId"].as_str().is_some_and(|value| !value.is_empty()));
    }

    #[test]
    fn handshake_normalization_fills_protocol_request_and_auth() {
        let client = LooksyClient::new("http://127.0.0.1:4064")
            .with_protocol_version("1.0.0")
            .with_auth_token("token-fixture-valid");

        let request = HandshakeRequest {
            protocol_version: None,
            request_id: None,
            auth_token: None,
            client: HandshakeClientInfo {
                name: "looksy-rust".to_string(),
                version: "0.1.0".to_string(),
            },
            requested_capabilities: None,
        };

        let normalized = normalize_handshake_request(&client, &request).expect("normalize");
        let envelope = serde_json::to_value(normalized).expect("serialize envelope");

        assert_eq!(envelope["protocolVersion"], "1.0.0");
        assert_eq!(envelope["authToken"], "token-fixture-valid");
        assert_eq!(envelope["client"]["name"], "looksy-rust");
        assert!(envelope["requestId"].as_str().is_some_and(|value| !value.is_empty()));
    }
}
