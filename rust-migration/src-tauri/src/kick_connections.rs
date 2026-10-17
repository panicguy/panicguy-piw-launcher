//! One native socket per live, sharing the account HTTP client and credentials.
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::{sync::Mutex, task::JoinHandle};
use tokio_tungstenite::tungstenite::Message;

pub const MAX_LIVES: usize = 12;
pub fn targets(lives: &[String]) -> BTreeSet<String> {
    lives
        .iter()
        .filter_map(|s| crate::social_store::slug(s))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .take(MAX_LIVES)
        .collect()
}
#[derive(Clone, PartialEq, Eq)]
pub struct Live {
    pub slug: String,
    pub channel: u64,
    pub stream: u64,
    pub chatroom: u64,
}
struct Connection {
    live: Live,
    connected: Arc<AtomicBool>,
    error: Arc<Mutex<String>>,
    task: JoinHandle<()>,
}
impl Drop for Connection {
    fn drop(&mut self) {
        self.task.abort();
    }
}
#[derive(Default)]
pub struct Connections {
    accounts: Mutex<BTreeMap<usize, BTreeMap<String, Connection>>>,
}
impl Connections {
    pub async fn retain(&self, index: usize, keep: &BTreeSet<String>) {
        if let Some(entries) = self.accounts.lock().await.get_mut(&index) {
            entries.retain(|slug, _| keep.contains(slug));
        }
    }
    pub async fn joined(&self, index: usize) -> Vec<String> {
        self.accounts
            .lock()
            .await
            .get(&index)
            .map(|entries| {
                entries
                    .iter()
                    .filter(|(_, c)| c.connected.load(Ordering::Relaxed))
                    .map(|(slug, _)| slug.clone())
                    .collect()
            })
            .unwrap_or_default()
    }
    pub async fn errors(&self, index: usize) -> BTreeMap<String, String> {
        let all = self.accounts.lock().await;
        let mut result = BTreeMap::new();
        if let Some(entries) = all.get(&index) {
            for (slug, entry) in entries {
                let error = entry.error.lock().await.clone();
                if !error.is_empty() {
                    result.insert(slug.clone(), error);
                }
            }
        }
        result
    }
    pub async fn sync(
        &self,
        index: usize,
        token: String,
        user: u64,
        lives: Vec<Live>,
    ) -> Result<(), String> {
        let client = crate::account_proxy::http_client(
            index,
            reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(15)),
        )?;
        let token = Arc::new(token);
        let mut all = self.accounts.lock().await;
        let entries = all.entry(index).or_default();
        let keep: BTreeSet<_> = lives
            .iter()
            .take(MAX_LIVES)
            .map(|l| l.slug.clone())
            .collect();
        entries.retain(|slug, _| keep.contains(slug));
        for live in lives.into_iter().take(MAX_LIVES) {
            if entries
                .get(&live.slug)
                .map(|c| c.live == live && !c.task.is_finished())
                .unwrap_or(false)
            {
                continue;
            }
            let connected = Arc::new(AtomicBool::new(false));
            let error = Arc::new(Mutex::new(String::new()));
            let failure = error.clone();
            let state = connected.clone();
            let auth = token.clone();
            let http = client.clone();
            let info = live.clone();
            let task = tokio::spawn(async move {
                // Fail closed. The next authenticated refresh obtains fresh metadata/token.
                let result: Result<(), String> = async {
                    let url = viewer_url(&http, &auth, user, &info).await?;
                    let (socket, _) =
                        crate::account_proxy::websocket_request(index, url.as_str()).await?;
                    pump(socket, &info, state.clone()).await?;
                    Err("Conexão Kick encerrada; aguardando nova consulta autenticada.".into())
                }
                .await;
                if let Err(message) = result {
                    *failure.lock().await = message;
                }
                state.store(false, Ordering::Relaxed);
            });
            entries.insert(
                live.slug.clone(),
                Connection {
                    live,
                    connected,
                    error,
                    task,
                },
            );
        }
        Ok(())
    }
}
async fn viewer_url(
    client: &reqwest::Client,
    auth: &str,
    user: u64,
    live: &Live,
) -> Result<url::Url, String> {
    let response = client
        .get("https://websockets.kick.com/viewer/v1/token")
        .bearer_auth(auth)
        .header("Accept", "application/json")
        .header("Origin", "https://kick.com")
        .header("X-Chatroom", live.chatroom)
        .header("X-User-Id", user)
        .header("x-app-platform", "web")
        .header(
            "X-Client-Token",
            "e1393935a959b4020a4491574f6490129f678acdaa92760471263db43487f823",
        )
        .send()
        .await
        .map_err(|_| "Token Kick indisponível")?;
    if !response.status().is_success() {
        return Err("Token Kick recusado".into());
    }
    let body: Value = response.json().await.map_err(|_| "Token Kick inválido")?;
    let token = [
        "/data/token",
        "/token",
        "/data/websocket_token",
        "/websocket_token",
    ]
    .iter()
    .find_map(|p| body.pointer(p).and_then(Value::as_str))
    .ok_or("Token Kick ausente")?;
    let mut url = url::Url::parse("wss://websockets.kick.com/viewer/v1/connect").unwrap();
    url.query_pairs_mut().append_pair("token", token);
    Ok(url)
}
/// Shared by production and the load experiment; connection alone is not points proof.
pub async fn pump<S>(
    mut socket: tokio_tungstenite::WebSocketStream<S>,
    live: &Live,
    connected: Arc<AtomicBool>,
) -> Result<(), String>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    // Complete the handshake before the first tracking event.
    for body in [
        json!({"type":"channel_handshake","data":{"message":{"channelId":live.channel}}}),
        json!({"type":"ping"}),
        json!({"type":"user_event","data":{"message":{"name":"tracking.user.watch.livestream","channel_id":live.channel,"livestream_id":live.stream}}}),
    ] {
        socket.send(Message::Text(body.to_string().into())).await.map_err(|_|"Conexão Kick encerrada")?;
    }
    let mut ping = tokio::time::interval_at(tokio::time::Instant::now()+Duration::from_secs(30),Duration::from_secs(30));
    let mut watch = tokio::time::interval_at(tokio::time::Instant::now()+Duration::from_secs(120),Duration::from_secs(120));
    let mut last = tokio::time::Instant::now();
    loop {
        tokio::select! {
            _ = ping.tick() => {
                if last.elapsed() > Duration::from_secs(90) { break; }
                for body in [json!({"type":"channel_handshake","data":{"message":{"channelId":live.channel}}}),json!({"type":"ping"})] {
                    socket.send(Message::Text(body.to_string().into())).await.map_err(|_|"Conexão Kick encerrada")?;
                }
            }
            _ = watch.tick() => {
                socket.send(Message::Text(json!({"type":"user_event","data":{"message":{"name":"tracking.user.watch.livestream","channel_id":live.channel,"livestream_id":live.stream}}}).to_string().into())).await.map_err(|_|"Conexão Kick encerrada")?;
            }
            message = socket.next() => match message {
                Some(Ok(Message::Text(text))) => {
                    let kind = serde_json::from_str::<Value>(&text).ok().and_then(|v|v["type"].as_str().map(String::from)).unwrap_or_else(||text.to_string());
                    if kind == "pong" || kind == "ping" { last = tokio::time::Instant::now(); connected.store(true, Ordering::Relaxed); }
                    if kind == "ping" { socket.send(Message::Text(json!({"type":"pong"}).to_string().into())).await.map_err(|_|"Conexão Kick encerrada")?; }
                }
                Some(Ok(Message::Ping(data))) => { last = tokio::time::Instant::now(); socket.send(Message::Pong(data)).await.map_err(|_|"Conexão Kick encerrada")?; }
                Some(Ok(Message::Pong(_))) => { last = tokio::time::Instant::now(); }
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                _ => {}
            }
        }
    }
    connected.store(false, Ordering::Relaxed);
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn targets_are_unique_and_bounded_per_account() {
        let mut input: Vec<_> = (0..48).map(|i| format!("channel{i}")).collect();
        input.push("channel0".into());
        input.push("../bad".into());
        let result = targets(&input);
        assert_eq!(result.len(), 12);
        assert!(!result.contains("../bad"));
    }
    #[tokio::test]
    async fn accounts_are_isolated() {
        let connections = Connections::default();
        let task = || Connection {
            live: Live {
                slug: "channel".into(),
                channel: 1,
                stream: 2,
                chatroom: 3,
            },
            connected: Arc::new(AtomicBool::new(true)),
            error: Arc::new(Mutex::new(String::new())),
            task: tokio::spawn(std::future::pending()),
        };
        for i in 0..4 {
            connections
                .accounts
                .lock()
                .await
                .insert(i, BTreeMap::from([("channel".into(), task())]));
        }
        connections.retain(1, &BTreeSet::new()).await;
        assert!(connections.joined(1).await.is_empty());
        for i in [0, 2, 3] {
            assert_eq!(connections.joined(i).await, vec!["channel"]);
        }
    }
    #[tokio::test]
    async fn connection_requires_a_reply_and_clears_on_close() {
        let (a, b) = tokio::io::duplex(8192);
        let (client, server) = tokio::join!(
            tokio_tungstenite::client_async("ws://localhost/", a),
            tokio_tungstenite::accept_async(b)
        );
        let (client, _) = client.unwrap();
        let mut server = server.unwrap();
        let live = Live {
            slug: "live".into(),
            channel: 1,
            stream: 2,
            chatroom: 3,
        };
        let connected = Arc::new(AtomicBool::new(false));
        let state = connected.clone();
        let task = tokio::spawn(async move { pump(client, &live, state).await });
        tokio::time::timeout(Duration::from_secs(2), async {
            while let Some(Ok(message)) = server.next().await {
                if message.to_text().unwrap_or("").contains("\"ping\"") {
                    break;
                }
            }
        })
        .await
        .unwrap();
        assert!(!connected.load(Ordering::Relaxed));
        server
            .send(Message::Text(r#"{"type":"pong"}"#.into()))
            .await
            .unwrap();
        tokio::time::timeout(Duration::from_secs(2), async {
            while !connected.load(Ordering::Relaxed) {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        server.close(None).await.unwrap();
        tokio::time::timeout(Duration::from_secs(2), task)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert!(!connected.load(Ordering::Relaxed));
    }
}
