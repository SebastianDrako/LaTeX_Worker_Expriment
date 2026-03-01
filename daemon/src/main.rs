use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
    Json, Router,
};
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

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

async fn compile(Json(req): Json<CompileRequest>) -> Response {
    match tokio::task::spawn_blocking(move || run_tectonic(req)).await {
        Ok(Ok(pdf)) => (StatusCode::OK, [("content-type", "application/pdf")], pdf).into_response(),
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

#[tokio::main]
async fn main() {
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(7878);

    let app = Router::new().route("/compile", post(compile));
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .unwrap();

    println!("latex-daemon listening on http://127.0.0.1:{port}");
    axum::serve(listener, app).await.unwrap();
}
