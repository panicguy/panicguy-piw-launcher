use serde_json::Value;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
};
#[derive(Clone, PartialEq, Eq)]
pub struct Proxy {
    pub url: url::Url,
    pub username: String,
    pub password: String,
}
pub fn parse(value: Option<&Value>) -> Result<Option<Proxy>, String> {
    let Some(p) = value.filter(|p| !p.is_null()) else {
        return Ok(None);
    };
    let kind = p["type"].as_str().unwrap_or("");
    if kind.is_empty() {
        return Ok(None);
    };
    let host = p["host"].as_str().unwrap_or("");
    let port = p["port"].as_u64().unwrap_or(0);
    let username = p["username"].as_str().unwrap_or("").to_string();
    let password = p["password"].as_str().unwrap_or("").to_string();
    if !matches!(kind, "http" | "socks5")
        || host.is_empty()
        || !host
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
        || !(1..=65535).contains(&port)
        || (kind == "socks5" && (!username.is_empty() || !password.is_empty()))
        || (username.is_empty() != password.is_empty())
    {
        return Err("Proxy inválido. Verifique servidor, porta e credenciais.".into());
    }
    Ok(Some(Proxy {
        url: url::Url::parse(&format!("{}://{}:{}", kind, host, port))
            .map_err(|_| "Proxy inválido")?,
        username,
        password,
    }))
}
pub fn for_account(index: usize) -> Result<Option<Proxy>, String> {
    let accounts = crate::credentials::load_accounts();
    parse(accounts.get(index).and_then(|a| a.proxy.as_ref()))
}
pub fn http_client(
    index: usize,
    builder: reqwest::ClientBuilder,
) -> Result<reqwest::Client, String> {
    let mut builder = builder;
    if let Some(p) = for_account(index)? {
        let mut proxy = reqwest::Proxy::all(p.url.as_str()).map_err(|_| "Proxy inválido")?;
        if !p.username.is_empty() {
            proxy = proxy.basic_auth(&p.username, &p.password);
        }
        builder = builder.proxy(proxy);
    }
    builder
        .build()
        .map_err(|_| "Falha ao configurar rede da conta".into())
}
async fn tunnel(proxy: &Proxy, target: &url::Url) -> Result<TcpStream, String> {
    let host = target.host_str().ok_or("Destino inválido")?;
    let port = target.port_or_known_default().ok_or("Porta inválida")?;
    let mut socket = TcpStream::connect((
        proxy.url.host_str().unwrap(),
        proxy.url.port_or_known_default().unwrap(),
    ))
    .await
    .map_err(|_| "Falha ao conectar ao proxy")?;
    if proxy.url.scheme() == "http" {
        use base64::Engine;
        let auth = if proxy.username.is_empty() {
            String::new()
        } else {
            format!(
                "Proxy-Authorization: Basic {}\r\n",
                base64::engine::general_purpose::STANDARD
                    .encode(format!("{}:{}", proxy.username, proxy.password))
            )
        };
        socket
            .write_all(
                format!(
                    "CONNECT {}:{} HTTP/1.1\r\nHost: {}:{}\r\n{}\r\n",
                    host, port, host, port, auth
                )
                .as_bytes(),
            )
            .await
            .map_err(|_| "Falha no proxy")?;
        let mut header = Vec::new();
        while !header.ends_with(b"\r\n\r\n") {
            if header.len() >= 16384 {
                return Err("Resposta de proxy inválida".into());
            }
            header.push(
                socket
                    .read_u8()
                    .await
                    .map_err(|_| "Proxy encerrou a conexão")?,
            );
        }
        if String::from_utf8_lossy(&header)
            .lines()
            .next()
            .and_then(|l| l.split_whitespace().nth(1))
            != Some("200")
        {
            return Err("Proxy recusou o túnel; nenhuma conexão direta foi aberta.".into());
        }
    } else {
        socket
            .write_all(&[5, 1, 0])
            .await
            .map_err(|_| "Falha SOCKS5")?;
        let mut reply = [0; 2];
        socket
            .read_exact(&mut reply)
            .await
            .map_err(|_| "Falha SOCKS5")?;
        if reply != [5, 0] || host.len() > 255 {
            return Err("Proxy SOCKS5 recusou a conexão".into());
        }
        let mut request = vec![5, 1, 0, 3, host.len() as u8];
        request.extend_from_slice(host.as_bytes());
        request.extend_from_slice(&port.to_be_bytes());
        socket
            .write_all(&request)
            .await
            .map_err(|_| "Falha SOCKS5")?;
        let mut reply = [0; 4];
        socket
            .read_exact(&mut reply)
            .await
            .map_err(|_| "Falha SOCKS5")?;
        if reply[0] != 5 || reply[1] != 0 {
            return Err("Proxy SOCKS5 recusou o destino".into());
        }
        let size = match reply[3] {
            1 => 4,
            4 => 16,
            3 => socket.read_u8().await.map_err(|_| "Falha SOCKS5")? as usize,
            _ => return Err("Resposta SOCKS5 inválida".into()),
        };
        let mut rest = vec![0; size + 2];
        socket
            .read_exact(&mut rest)
            .await
            .map_err(|_| "Falha SOCKS5")?;
    }
    Ok(socket)
}
pub async fn websocket_request<
    R: tokio_tungstenite::tungstenite::client::IntoClientRequest + Unpin,
>(
    index: usize,
    request: R,
) -> Result<
    (
        tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<TcpStream>>,
        tokio_tungstenite::tungstenite::handshake::client::Response,
    ),
    String,
> {
    let proxy = for_account(index)?;
    let request = request
        .into_client_request()
        .map_err(|_| "Destino WebSocket inválido")?;
    tokio::time::timeout(std::time::Duration::from_secs(20), async {
        if let Some(proxy) = proxy {
            let target =
                url::Url::parse(&request.uri().to_string()).map_err(|_| "Destino inválido")?;
            let socket = tunnel(&proxy, &target).await?;
            tokio_tungstenite::client_async_tls_with_config(request, socket, None, None)
                .await
                .map_err(|_| "Falha ao conectar através do proxy".into())
        } else {
            tokio_tungstenite::connect_async(request)
                .await
                .map_err(|_| "Falha ao conectar".into())
        }
    })
    .await
    .map_err(|_| "Conexão excedeu o tempo limite".to_string())?
}
pub async fn authenticate(view: &tauri::Webview, proxy: Option<&Proxy>) -> Result<(), String> {
    #[cfg(windows)]
    if let Some(p) = proxy.filter(|p| !p.username.is_empty()) {
        let proxy = p.clone();
        let (tx, rx) = tokio::sync::oneshot::channel();
        view.with_webview(move |native| {
            use webview2_com::{
                BasicAuthenticationRequestedEventHandler, CoTaskMemPWSTR,
                Microsoft::Web::WebView2::Win32::ICoreWebView2_10,
            };
            use windows_core::Interface;
            let result = (|| -> windows_core::Result<()> {
                unsafe {
                    let core = native
                        .controller()
                        .CoreWebView2()?
                        .cast::<ICoreWebView2_10>()?;
                    let mut token = 0;
                    core.add_BasicAuthenticationRequested(
                        &BasicAuthenticationRequestedEventHandler::create(Box::new(
                            move |_, args| {
                                if let Some(args) = args {
                                    let mut uri = windows_core::PWSTR::null();
                                    args.Uri(&mut uri)?;
                                    let uri = CoTaskMemPWSTR::from(uri).to_string();
                                    let matches = url::Url::parse(&uri)
                                        .ok()
                                        .map(|u| {
                                            u.host_str() == proxy.url.host_str()
                                                && u.port_or_known_default()
                                                    == proxy.url.port_or_known_default()
                                        })
                                        .unwrap_or(false);
                                    if matches {
                                        let response = args.Response()?;
                                        response.SetUserName(&windows_core::HSTRING::from(
                                            &proxy.username,
                                        ))?;
                                        response.SetPassword(&windows_core::HSTRING::from(
                                            &proxy.password,
                                        ))?;
                                    }
                                }
                                Ok(())
                            },
                        )),
                        &mut token,
                    )?;
                    Ok(())
                }
            })();
            let _ = tx.send(
                result.map_err(|_| "Não foi possível configurar autenticação do proxy".to_string()),
            );
        })
        .map_err(|e| e.to_string())?;
        return tokio::time::timeout(std::time::Duration::from_secs(5), rx)
            .await
            .map_err(|_| "Autenticação do proxy excedeu o tempo limite")?
            .map_err(|_| "Autenticação do proxy cancelada")?;
    }
    let _ = (view, proxy);
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn credentials_never_enter_browser_url() {
        let p=parse(Some(&json!({"type":"http","host":"127.0.0.1","port":8080,"username":"user","password":"secret"}))).unwrap().unwrap();
        assert!(!p.url.as_str().contains("user"));
        assert!(!p.url.as_str().contains("secret"));
        assert!(parse(Some(
            &json!({"type":"socks5","host":"localhost","port":1080,"username":"user"})
        ))
        .is_err());
    }
    #[tokio::test]
    async fn refused_http_tunnel_never_opens_destination() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut buffer = [0; 2048];
            let n = stream.read(&mut buffer).await.unwrap();
            assert!(
                String::from_utf8_lossy(&buffer[..n]).starts_with("CONNECT example.invalid:443")
            );
            stream
                .write_all(
                    b"HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n",
                )
                .await
                .unwrap();
        });
        let proxy = Proxy {
            url: url::Url::parse(&format!("http://{}", addr)).unwrap(),
            username: String::new(),
            password: String::new(),
        };
        assert!(
            tunnel(&proxy, &url::Url::parse("wss://example.invalid").unwrap())
                .await
                .is_err()
        );
        server.await.unwrap();
    }
}
