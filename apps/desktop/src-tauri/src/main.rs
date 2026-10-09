//! Native shell owns the sidecar; the frontend reacquires its connection after reload/restart.
use serde::Serialize;
use std::sync::{Arc, Mutex};
#[cfg(any(not(debug_assertions), feature = "managed-sidecar"))]
use tauri::Manager;

#[derive(Clone, Serialize)]
struct Connection {
    port: u16,
    token: Option<String>,
}
#[derive(Default)]
struct AgentState {
    connection: Option<Connection>,
    error: Option<String>,
    stopping: bool,
    _ownership: Option<std::fs::File>,
}
type SharedAgent = Arc<Mutex<AgentState>>;

#[tauri::command]
fn agent_connection(state: tauri::State<'_, SharedAgent>) -> Result<Connection, String> {
    let state = state.lock().map_err(|_| "Agent state unavailable")?;
    state.connection.clone().ok_or_else(|| {
        state
            .error
            .clone()
            .unwrap_or_else(|| "Agent is starting".into())
    })
}

#[cfg(any(not(debug_assertions), feature = "managed-sidecar"))]
mod sidecar {
    use super::*;
    use fs2::FileExt;
    use std::{
        fs::OpenOptions,
        io::{BufRead, BufReader, Write},
        path::Path,
        process::{Child, Command, Stdio},
        sync::mpsc,
        time::{Duration, Instant},
    };

    fn spawn(binary: &Path, directory: &Path, token: &str) -> Result<(Child, Connection), String> {
        let mut child = Command::new(binary)
            .args(["--port", "0", "--data-dir"])
            .arg(directory)
            .env("SIFTORY_TOKEN", token)
            .env("SIFTORY_PARENT_WATCH", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|error| format!("Cannot start Agent: {error}"))?;
        let output = child.stdout.take().ok_or("Cannot read Agent readiness")?;
        let (sender, receiver) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(output).lines().map_while(Result::ok) {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) {
                    if value["type"] == "ready" {
                        if let Some(port) = value["port"]
                            .as_u64()
                            .filter(|port| *port > 0 && *port <= 65535)
                        {
                            let _ = sender.send(port as u16);
                        }
                    }
                }
            }
        });
        match receiver.recv_timeout(Duration::from_secs(20)) {
            Ok(port) => Ok((
                child,
                Connection {
                    port,
                    token: Some(token.into()),
                },
            )),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                Err(format!("Agent readiness failed: {error}"))
            }
        }
    }

    fn stop(child: &mut Child, connection: &Connection) {
        let address = ([127, 0, 0, 1], connection.port).into();
        if let Ok(mut stream) =
            std::net::TcpStream::connect_timeout(&address, Duration::from_millis(500))
        {
            let _ = stream.set_write_timeout(Some(Duration::from_millis(500)));
            let _ = write!(stream, "POST /api/shutdown HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n", connection.token.as_deref().unwrap_or(""));
        }
        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline {
            if matches!(child.try_wait(), Ok(Some(_))) {
                return;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let _ = child.kill();
        let _ = child.wait();
    }

    pub fn start(
        app: &tauri::App,
        state: SharedAgent,
    ) -> Result<std::thread::JoinHandle<()>, Box<dyn std::error::Error>> {
        let directory = app.path().app_data_dir()?;
        std::fs::create_dir_all(&directory)?;
        let lock = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(directory.join("desktop.lock"))?;
        lock.try_lock_exclusive()
            .map_err(|_| "Siftory is already running")?;
        // Tauri bundles externalBin beside the application executable, including Contents/MacOS.
        let executable = std::env::current_exe()?;
        let binary = executable
            .parent()
            .ok_or("Application directory unavailable")?
            .join(if cfg!(windows) {
                "siftory-agent.exe"
            } else {
                "siftory-agent"
            });
        if !binary.is_file() {
            return Err(format!("Bundled Agent missing: {}", binary.display()).into());
        }
        state.lock().unwrap()._ownership = Some(lock);
        Ok(std::thread::spawn(move || {
            let mut failures = 0;
            loop {
                if state.lock().unwrap().stopping {
                    break;
                }
                let token = uuid::Uuid::new_v4().to_string();
                match spawn(&binary, &directory, &token) {
                    Ok((mut child, connection)) => {
                        let started = Instant::now();
                        {
                            let mut shared = state.lock().unwrap();
                            shared.connection = Some(connection.clone());
                            shared.error = None;
                        }
                        loop {
                            if state.lock().unwrap().stopping {
                                stop(&mut child, &connection);
                                return;
                            }
                            match child.try_wait() {
                                Ok(None) => std::thread::sleep(Duration::from_millis(100)),
                                Ok(Some(_)) => break,
                                Err(_) => {
                                    stop(&mut child, &connection);
                                    break;
                                }
                            }
                        }
                        if started.elapsed() > Duration::from_secs(60) {
                            failures = 0;
                        }
                    }
                    Err(error) => {
                        state.lock().unwrap().error = Some(error);
                    }
                }
                failures += 1;
                {
                    let mut shared = state.lock().unwrap();
                    shared.connection = None;
                    shared.error = Some(
                        if failures >= 3 {
                            "Agent repeatedly failed; restart Siftory"
                        } else {
                            "Agent restarted; reconnecting"
                        }
                        .into(),
                    );
                }
                if failures >= 3 {
                    break;
                }
                for _ in 0..10 {
                    if state.lock().unwrap().stopping {
                        return;
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
            }
        }))
    }
    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn bundled_sidecar_handshake_and_graceful_shutdown() {
            let binary = std::env::var_os("SIFTORY_TEST_AGENT")
                .expect("Set SIFTORY_TEST_AGENT to the compiled sidecar");
            let directory =
                std::env::temp_dir().join(format!("siftory-native-{}", uuid::Uuid::new_v4()));
            let (mut child, connection) =
                spawn(Path::new(&binary), &directory, "native-test-token").unwrap();
            assert!(connection.port > 0);
            stop(&mut child, &connection);
            assert!(child.wait().unwrap().success());
            std::fs::remove_dir_all(directory).unwrap();
        }
    }
}

fn main() {
    let state: SharedAgent = Arc::new(Mutex::new(AgentState::default()));
    let worker = Arc::new(Mutex::new(None::<std::thread::JoinHandle<()>>));
    let setup_state = state.clone();
    let setup_worker = worker.clone();
    tauri::Builder::default()
        .manage(state.clone())
        .invoke_handler(tauri::generate_handler![agent_connection])
        .setup(move |app| {
            #[cfg(any(not(debug_assertions), feature = "managed-sidecar"))]
            {
                *setup_worker.lock().unwrap() = Some(sidecar::start(app, setup_state.clone())?);
            }
            #[cfg(all(debug_assertions, not(feature = "managed-sidecar")))]
            {
                setup_state.lock().unwrap().connection = Some(Connection {
                    port: 47911,
                    token: None,
                });
                let _ = (app, &setup_worker);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("build Siftory")
        .run(move |_app, event| {
            if let tauri::RunEvent::Exit = event {
                state.lock().unwrap().stopping = true;
                if let Some(worker) = worker.lock().unwrap().take() {
                    let _ = worker.join();
                }
            }
        });
}
