"""Preview-only WhatsApp linking and logout monitor. Requires Playwright and Telegram connector env vars.
Run on a persistent browser host for lasting monitoring; /tmp is not permanent storage.
"""
import sys
import asyncio
import hashlib
import base64
import json
import os
import re
import uuid
from pathlib import Path
from urllib.request import Request, urlopen
from playwright.async_api import async_playwright

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

PROJECT_ROOT = Path(__file__).resolve().parent.parent if "__file__" in globals() else Path.cwd()

def load_env():
    env_file = PROJECT_ROOT / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k = k.strip()
        v = v.strip().strip('"').strip("'")
        if k not in os.environ:
            os.environ[k] = v

load_env()

SLOT = int(os.environ.get("WA_SLOT", "1"))
# Project folder survives preview restarts, unlike /tmp, so linked sessions stay logged in.
DIR = Path(os.environ.get("WA_DATA", PROJECT_ROOT / ".wa-data")) / f"slot-{SLOT}"
ORIGIN = os.environ.get("WA_APP_ORIGIN", "http://localhost:8080").rstrip("/")

def report(session_id, state):
    key = os.environ.get("TELEGRAM_API_KEY", "")
    if not key:
        return False
    secret = base64.urlsafe_b64encode(hashlib.sha256(f"wa-checker:{key}".encode()).digest()).decode().rstrip("=")
    request = Request(f"{ORIGIN}/api/public/wa-session", data=json.dumps({"sessionId": session_id, "state": state}).encode(),
                      headers={"Content-Type": "application/json", "X-Checker-Key": secret})
    try:
        with urlopen(request, timeout=30) as response:
            return json.load(response).get("ok") is True
    except Exception as e:
        print(f"report error: {e}", flush=True)
        return False

def status(data):
    path = DIR / "link-status.json"
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data))
    tmp.replace(path)

def current_state():
    try:
        return json.loads((DIR / "link-status.json").read_text()).get("state")
    except Exception:
        return None

async def capture_qr(page, phone):
    canvas = page.locator("canvas").first
    await canvas.wait_for(timeout=60000)
    png = await canvas.screenshot()
    data = {"state": "qr", "qr": "data:image/png;base64," + base64.b64encode(png).decode()}
    if phone:
        data["phone"] = phone
    else:
        try:
            old = json.loads((DIR / "link-status.json").read_text())
            if old.get("phone"):
                data["phone"] = old["phone"]
        except Exception:
            pass
    status(data)

def checker_secret():
    key = os.environ.get("TELEGRAM_API_KEY", "")
    return base64.urlsafe_b64encode(hashlib.sha256(f"wa-checker:{key}".encode()).digest()).decode().rstrip("=")

def api(method, body=None):
    request = Request(f"{ORIGIN}/api/public/wa-result?slot={SLOT}", method=method,
                      data=json.dumps(body).encode() if body is not None else None,
                      headers={"Content-Type": "application/json", "X-Checker-Key": checker_secret()})
    with urlopen(request, timeout=120) as response:
        return json.load(response)

async def safe_click(locator, page=None, name="element"):
    """Robust click that bypasses viewport boundaries and custom scroll containers."""
    try:
        await locator.scroll_into_view_if_needed(timeout=2000)
    except Exception:
        pass
    try:
        await locator.click(force=True, timeout=5000)
        return True
    except Exception:
        pass
    try:
        await locator.dispatch_event("click")
        return True
    except Exception:
        pass
    if page:
        try:
            handle = await locator.element_handle(timeout=2000)
            if handle:
                await page.evaluate("(el) => el.click()", handle)
                return True
        except Exception:
            pass
    return False

TRIGGER = re.compile(r"isn.t on WhatsApp|not on WhatsApp|invalid|Invite to WhatsApp", re.I)
CHECK_WORKERS = 1

async def check_one(page, phone):
    """Returns True (not on WhatsApp), False (on WhatsApp) or None (unclear, keep pending).
    
    Uses in-process double-confirmation: if the trigger dialog fires, we wait 2 seconds
    and re-verify before concluding unregistered. This eliminates false positives from
    transient WhatsApp Web loading states.
    """
    clean_phone = phone.lstrip('+')
    url = f"https://web.whatsapp.com/send?phone={clean_phone}"
    print(f"[{phone}] Opening {url}...", flush=True)
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=45000)
    except Exception as e:
        print(f"[{phone}] Navigation failed: {e}", flush=True)
        return None

    first_trigger_at = None
    for tick in range(120):  # up to ~36s (120 × 0.3s)
        # 1. Handle "Continue to Chat" / "Use WhatsApp Web" intermediate landing button
        continue_btn = page.locator('text=/Continue to chat|Use WhatsApp Web/i').first
        if await continue_btn.is_visible():
            print(f"[{phone}] Intermediate 'Continue to Chat' prompt found, clicking...", flush=True)
            await safe_click(continue_btn, page, "Continue to chat")
            await asyncio.sleep(1)
            continue

        # 2. Handle "Use here" prompt if another window stole session
        use_here = page.locator('button:has-text("Use Here"), div[role="button"]:has-text("Use Here"), text=/Use here/i').first
        if await use_here.is_visible():
            print(f"[{phone}] 'Use here' prompt detected, taking session...", flush=True)
            await safe_click(use_here, page, "Use here")
            await asyncio.sleep(1)
            continue

        # 3. Check for chat window (Number IS registered on WhatsApp)
        chat_box = page.locator('#main, footer div[contenteditable="true"], div[data-testid="conversation-compose-box-input"]').first
        if await chat_box.is_visible():
            print(f"[{phone}] Chat box visible (#main) -> Number IS registered on WhatsApp", flush=True)
            return False

        # 4. Check for invalid / not on WhatsApp message anywhere on page or modal (Number is NOT registered)
        unreg_el = page.locator('text=/isn.t on WhatsApp|not on WhatsApp|invalid|Invite to WhatsApp/i').first
        if await unreg_el.is_visible():
            try:
                text = (await unreg_el.inner_text()).strip()
            except Exception:
                text = ""
            if text and TRIGGER.search(text):
                if first_trigger_at is None:
                    print(f"[{phone}] Unregistered text detected: '{text}'. Confirming...", flush=True)
                    first_trigger_at = asyncio.get_event_loop().time()
                else:
                    elapsed = asyncio.get_event_loop().time() - first_trigger_at
                    if elapsed >= 2.0:
                        print(f"[{phone}] Dialog confirmed for 2s! -> UNREGISTERED on WhatsApp! 🎉", flush=True)
                        ok_btn = page.locator('button:has-text("OK"), div[role="button"]:has-text("OK")').first
                        if await ok_btn.is_visible():
                            await safe_click(ok_btn, page, "OK button")
                        return True
            elif "starting chat" in text.lower() or "connecting" in text.lower() or "loading" in text.lower():
                pass
            elif text:
                print(f"[{phone}] Dialog text: '{text}' (waiting...)", flush=True)
        elif first_trigger_at is not None:
            first_trigger_at = None

        # 5. Periodic status snippet every 4.5 seconds for visibility
        if tick > 0 and tick % 15 == 0:
            try:
                body_snippet = " ".join((await page.locator("body").inner_text()).split())[:120]
                print(f"[{phone}] [t={tick * 0.3:.1f}s] Current page text: '{body_snippet}'", flush=True)
            except Exception:
                pass

        await asyncio.sleep(0.3)

    print(f"[{phone}] Check timed out after 36s. Saving debug screenshot...", flush=True)
    try:
        await page.screenshot(path=str(DIR / "check-timeout.png"))
    except Exception:
        pass
    return None

async def check_worker(page, queue, busy):
    while True:
        phone = await queue.get()
        try:
            print(f"Checking number: {phone}...", flush=True)
            result = await check_one(page, phone)
            print(f"Check result for {phone}: {result} (found={result})", flush=True)
            if result is not None:
                resp = await asyncio.to_thread(api, "POST", {"phone": phone, "found": result})
                print(f"Saved result for {phone}: {resp}", flush=True)
            else:
                print(f"Result unclear for {phone}, leaving pending.", flush=True)
        except Exception as exc:
            import traceback
            print(f"Check failed for {phone}: {exc}", flush=True)
            traceback.print_exc()
        finally:
            busy.discard(phone)

async def check_loop(page, is_connected):
    queue, busy = asyncio.Queue(), set()
    asyncio.create_task(check_worker(page, queue, busy))
    while True:
        try:
            if is_connected() and queue.qsize() < 1:
                data = await asyncio.to_thread(api, "GET")
                for row in data.get("numbers", []):
                    if row["phone"] not in busy:
                        busy.add(row["phone"])
                        queue.put_nowait(row["phone"])
        except Exception as exc:
            print("Queue fetch failed:", type(exc).__name__, flush=True)
        await asyncio.sleep(2)
                for row in data.get("numbers", []):
                    if row["phone"] not in busy:
                        busy.add(row["phone"])
                        queue.put_nowait(row["phone"])
        except Exception as exc:
            print("Queue fetch failed:", type(exc).__name__, flush=True)
        await asyncio.sleep(2)

def parse_proxy(raw_line):
    line = raw_line.strip()
    if not line or line.startswith("#"):
        return None

    scheme = "http"
    if line.startswith("http://"):
        line = line[7:]
    elif line.startswith("https://"):
        line = line[8:]
    elif line.startswith("socks5://"):
        scheme = "socks5"
        line = line[9:]

    parts = line.split(":")
    # Format: IP:PORT:USER:PASS
    if len(parts) == 4:
        ip, port, user, password = parts
        return {
            "server": f"{scheme}://{ip}:{port}",
            "username": user,
            "password": password,
        }

    # Format: USER:PASS@IP:PORT
    if "@" in line:
        auth_part, host_part = line.split("@", 1)
        user, password = auth_part.split(":", 1) if ":" in auth_part else (auth_part, "")
        ip, port = host_part.split(":", 1) if ":" in host_part else (host_part, "80")
        return {
            "server": f"{scheme}://{ip}:{port}",
            "username": user,
            "password": password,
        }

    # Format: IP:PORT
    if len(parts) == 2:
        ip, port = parts
        return {
            "server": f"{scheme}://{ip}:{port}",
            "username": None,
            "password": None,
        }

    from urllib.parse import urlparse
    u = urlparse("http://" + line if "://" not in line else line)
    return {
        "server": f"{scheme}://{u.hostname}:{u.port}",
        "username": u.username,
        "password": u.password,
    }

def test_proxy(proxy_cfg):
    import urllib.request
    try:
        url = f"{proxy_cfg['server']}"
        clean_host = url.replace("http://", "").replace("https://", "").replace("socks5://", "")
        if proxy_cfg.get("username") and proxy_cfg.get("password"):
            proxy_url = f"http://{proxy_cfg['username']}:{proxy_cfg['password']}@{clean_host}"
        else:
            proxy_url = f"http://{clean_host}"
        handler = urllib.request.ProxyHandler({'http': proxy_url, 'https': proxy_url})
        opener = urllib.request.build_opener(handler)
        req = urllib.request.Request('https://api.ipify.org', headers={'User-Agent': 'Mozilla/5.0'})
        with opener.open(req, timeout=5) as resp:
            return resp.status == 200
    except Exception as e:
        print(f"Proxy test failed for {proxy_cfg['server']}: {e}", flush=True)
        return False

def proxy_for_slot():
    """Each slot gets its own sticky residential proxy so WhatsApp doesn't block the server IP."""
    env_val = os.environ.get("WA_PROXIES", "proxies.txt")
    candidates = [
        Path(env_val),
        PROJECT_ROOT / env_val,
        Path("proxies.txt"),
        Path("/dev-server/.wa-proxies.txt"),
    ]
    path = None
    for c in candidates:
        if c.exists() and c.is_file():
            path = c
            break
    if not path:
        return None
    lines = [l.strip() for l in path.read_text().splitlines() if l.strip() and not l.strip().startswith("#")]
    if not lines:
        return None

    idx = int((DIR / "proxy-index").read_text()) if (DIR / "proxy-index").exists() else SLOT - 1

    # Try current and subsequent proxies
    for offset in range(len(lines)):
        cand_idx = (idx + offset) % len(lines)
        raw_url = lines[cand_idx]
        try:
            cfg = parse_proxy(raw_url)
            if not cfg:
                continue
            print(f"Testing proxy {cand_idx + 1}/{len(lines)}: {cfg['server']}...", flush=True)
            if test_proxy(cfg):
                print(f"[OK] Using working proxy: {cfg['server']}", flush=True)
                (DIR / "proxy-index").write_text(str(cand_idx))
                return cfg
        except Exception as pe:
            print(f"Proxy line {cand_idx + 1} parse error: {pe}", flush=True)

    print("[WARN] All proxies in proxies.txt failed health check.", flush=True)
    print("Falling back to direct connection so WhatsApp checking can proceed.", flush=True)
    return None

async def main():
    DIR.mkdir(parents=True, exist_ok=True)
    (DIR / "monitor.pid").write_text(str(os.getpid()))
    async with async_playwright() as p:
        proxy = proxy_for_slot()
        print("Proxy:", "on" if proxy else "off", flush=True)

        context = None
        page = None
        for attempt in range(2):
            active_proxy = proxy if attempt == 0 else None
            if attempt == 1:
                print("[WARN] Proxy failed in browser. Falling back to direct connection.", flush=True)
            try:
                context = await p.chromium.launch_persistent_context(
                    str(DIR / "profile"),
                    headless=True,
                    viewport={"width": 1280, "height": 1800},
                    proxy=active_proxy,
                    args=[
                        "--no-sandbox",
                        "--disable-setuid-sandbox",
                        "--disable-dev-shm-usage",
                        "--disable-gpu",
                        "--ignore-certificate-errors",
                        "--ignore-ssl-errors",
                        "--allow-running-insecure-content",
                        "--disable-blink-features=AutomationControlled",
                    ],
                    user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
                )
                page = context.pages[0] if context.pages else await context.new_page()
                await page.goto("https://web.whatsapp.com", wait_until="domcontentloaded", timeout=45000)
                break
            except Exception as e:
                print(f"[Attempt {attempt + 1}] Navigation failed with proxy ({type(e).__name__}): {e}", flush=True)
                if context:
                    try:
                        await context.close()
                    except Exception:
                        pass
                if attempt == 1:
                    raise
        session_file = DIR / "monitor-session.json"
        session = json.loads(session_file.read_text()) if session_file.exists() else None
        import time
        last_request = time.time() * 1000 - 120000
        logout_checks = 0
        asyncio.create_task(check_loop(page, lambda: bool(session and session["state"] == "connected")))
        while True:
            try:
                connected = await page.locator('#pane-side').is_visible()
                login_screen = await page.locator('text=/Link with phone number|Log in with phone number/i').first.is_visible()
                if connected:
                    if not session or session["state"] == "logged_out":
                        session = {"id": str(uuid.uuid4()), "state": "connected"}
                    logout_checks = 0
                    session_file.write_text(json.dumps(session))
                    status({"state": "connected"})
                    await asyncio.to_thread(report, session["id"], "connected")
                elif session and session["state"] == "connected" and login_screen:
                    logout_checks += 1
                    if logout_checks >= 3:
                        session["state"] = "logged_out"
                        session_file.write_text(json.dumps(session))
                        status({"state": "error", "error": "WhatsApp logout ho gaya; dobara link karein."})
                        await asyncio.to_thread(report, session["id"], "logged_out")
                elif session and session["state"] == "logged_out":
                    await asyncio.to_thread(report, session["id"], "logged_out")
                else:
                    logout_checks = 0
                    if session and session["state"] == "connected":
                        status({"state": "connected"})
                req = DIR / "link-request.json"
                if req.exists():
                    request = json.loads(req.read_text())
                    if request["at"] > last_request:
                        last_request = request["at"]
                        raw_phone = str(request.get("phone", "")).strip()
                        clean_digits = re.sub(r"\D", "", raw_phone)
                        print(f"[{SLOT}] Received link request for phone: {raw_phone} (digits: {clean_digits})", flush=True)
                        status({"state": "starting", "phone": clean_digits})

                        print(f"[{SLOT}] Navigating to WhatsApp Web...", flush=True)
                        await page.goto("https://web.whatsapp.com", wait_until="domcontentloaded")
                        await page.wait_for_timeout(5000)

                        print(f"[{SLOT}] Looking for 'Link with phone number' button...", flush=True)
                        link_btn = page.locator('text=/Link with phone number|Log in with phone number|Link using phone number/i >> visible=true').first
                        try:
                            await link_btn.wait_for(state="visible", timeout=20000)
                            print(f"[{SLOT}] Clicking 'Link with phone number' (with safe_click)...", flush=True)
                            clicked = await safe_click(link_btn, page, "Link with phone number")
                            if not clicked:
                                raise RuntimeError("Failed to click Link with phone number button")
                            await page.wait_for_timeout(2000)
                        except Exception as e:
                            print(f"[{SLOT}] 'Link with phone number' button error: {e}", flush=True)
                            await capture_qr(page, clean_digits)
                            continue

                        national_number = clean_digits
                        if clean_digits.startswith("91") and len(clean_digits) == 12:
                            national_number = clean_digits[2:]
                        elif len(clean_digits) == 10:
                            national_number = clean_digits

                        print(f"[{SLOT}] Entering phone number: national={national_number}, full={clean_digits}...", flush=True)
                        try:
                            country_picker = page.locator('button:has-text("Choose a country"), [data-testid="country-picker"], button:has([data-icon="chevron-down"])').first
                            if await country_picker.is_visible(timeout=3000):
                                print(f"[{SLOT}] Country picker found, selecting India...", flush=True)
                                await safe_click(country_picker, page, "Country picker")
                                await page.wait_for_timeout(800)
                                search_input = page.locator('input[type="text"]').first
                                if await search_input.is_visible(timeout=3000):
                                    await search_input.fill("India")
                                    await page.wait_for_timeout(500)
                                    india_opt = page.locator('text=/India/i').first
                                    if await india_opt.is_visible(timeout=3000):
                                        await safe_click(india_opt, page, "India option")
                                        await page.wait_for_timeout(800)
                        except Exception as ce:
                            print(f"[{SLOT}] Country picker step: {ce}", flush=True)

                        field = page.locator('input[aria-label*="phone" i], input[inputmode="numeric"], input[type="text"]').last
                        await field.wait_for(state="visible", timeout=15000)
                        await safe_click(field, page, "Phone field")
                        await field.press("ControlOrMeta+A")
                        type_number = national_number if len(national_number) == 10 else clean_digits
                        print(f"[{SLOT}] Typing number into field: {type_number}", flush=True)
                        await field.press_sequentially(type_number, delay=80)
                        await page.wait_for_timeout(1000)

                        print(f"[{SLOT}] Clicking 'Next'...", flush=True)
                        next_btn = page.locator('button:has-text("Next"), div[role="button"]:has-text("Next")').first
                        await safe_click(next_btn, page, "Next button")

                        print(f"[{SLOT}] Waiting for 8-digit link code...", flush=True)
                        code = page.locator('[data-link-code]').first
                        try:
                            await code.wait_for(timeout=45000)
                            value = (await code.get_attribute("data-link-code") or "").replace(",", "")
                            if value:
                                print(f"[{SLOT}] >>> SUCCESS! Link code is: {value} <<<", flush=True)
                                status({"state": "code", "phone": clean_digits, "code": value})
                            else:
                                raise ValueError("Empty link code received")
                        except Exception as code_err:
                            print(f"[{SLOT}] Link code wait failed: {code_err}. Falling back to QR...", flush=True)
                            qr_btn = page.locator('text=/Log in with QR code|Scan QR code/i').first
                            if await qr_btn.is_visible():
                                await qr_btn.click(timeout=10000)
                            await capture_qr(page, clean_digits)
                elif not connected and current_state() == "qr":
                    await capture_qr(page, None)
            except Exception as exc:
                print("Monitor check failed:", type(exc).__name__, flush=True)
                import traceback
                traceback.print_exc()
                try:
                    await page.screenshot(path=str(DIR / "last-error.png"))
                except Exception:
                    pass
            await asyncio.sleep(2)

if __name__ == "__main__":
    asyncio.run(main())
