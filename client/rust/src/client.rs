use crate::models::{CommandRequest, CommandResponse, HandshakeRequest, HandshakeResponse, ScreenshotRequest, WindowsListRequest};
use reqwest::StatusCode;
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;
use thiserror::Error;

#[derive(Debug, Clone)]
pub struct LooksyClient {
    base_url: String,
    auth_token: Option<String>,
    client: reqwest::Client,
}

impl LooksyClient {
    pub fn new(base_url: impl Into<String>) -> Self {
        Self {
            base_url: normalize_base_url(base_url.into()),
            auth_token: None,
            client: reqwest::Client::new(),
        }
    }

    pub fn with_auth_token(mut self, token: impl Into<String>) -> Self {
        self.auth_token = Some(token.into());
        self
    }

    pub async fn handshake(&self, request: &HandshakeRequest) -> Result<HandshakeResponse, LooksyError> {
        self.post_json("/v1/handshake", request).await
    }

    pub async fn command<TPayload, TResult>(
        &self,
        request: &CommandRequest<TPayload>,
    ) -> Result<CommandResponse<TResult>, LooksyError>
    where
        TPayload: Serialize + ?Sized,
        TResult: DeserializeOwned,
    {
        self.post_json("/v1/command", request).await
    }

    pub async fn health<TResult: DeserializeOwned>(&self) -> Result<CommandResponse<TResult>, LooksyError> {
        let request = named_command::<Value>("health.ping", Value::Object(Default::default()));
        self.command(&request).await
    }

    pub async fn capabilities<TResult: DeserializeOwned>(&self) -> Result<CommandResponse<TResult>, LooksyError> {
        let request = named_command::<Value>("capabilities", Value::Object(Default::default()));
        self.command(&request).await
    }

    pub async fn screenshot<TResult: DeserializeOwned>(
        &self,
        payload: ScreenshotRequest,
    ) -> Result<CommandResponse<TResult>, LooksyError> {
        let request = named_command("screenshot", payload);
        self.command(&request).await
    }

    pub async fn windows_list<TResult: DeserializeOwned>(
        &self,
        payload: WindowsListRequest,
    ) -> Result<CommandResponse<TResult>, LooksyError> {
        let request = named_command("app.listWindows", payload);
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
            return Err(LooksyError::HttpStatus { status, body });
        }

        response.json::<TResponse>().await.map_err(LooksyError::Decode)
    }
}

fn normalize_base_url(base_url: String) -> String {
    base_url.trim_end_matches('/').to_string()
}

fn named_command<TPayload>(command_name: &str, payload: TPayload) -> CommandRequest<TPayload> {
    CommandRequest {
        command: command_name.to_string(),
        command_type: Some(command_name.to_string()),
        payload: Some(payload),
        request_id: None,
        timeout_ms: None,
    }
}

#[derive(Debug, Error)]
pub enum LooksyError {
    #[error("transport error: {0}")]
    Transport(reqwest::Error),
    #[error("response decode error: {0}")]
    Decode(reqwest::Error),
    #[error("host returned {status}: {body}")]
    HttpStatus { status: StatusCode, body: String },
}
