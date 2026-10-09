//! Tauri 壳：只负责 sidecar 生命周期与窗口。所有 Agent 逻辑在 sidecar（apps/agent）。
//!
//! dev（debug 构建）：sidecar 由 `bun run dev:agent` 单独起（固定 47911、免 token），
//!   UI 的 client.ts 直连，这里什么都不 spawn。
//! release：spawn externalBin 的 sidecar（随机端口 + 一次性 token），eval 注入 webview。

#[cfg(not(debug_assertions))]
use tauri::Manager;

fn main() {
    #[cfg(not(debug_assertions))]
    let (port, token, sidecar_pid) = start_sidecar();

    tauri::Builder::default()
        .setup(move |app| {
            #[cfg(not(debug_assertions))]
            {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.eval(&format!(
                        "window.__SIFTORY__ = {{ port: {}, token: {:?} }};",
                        port, token
                    ));
                }
            }
            let _ = app;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("build tauri app")
        .run(move |_app, event| {
            #[cfg(not(debug_assertions))]
            if let tauri::RunEvent::ExitRequested { .. } = event {
                #[cfg(unix)]
                unsafe {
                    libc::kill(sidecar_pid as i32, libc::SIGTERM);
                }
            }
            #[cfg(debug_assertions)]
            let _ = event; // debug 构建不管理 sidecar 生命周期
        });
}

/// 让 OS 分配空闲端口，spawn sidecar 二进制（tauri externalBin 产物）。
#[cfg(not(debug_assertions))]
fn start_sidecar() -> (u16, String, u32) {
    let port = std::net::TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .unwrap_or(47911);
    let token = uuid::Uuid::new_v4().to_string();
    let data_dir = dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("ai.appchain.siftory");
    let child = std::process::Command::new("siftory-agent")
        .arg("--port")
        .arg(port.to_string())
        .arg("--data-dir")
        .arg(&data_dir)
        .env("SIFTORY_TOKEN", &token)
        .spawn()
        .expect("spawn siftory-agent sidecar");
    (port, token, child.id())
}
