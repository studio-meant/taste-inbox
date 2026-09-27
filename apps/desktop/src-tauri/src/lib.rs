use serde_json::Value;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use url::Url;

const BRIDGE_TIMEOUT: Duration = Duration::from_secs(30);

fn repository_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

async fn run_bridge(request: Value) -> Result<Value, String> {
    let root = repository_root();
    let api = root.join("apps/api");
    let python = api.join(".venv/bin/python");
    if !python.is_file() {
        return Err(
            "Python 데이터 도우미가 준비되지 않았어요. bootstrap을 다시 실행해 주세요.".into(),
        );
    }

    let mut child = Command::new(python)
        .arg("-m")
        .arg("taste_inbox.desktop.bridge")
        .current_dir(api)
        .env("PYTHONPATH", root.join("apps/api/src"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| "Python 데이터 도우미를 시작하지 못했어요.".to_string())?;

    let input = serde_json::to_vec(&request)
        .map_err(|_| "데스크톱 요청을 직렬화하지 못했어요.".to_string())?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Python 데이터 도우미의 입력을 열지 못했어요.".to_string())?;
    stdin
        .write_all(&input)
        .await
        .map_err(|_| "Python 데이터 도우미에 요청을 보내지 못했어요.".to_string())?;
    drop(stdin);

    let output = tokio::time::timeout(BRIDGE_TIMEOUT, child.wait_with_output())
        .await
        .map_err(|_| "데스크톱 데이터 요청 시간이 초과됐어요.".to_string())?
        .map_err(|_| "Python 데이터 도우미의 응답을 받지 못했어요.".to_string())?;
    if !output.status.success() {
        return Err("Python 데이터 도우미가 요청을 마치지 못했어요.".into());
    }
    serde_json::from_slice(&output.stdout)
        .map_err(|_| "Python 데이터 도우미의 응답을 읽지 못했어요.".to_string())
}

#[tauri::command]
async fn bridge_request(request: Value) -> Result<Value, String> {
    run_bridge(request).await
}

fn validated_external_url(raw: &str) -> Result<Url, String> {
    let parsed = Url::parse(raw).map_err(|_| "열 수 없는 링크예요.".to_string())?;
    match parsed.scheme() {
        "http" | "https" if parsed.host().is_some() => Ok(parsed),
        "mailto" if !parsed.path().is_empty() => Ok(parsed),
        _ => Err("웹 또는 이메일 링크만 열 수 있어요.".into()),
    }
}

#[tauri::command]
async fn open_external(url: String) -> Result<(), String> {
    let destination = validated_external_url(&url)?;

    #[cfg(target_os = "macos")]
    {
        let status = Command::new("/usr/bin/open")
            .arg(destination.as_str())
            .status()
            .await
            .map_err(|_| "기본 브라우저를 실행하지 못했어요.".to_string())?;
        return status
            .success()
            .then_some(())
            .ok_or_else(|| "기본 브라우저에서 링크를 열지 못했어요.".to_string());
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = destination;
        Err("이 데스크톱 빌드에서는 외부 링크 열기를 지원하지 않아요.".into())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![bridge_request, open_external])
        .run(tauri::generate_context!())
        .expect("Taste Inbox desktop host failed");
}

#[cfg(test)]
mod tests {
    use super::{run_bridge, validated_external_url};
    use serde_json::json;

    #[tokio::test]
    async fn bridge_reads_the_real_health_envelope_without_tcp() {
        let response = run_bridge(json!({"method": "GET", "path": "/api/health"}))
            .await
            .expect("health bridge request");

        assert_eq!(response["data"]["status"], "ok");
        assert!(response["data"]["boards"]["trends"].is_number());
    }

    #[tokio::test]
    async fn bridge_refuses_a_remote_url() {
        let response = run_bridge(json!({
            "method": "GET",
            "path": "https://example.com/api/health"
        }))
        .await
        .expect("rejected bridge request still returns an envelope");

        assert_eq!(response["error"]["code"], "desktop_request_rejected");
    }

    #[test]
    fn external_links_allow_only_os_safe_web_and_mail_destinations() {
        assert!(validated_external_url("https://music.youtube.com/search?q=test").is_ok());
        assert!(validated_external_url("mailto:hello@example.com").is_ok());
        assert!(validated_external_url("javascript:alert(1)").is_err());
        assert!(validated_external_url("file:///tmp/private.txt").is_err());
        assert!(validated_external_url("/library?day=2026-09-01").is_err());
    }
}
