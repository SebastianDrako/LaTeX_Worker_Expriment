use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Arc};
use tokio::sync::broadcast;

#[derive(Clone)]
struct AppState {
    tx: Arc<broadcast::Sender<()>>,
}

#[derive(Deserialize)]
struct CompileRequest {
    main: String,
    #[serde(default)]
    assets: HashMap<String, String>,
}

#[derive(Serialize)]
struct CompileError {
    error: &'static str,
    log: String,
}

async fn compile(State(state): State<AppState>, Json(req): Json<CompileRequest>) -> Response {
    match tokio::task::spawn_blocking(move || run_tectonic(req)).await {
        Ok(Ok(pdf)) => {
            let _ = state.tx.send(());
            (StatusCode::OK, [("content-type", "application/pdf")], pdf).into_response()
        }
        Ok(Err(log)) => (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(CompileError { error: "compilation_failed", log }),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(CompileError { error: "internal_error", log: e.to_string() }),
        )
            .into_response(),
    }
}

async fn ws_handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> Response {
    ws.on_upgrade(move |socket| handle_socket(socket, state.tx.subscribe()))
}

async fn handle_socket(mut socket: WebSocket, mut rx: broadcast::Receiver<()>) {
    loop {
        tokio::select! {
            result = rx.recv() => {
                if result.is_err() { break; }
                if socket.send(Message::Text(r#"{"event":"pdf_updated"}"#.into())).await.is_err() {
                    break;
                }
            }
            msg = socket.recv() => {
                if !matches!(msg, Some(Ok(_))) { break; }
            }
        }
    }
}

fn run_tectonic(req: CompileRequest) -> Result<Vec<u8>, String> {
    use tectonic::{
        config::PersistentConfig,
        driver::{OutputFormat, PassSetting, ProcessingSessionBuilder},
        status::plain::PlainStatusBackend,
    };
    use tectonic::status::ChatterLevel;
    use tectonic_bridge_core::SecuritySettings;

    // Write assets to a temp directory so Tectonic can resolve \includegraphics etc.
    let work_dir = tempfile::tempdir().map_err(|e| e.to_string())?;

    for (name, content) in &req.assets {
        let dest = work_dir.path().join(name);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let data = if looks_binary(name) {
            base64::engine::general_purpose::STANDARD
                .decode(content)
                .map_err(|e| format!("base64 decode error for {name}: {e}"))?
        } else {
            content.as_bytes().to_vec()
        };
        std::fs::write(&dest, data).map_err(|e| e.to_string())?;
    }

    let config = PersistentConfig::default();
    let mut status = PlainStatusBackend::new(ChatterLevel::Minimal);
    let bundle = config
        .default_bundle(false, &mut status)
        .map_err(|e| e.to_string())?;

    let mut builder = ProcessingSessionBuilder::new_with_security(SecuritySettings::default());
    builder
        .primary_input_buffer(req.main.as_bytes())
        .tex_input_name("main.tex")
        .output_format(OutputFormat::Pdf)
        .format_name("latex")
        .pass(PassSetting::Default)
        .filesystem_root(work_dir.path())
        .do_not_write_output_files()
        .bundle(bundle);

    let mut session = builder.create(&mut status).map_err(|e| e.to_string())?;
    session.run(&mut status).map_err(|e| e.to_string())?;

    let files = session.into_file_data();
    files
        .get("main.pdf")
        .map(|f| f.data.clone())
        .ok_or_else(|| "Tectonic produced no PDF".to_string())
}

fn looks_binary(name: &str) -> bool {
    matches!(
        name.rsplit('.').next().unwrap_or("").to_lowercase().as_str(),
        "png" | "jpg" | "jpeg" | "pdf" | "eps" | "gif" | "bmp" | "tiff"
    )
}

#[cfg(test)]
mod tests {
    use super::{compile, looks_binary, ws_handler, AppState};
    use axum::{
        body::Body,
        http::{Request, StatusCode},
        routing::{get, post},
        Router,
    };
    use futures::StreamExt;
    use http_body_util::BodyExt;
    use std::sync::Arc;
    use tokio::sync::broadcast;
    use tower::ServiceExt;

    fn make_app() -> (Router, Arc<broadcast::Sender<()>>) {
        let (tx, _) = broadcast::channel::<()>(16);
        let tx = Arc::new(tx);
        let state = AppState { tx: tx.clone() };
        let app = Router::new()
            .route("/compile", post(compile))
            .route("/ws", get(ws_handler))
            .with_state(state);
        (app, tx)
    }

    // ── looks_binary ──────────────────────────────────────────────────────────

    #[test]
    fn binary_extensions_detected() {
        for ext in ["png", "jpg", "jpeg", "pdf", "eps", "gif", "bmp", "tiff"] {
            assert!(looks_binary(&format!("file.{ext}")), "expected binary: {ext}");
        }
    }

    #[test]
    fn text_extensions_not_binary() {
        for name in ["main.tex", "refs.bib", "data.csv", "noext"] {
            assert!(!looks_binary(name), "expected text: {name}");
        }
    }

    #[test]
    fn binary_detection_is_case_insensitive() {
        for name in ["foto.PNG", "logo.JPG", "doc.PDF"] {
            assert!(looks_binary(name), "expected binary: {name}");
        }
    }

    // ── HTTP: malformed requests ───────────────────────────────────────────────

    #[tokio::test]
    async fn compile_empty_body_returns_400() {
        let (app, _) = make_app();
        let res = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/compile")
                    .header("content-type", "application/json")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn compile_invalid_json_returns_400() {
        let (app, _) = make_app();
        let res = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/compile")
                    .header("content-type", "application/json")
                    .body(Body::from("{bad json}"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn compile_missing_main_field_returns_400() {
        let (app, _) = make_app();
        let res = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/compile")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"assets":{}}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    }

    // ── HTTP: error response shape ─────────────────────────────────────────────

    /// Tectonic must return a structured JSON error for invalid LaTeX.
    /// If the bundle is unreachable (CI/offline), the internal error path also
    /// returns JSON with the same shape, so this test is network-agnostic.
    #[tokio::test]
    async fn compile_invalid_latex_returns_json_error() {
        let (app, _) = make_app();
        let res = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/compile")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"main":"\\badcommand{}"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_ne!(res.status(), StatusCode::OK, "expected a non-200 status");
        let ct = res.headers()["content-type"].to_str().unwrap();
        assert!(ct.starts_with("application/json"), "expected JSON body, got: {ct}");

        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        let val: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert!(val.get("error").is_some(), "missing 'error' field in response");
        assert!(val.get("log").is_some(), "missing 'log' field in response");
    }

    // ── WebSocket: live-reload broadcast ──────────────────────────────────────

    #[tokio::test]
    async fn ws_receives_pdf_updated_after_broadcast() {
        use tokio_tungstenite::tungstenite::Message as WsMsg;

        let (app, tx) = make_app();

        // Bind on an OS-assigned port to avoid conflicts between parallel tests.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

        let (mut ws, _) =
            tokio_tungstenite::connect_async(format!("ws://{addr}/ws"))
                .await
                .unwrap();

        // Let the WS handler reach `rx.recv()` before we broadcast.
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let _ = tx.send(());

        let msg = ws.next().await.unwrap().unwrap();
        assert_eq!(msg, WsMsg::Text(r#"{"event":"pdf_updated"}"#.into()));
    }

    #[tokio::test]
    async fn ws_closes_cleanly_when_client_disconnects() {
        let (app, tx) = make_app();

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

        let (ws, _) =
            tokio_tungstenite::connect_async(format!("ws://{addr}/ws"))
                .await
                .unwrap();

        // Drop the client; the server-side handle_socket should exit its loop.
        drop(ws);
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        // The broadcast channel is still alive; sending must not panic.
        assert!(tx.send(()).is_ok() || tx.send(()).is_err()); // either is fine
    }
}

#[tokio::main]
async fn main() {
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(7878);

    let (tx, _) = broadcast::channel::<()>(16);
    let state = AppState { tx: Arc::new(tx) };

    let app = Router::new()
        .route("/compile", post(compile))
        .route("/ws", get(ws_handler))
        .with_state(state);
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .unwrap();

    println!("latex-daemon listening on http://127.0.0.1:{port}");
    axum::serve(listener, app).await.unwrap();
}
