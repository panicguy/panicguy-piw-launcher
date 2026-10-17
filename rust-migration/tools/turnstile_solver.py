#!/usr/bin/env python3
"""PIO Nailo / Absol Launcher - Turnstile Stealth Solver & Authentication Bridge.

Solves Cloudflare Turnstile naturally on https://poke.idleworld.online/ using Camoufox stealth engine,
authenticates credentials against https://poke.idleworld.online/auth/entrar using the account/family proxy,
captures session cookies and tokens, and communicates via JSON IPC with Electron main process.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import sys
import time
import urllib.error
import urllib.request
import warnings
from enum import Enum
from typing import Any, Optional
from urllib.parse import unquote, urlsplit

warnings.filterwarnings("ignore", message=".*When using a proxy, it is heavily recommended.*")

# Configure stderr logger so stdout remains clean for pure JSON IPC
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] (turnstile_solver) %(message)s",
    datefmt="%H:%M:%S",
    stream=sys.stderr,
)
logger = logging.getLogger("turnstile_solver")

DEFAULT_LOGIN_URL = "https://poke.idleworld.online/play"
DEFAULT_API_BASE = "https://poke.idleworld.online"
DEFAULT_SITE_KEY = "0x4AAAAAAEccJgXg19_AZoDr"
DEFAULT_TIMEOUT_S = 45


class TurnstileState(str, Enum):
    UNLOADED = "UNLOADED"
    LOADING = "LOADING"
    READY = "READY"
    CHALLENGE = "CHALLENGE"
    SUCCESS = "SUCCESS"
    EXPIRED = "EXPIRED"
    ERROR = "ERROR"
    TIMEOUT = "TIMEOUT"


def format_proxy(proxy_raw: Optional[dict[str, Any] | str]) -> Optional[dict[str, Any]]:
    if not proxy_raw:
        return None
    if isinstance(proxy_raw, dict):
        # Support PIO Nailo account proxy structure { host, port, username, password, type }
        if "host" in proxy_raw and "port" in proxy_raw and proxy_raw.get("host"):
            p_type = proxy_raw.get("type", "http") or "http"
            res: dict[str, Any] = {"server": f"{p_type}://{proxy_raw['host']}:{proxy_raw['port']}"}
            if proxy_raw.get("username"):
                res["username"] = str(proxy_raw["username"])
            if proxy_raw.get("password"):
                res["password"] = str(proxy_raw["password"])
            return res

        server = proxy_raw.get("server") or proxy_raw.get("url")
        if not server or "REPLACE" in str(server).upper():
            return None
        res: dict[str, Any] = {"server": str(server)}
        if proxy_raw.get("username"):
            res["username"] = str(proxy_raw["username"])
        if proxy_raw.get("password"):
            res["password"] = str(proxy_raw["password"])
        return res

    if isinstance(proxy_raw, str):
        proxy_str = proxy_raw.strip()
        if not proxy_str or "REPLACE" in proxy_str.upper():
            return None

        # Compact format ip:port:user:pass
        parts = proxy_str.split(":")
        if len(parts) == 4 and not ("://" in proxy_str):
            host, port, user, pwd = parts
            return {
                "server": f"http://{host}:{port}",
                "username": user,
                "password": pwd,
            }
        elif len(parts) == 2 and not ("://" in proxy_str):
            host, port = parts
            return {"server": f"http://{host}:{port}"}

        parsed = urlsplit(proxy_str if "://" in proxy_str else f"http://{proxy_str}")
        server_url = f"{parsed.scheme or 'http'}://{parsed.hostname}:{parsed.port or 8080}"
        res = {"server": server_url}
        if parsed.username:
            res["username"] = unquote(parsed.username)
        if parsed.password:
            res["password"] = unquote(parsed.password)
        return res
    return None


def create_proxy_opener(formatted_proxy: Optional[dict[str, Any]]) -> urllib.request.OpenerDirector:
    if formatted_proxy:
        server = formatted_proxy["server"].replace("http://", "").replace("https://", "")
        user = formatted_proxy.get("username", "")
        pwd = formatted_proxy.get("password", "")
        if user and pwd:
            proxy_url = f"http://{user}:{pwd}@{server}"
        else:
            proxy_url = f"http://{server}"
        return urllib.request.build_opener(urllib.request.ProxyHandler({"http": proxy_url, "https": proxy_url}))
    return urllib.request.build_opener()


async def get_turnstile_site_key(api_base: str, formatted_proxy: Optional[dict[str, Any]] = None) -> tuple[bool, str]:
    """Fetch security configuration from backend, routed through proxy if present."""
    opener = create_proxy_opener(formatted_proxy)
    try:
        url = f"{api_base.rstrip('/')}/auth/provedores"
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
                "X-PokeIdle-Client": "web",
                "X-PokeIdle-Client-Version": "2026.07.26-sync-guard-v1",
            },
        )
        with opener.open(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if "turnstile" in data:
                site_key = str(data.get("turnstile") or DEFAULT_SITE_KEY)
                return bool(site_key), site_key
    except Exception:
        pass

    try:
        url = f"{api_base.rstrip('/')}/auth/security-config"
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
                "X-PokeIdle-Client": "web",
                "X-PokeIdle-Client-Version": "2026.07.26-sync-guard-v1",
            },
        )
        with opener.open(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            enabled = bool(data.get("turnstile_enabled", True))
            site_key = str(data.get("turnstile_site_key", DEFAULT_SITE_KEY))
            return enabled, site_key
    except Exception as ex:
        logger.warning("Could not fetch security-config: %s. Using default sitekey.", ex)
        return True, DEFAULT_SITE_KEY


async def solve_turnstile_stealth(
    login_url: str,
    site_key: str,
    timeout_s: int,
    headless: bool = True,
    proxy: Optional[dict[str, Any] | str] = None,
    action: str = "login",
) -> str:
    """Launch Camoufox in stealth mode to solve Turnstile natively on game domain."""
    from camoufox.async_api import AsyncCamoufox
    from camoufox import DefaultAddons

    formatted_proxy = format_proxy(proxy)
    proxy_args: dict[str, Any] = {}
    if formatted_proxy:
        proxy_args["proxy"] = formatted_proxy

    html_content = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>PokeIdle Clearance</title>
    <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
</head>
<body style="background: #111; color: white; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;">
    <div id="cf-mount" class="cf-turnstile" data-sitekey="{site_key}" data-action="{action}" data-theme="dark" data-callback="onSuccess" data-error-callback="onError"></div>
    <script>
        window.__cf_token = null;
        window.__cf_err = null;
        window.onSuccess = function(tok) {{
            window.__cf_token = tok;
        }};
        window.onError = function(err) {{
            window.__cf_err = String(err);
        }};
    </script>
</body>
</html>"""

    async with AsyncCamoufox(
        headless=headless,
        humanize=True,
        window=(1280, 800),
        exclude_addons=[DefaultAddons.UBO],
        **proxy_args
    ) as browser:
        page = await browser.new_page()

        # Intercept route to serve lightweight Turnstile page directly on domain without heavy WebGL / canvas crashes
        parsed_target = urlsplit(login_url)
        target_domain = parsed_target.netloc or "poke.idleworld.online"
        target_scheme = parsed_target.scheme or "https"
        await page.route(f"{target_scheme}://{target_domain}/**", lambda route: route.fulfill(
            status=200,
            content_type="text/html",
            body=html_content
        ))

        logger.info("Opening %s for Turnstile clearance (action=%s, proxy=%s)...", login_url, action, bool(formatted_proxy))
        await page.goto(login_url, wait_until="domcontentloaded", timeout=timeout_s * 1000)

        import random

        # Poll for token resolution
        deadline = time.monotonic() + timeout_s
        clicks = 0
        last_click_at = 0.0

        # Human initial observation delay
        await page.wait_for_timeout(int(random.uniform(900, 1600)))

        while time.monotonic() < deadline:
            await page.wait_for_timeout(int(random.uniform(600, 1100)))

            token = await page.evaluate("""() => {
                if (window.__cf_token) return window.__cf_token;
                const el = document.querySelector('[name="cf-turnstile-response"]');
                if (el && el.value) return el.value;
                return null;
            }""")
            if token:
                logger.info("Turnstile solved successfully (%d chars)!", len(token))
                await asyncio.sleep(random.uniform(0.35, 0.85))
                return token

            # Click frame element with natural human hesitation
            now = time.monotonic()
            if (clicks == 0 or (now - last_click_at >= random.uniform(2.5, 4.5))) and clicks < 4:
                for f in page.frames:
                    if "cloudflare" in f.url or "turnstile" in f.url:
                        try:
                            loc = f.locator("body")
                            box = await loc.bounding_box()
                            if box and box.get("width", 0) > 0:
                                logger.info("Clicking Turnstile challenge frame with humanized motion...")
                                await asyncio.sleep(random.uniform(0.2, 0.6))
                                await loc.click(delay=int(random.uniform(45, 130)))
                                clicks += 1
                                last_click_at = time.monotonic()
                                break
                        except Exception as click_err:
                            logger.warning("Click attempt failed: %s", click_err)

        raise RuntimeError(f"Turnstile challenge not solved within timeout ({timeout_s}s)")


def submit_login_request(
    api_base: str,
    email: str,
    password: str,
    captcha_token: str,
    formatted_proxy: Optional[dict[str, Any]],
) -> dict[str, Any]:
    """Submit authentication request to backend, routed through assigned proxy."""
    if "poke.idleworld.online" in api_base or not ("/api/v1" in api_base):
        url = f"{api_base.rstrip('/')}/auth/entrar"
        payload = json.dumps({
            "id": email,
            "senha": password,
            "turnstileToken": captcha_token,
        }).encode("utf-8")
    else:
        url = f"{api_base.rstrip('/')}/auth/login"
        payload = json.dumps({
            "login": email,
            "password": password,
            "captcha_token": captcha_token,
        }).encode("utf-8")

    parsed_req = urlsplit(url)
    origin = f"{parsed_req.scheme}://{parsed_req.netloc}"
    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
            "Origin": origin,
            "Referer": f"{origin}/app",
            "X-PokeIdle-Client": "web",
            "X-PokeIdle-Client-Version": "2026.07.26-sync-guard-v1",
        },
    )

    opener = create_proxy_opener(formatted_proxy)
    try:
        with opener.open(req, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            cookies_header = resp.headers.get_all("Set-Cookie") or []
            return {
                "status": resp.status,
                "data": data,
                "cookies_header": cookies_header,
            }
    except urllib.error.HTTPError as he:
        body = he.read().decode("utf-8", errors="replace")
        try:
            err_data = json.loads(body)
        except Exception:
            err_data = {"error": body}
        return {
            "status": he.code,
            "data": err_data,
            "cookies_header": [],
        }
    except Exception as ex:
        return {
            "status": 0,
            "data": {"error": str(ex)},
            "cookies_header": [],
        }


async def solve_turnstile_and_authenticate(
    email: str,
    password: str,
    login_url: str = DEFAULT_LOGIN_URL,
    proxy: Optional[dict[str, Any] | str] = None,
    timeout_s: int = DEFAULT_TIMEOUT_S,
    headless: bool = True,
) -> dict[str, Any]:
    """Solve Turnstile and submit authenticated login with proxy routing."""
    formatted_proxy = format_proxy(proxy)
    masked_email = email[:2] + "****" + email[email.find("@") - 1:] if "@" in email else "****"
    logger.info("Initializing stealth solver for %s (proxy=%s, headless=%s)...", masked_email, bool(formatted_proxy), headless)

    api_base = DEFAULT_API_BASE
    if "/play" in login_url:
        parsed_url = urlsplit(login_url)
        api_base = f"{parsed_url.scheme}://{parsed_url.netloc}/api/v1"

    turnstile_enabled, site_key = await get_turnstile_site_key(api_base, formatted_proxy)
    logger.info("Turnstile config: enabled=%s, sitekey=%s", turnstile_enabled, site_key)

    total_start = time.monotonic()
    captcha_token = ""

    if turnstile_enabled:
        proxy_desc = formatted_proxy['server'] if formatted_proxy else 'direct'
        logger.info("Solving Turnstile clearance on %s via %s (headless=%s)...", login_url, proxy_desc, headless)
        captcha_token = await solve_turnstile_stealth(
            login_url=login_url,
            site_key=site_key,
            timeout_s=timeout_s,
            headless=headless,
            proxy=formatted_proxy if formatted_proxy else None,
            action="login",
        )

    # Submit login credentials to backend through assigned proxy
    proxy_desc = formatted_proxy['server'] if formatted_proxy else 'direct'
    logger.info("Submitting authentication request to %s via %s...", api_base, proxy_desc)
    resp = submit_login_request(api_base, email, password, captcha_token, formatted_proxy)
    http_status = resp.get("status", 0)
    data = resp.get("data") or {}

    if http_status != 200:
        logger.warning("Auth endpoint returned HTTP %s: %s", http_status, data)
        err_obj = data.get("error") if isinstance(data.get("error"), dict) else {}
        err_code = err_obj.get("code") or data.get("code") or data.get("erro") or ""
        err_msg = err_obj.get("message") or data.get("message") or data.get("erro") or ""
        motivo_ban = data.get("motivoBan", "")
        err_combined = f"{err_code} {err_msg} {motivo_ban}".lower()

        if "contabanida" in err_combined or "banid" in err_combined:
            motivo = f" - Motivo: {motivo_ban}" if motivo_ban else ""
            raise RuntimeError(f"Conta banida no Pokéidle{motivo} [HTTP {http_status}]")
        elif "confirmeemail" in err_combined or "emailnaoconfirmado" in err_combined or "naoconfirmado" in err_combined:
            raise RuntimeError(f"E-mail ainda não confirmado no Pokéidle [HTTP {http_status}]")
        elif "muitastentativas" in err_combined:
            raise RuntimeError(f"Muitas tentativas no login. Aguarde um minuto [HTTP {http_status}]")
        elif err_code == "INVALID_CREDENTIALS" or "senhainvalida" in err_combined or "usuarioinexistente" in err_combined or "credenciaisinvalidas" in err_combined:
            raise RuntimeError(f"Credenciais inválidas: e-mail ou senha incorretos [HTTP {http_status}]")
        elif http_status == 401:
            raise RuntimeError(f"Acesso não autorizado / Credenciais rejeitadas [HTTP 401: {data}]")
        elif http_status == 429:
            raise RuntimeError(f"Rate limit atingido no servidor [HTTP 429: {data}]")
        elif http_status == 403:
            raise RuntimeError(f"Acesso bloqueado por segurança ({err_msg or 'Cloudflare/Forbidden'}) [HTTP 403: {data}]")
        else:
            raise RuntimeError(f"Erro na autenticação ({err_code or err_msg or f'HTTP {http_status}'}) [{data}]")

    access_token = data.get("access_token") or data.get("token") or ""
    refresh_token = data.get("refresh_token") or ""
    client_signing_key = data.get("client_signing_key") or data.get("signing_key") or ""
    user_info = data.get("user") or {}

    # Extract pi_refresh cookie if refresh_token was empty in JSON body
    if not refresh_token:
        for c_header in resp.get("cookies_header", []):
            if "pi_refresh=" in c_header:
                start = c_header.find("pi_refresh=") + len("pi_refresh=")
                end = c_header.find(";", start)
                refresh_token = c_header[start : end if end != -1 else len(c_header)].strip()
                break

    # Parse cookies from headers
    cookies = []
    for c_header in resp.get("cookies_header", []):
        parts = c_header.split(";")
        if parts:
            name_val = parts[0].split("=", 1)
            if len(name_val) == 2:
                cookies.append({
                    "name": name_val[0].strip(),
                    "value": name_val[1].strip(),
                })

    if refresh_token and not any(c.get("name") == "pi_refresh" for c in cookies):
        cookies.append({"name": "pi_refresh", "value": refresh_token})

    elapsed_ms = int((time.monotonic() - total_start) * 1000)
    logger.info("Authentication succeeded in %d ms! User: %s", elapsed_ms, user_info.get("id") or user_info.get("name") or "OK")

    return {
        "success": True,
        "access_token": access_token,
        "refresh_token": refresh_token,
        "client_signing_key": client_signing_key,
        "turnstile_token": captcha_token,
        "cookies": cookies,
        "user": user_info,
        "sessao": data,
        "elapsed_ms": elapsed_ms,
        "turnstile_state": TurnstileState.SUCCESS.value,
        "turnstile_clicks": 0,
    }


def run_self_test() -> int:
    """Run internal test suite without requiring browser execution."""
    logger.info("Running Turnstile Solver internal self-test...")

    p1 = format_proxy("127.0.0.1:8080:user:pass")
    assert p1 == {"server": "http://127.0.0.1:8080", "username": "user", "password": "pass"}, f"Failed p1: {p1}"

    p2 = format_proxy("http://proxy.example.com:9000")
    assert p2 == {"server": "http://proxy.example.com:9000"}, f"Failed p2: {p2}"

    p3 = format_proxy({"host": "1.2.3.4", "port": 3128, "username": "u", "password": "p", "type": "http"})
    assert p3 == {"server": "http://1.2.3.4:3128", "username": "u", "password": "p"}, f"Failed p3: {p3}"

    res_dict = {
        "success": True,
        "access_token": "test_token_123",
        "client_signing_key": "test_key",
        "elapsed_ms": 1500,
    }
    dumped = json.dumps(res_dict)
    assert json.loads(dumped)["success"] is True

    logger.info("Turnstile Solver self-test passed successfully.")
    print(json.dumps({"success": True, "self_test": "PASSED"}))
    return 0


async def main_async() -> int:
    if "--self-test" in sys.argv:
        return run_self_test()

    raw_input = ""
    try:
        if "--json-b64" in sys.argv:
            idx = sys.argv.index("--json-b64")
            if idx + 1 < len(sys.argv):
                raw_input = base64.b64decode(sys.argv[idx + 1]).decode("utf-8")
        elif "--json" in sys.argv:
            idx = sys.argv.index("--json")
            if idx + 1 < len(sys.argv):
                raw_input = sys.argv[idx + 1]

        if not raw_input:
            raw_input = sys.stdin.read()

        if not raw_input.strip():
            logger.error("No input provided via argument or stdin.")
            print(json.dumps({"success": False, "error": "No input provided via argument or stdin."}))
            return 1

        data = json.loads(raw_input)
    except Exception as exc:
        logger.exception("Failed to parse JSON input: %s", exc)
        print(json.dumps({"success": False, "error": f"Invalid JSON input: {exc}"}))
        return 1

    mode = str(data.get("mode", "login")).strip().lower()
    email = str(data.get("email", "")).strip()
    password = str(data.get("password", ""))
    login_url = str(data.get("login_url", DEFAULT_LOGIN_URL)).strip()
    proxy = data.get("proxy")
    timeout_s = int(data.get("timeout_s", DEFAULT_TIMEOUT_S))
    headless = bool(data.get("headless", True))

    action = str(data.get("action", "criar" if mode == "solve_only" else "entrar")).strip()
    formatted_proxy = format_proxy(proxy)
    if mode == "solve_only" or "--solve-only" in sys.argv:
        try:
            start_t = time.monotonic()
            _, site_key = await get_turnstile_site_key(DEFAULT_API_BASE, formatted_proxy)
            token = await solve_turnstile_stealth(
                login_url,
                site_key,
                timeout_s=timeout_s,
                headless=headless,
                proxy=formatted_proxy if formatted_proxy else None,
                action=action
            )

            elapsed_ms = int((time.monotonic() - start_t) * 1000)
            print(json.dumps({
                "success": True,
                "turnstile_token": token,
                "elapsed_ms": elapsed_ms,
                "turnstile_state": TurnstileState.SUCCESS.value,
            }))
            return 0
        except Exception as exc:
            logger.exception("Turnstile standalone solve failed: %s", exc)
            print(json.dumps({
                "success": False,
                "error": str(exc),
                "turnstile_state": TurnstileState.ERROR.value,
            }))
            return 1

    if not email or not password:
        err = "Missing email or password in request payload."
        logger.error(err)
        print(json.dumps({"success": False, "error": err}))
        return 1

    try:
        result = await solve_turnstile_and_authenticate(
            email=email,
            password=password,
            login_url=login_url,
            proxy=proxy,
            timeout_s=timeout_s,
            headless=headless,
        )
        print(json.dumps(result))
        return 0
    except Exception as exc:
        logger.exception("Turnstile solver authentication failed: %s", exc)
        print(json.dumps({
            "success": False,
            "error": str(exc),
            "turnstile_state": TurnstileState.ERROR.value,
        }))
        return 1


def main() -> int:
    try:
        return asyncio.run(main_async())
    except KeyboardInterrupt:
        print(json.dumps({"success": False, "error": "Cancelled by user."}))
        return 130


if __name__ == "__main__":
    sys.exit(main())
