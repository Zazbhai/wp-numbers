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
        continue_btn = page.locator(':is(a, button):has-text("Continue to Chat"), :is(a, button):has-text("use WhatsApp Web")').first
        if await continue_btn.is_visible():
            print(f"[{phone}] Intermediate 'Continue to Chat' prompt found, clicking...", flush=True)
            await safe_click(continue_btn, page, "Continue to chat")
            await asyncio.sleep(1)
            continue

        # 2. Handle "Use here" prompt if another window stole session
        use_here = page.locator(':is(button, div[role="button"]):has-text("Use here"), :is(button, div[role="button"]):has-text("Use Here")').first
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
        unreg_el = page.get_by_text(TRIGGER).first
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
                        ok_btn = page.locator(':is(button, div[role="button"]):has-text("OK")').first
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
            print(f"\n==================================================", flush=True)
            print(f"🔍 Checking number: {phone}...", flush=True)
            result = await check_one(page, phone)
            print(f"🎯 Final check result for {phone}: {result} (is_unregistered={result})", flush=True)
            if result is not None:
                resp = await asyncio.to_thread(api, "POST", {"phone": phone, "found": result})
                print(f"💾 Saved result to database for {phone}: {resp}", flush=True)
            else:
                print(f"⚠️ Result unclear for {phone}, leaving pending.", flush=True)
            print(f"==================================================\n", flush=True)
        except Exception as exc:
            import traceback
            print(f"❌ Check failed for {phone}: {exc}", flush=True)
            traceback.print_exc()
        finally:
            busy.discard(phone)

async def check_loop(page, is_connected):
    queue, busy = asyncio.Queue(), set()
    asyncio.create_task(check_worker(page, queue, busy))
    queue_empty_logged = False
    last_unconnected_log = 0
    while True:
        try:
            connected = is_connected()
            if connected and queue.qsize() < 1:
                data = await asyncio.to_thread(api, "GET")
                nums = data.get("numbers", [])
                if nums:
                    print(f"[Queue] Received {len(nums)} pending numbers from database to check.", flush=True)
                    queue_empty_logged = False
                elif not queue_empty_logged:
                    print("[Queue] No pending numbers in database queue right now. Waiting...", flush=True)
                    queue_empty_logged = True
                for row in nums:
                    if row["phone"] not in busy:
                        busy.add(row["phone"])
                        queue.put_nowait(row["phone"])
            elif not connected:
                import time
                now = time.time()
                if now - last_unconnected_log > 15:
                    print("[Queue] WhatsApp Web is not connected yet; waiting for connection before pulling numbers...", flush=True)
                    last_unconnected_log = now
        except Exception as exc:
            print("Queue fetch failed:", type(exc).__name__, exc, flush=True)
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
    clean_host = proxy_cfg['server'].replace("http://", "").replace("https://", "").replace("socks5://", "")
    if proxy_cfg.get("username") and proxy_cfg.get("password"):
        proxy_url = f"http://{proxy_cfg['username']}:{proxy_cfg['password']}@{clean_host}"
    else:
        proxy_url = f"http://{clean_host}"

    for test_url in ["http://api.ipify.org", "http://icanhazip.com", "http://httpbin.org/ip"]:
        try:
            handler = urllib.request.ProxyHandler({'http': proxy_url, 'https': proxy_url})
            opener = urllib.request.build_opener(handler)
            req = urllib.request.Request(test_url, headers={'User-Agent': 'Mozilla/5.0'})
            with opener.open(req, timeout=4) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            continue
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

def cleanup_stale_locks(profile_dir: Path):
    if not profile_dir.exists():
        return
    for name in ["SingletonLock", "SingletonCookie", "SingletonSocket"]:
        lock_file = profile_dir / name
        try:
            if lock_file.exists() or lock_file.is_symlink():
                lock_file.unlink(missing_ok=True)
                print(f"[Init] Removed stale Chromium lock file: {name}", flush=True)
        except Exception:
            pass

def terminate_existing_monitor():
    pid_file = DIR / "monitor.pid"
    if pid_file.exists():
        try:
            old_pid = int(pid_file.read_text().strip())
            if old_pid and old_pid != os.getpid():
                import signal
                try:
                    os.kill(old_pid, signal.SIGTERM)
                    print(f"[{SLOT}] Terminated previous monitor process (PID {old_pid}) to prevent profile lock conflicts.", flush=True)
                    import time
                    time.sleep(1)
                except (ProcessLookupError, PermissionError):
                    pass
        except Exception:
            pass
    pid_file.write_text(str(os.getpid()))

async def main():
    DIR.mkdir(parents=True, exist_ok=True)
    print(f"[{SLOT}] [1/4] Starting WhatsApp Session Monitor (PID {os.getpid()})...", flush=True)
    terminate_existing_monitor()
    cleanup_stale_locks(DIR / "profile")

    async with async_playwright() as p:
        print(f"[{SLOT}] [2/4] Testing proxy configuration...", flush=True)
        proxy = proxy_for_slot()
        print(f"[{SLOT}] Proxy status: {'ON (' + proxy['server'] + ')' if proxy else 'OFF (direct connection)'}", flush=True)

        context = None
        page = None
        for attempt in range(2):
            active_proxy = proxy if attempt == 0 else None
            if attempt == 1:
                print(f"[{SLOT}] [WARN] Proxy failed in browser. Retrying with direct connection...", flush=True)
                cleanup_stale_locks(DIR / "profile")
            try:
                print(f"[{SLOT}] [3/4] Launching Chromium persistent context (slot {SLOT}, attempt {attempt + 1}/2)...", flush=True)
                context = await p.chromium.launch_persistent_context(
                    str(DIR / "profile"),
                    headless=True,
                    timeout=35000,
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
                print(f"[{SLOT}] Chromium launched! Navigating to https://web.whatsapp.com...", flush=True)
                page = context.pages[0] if context.pages else await context.new_page()
                await page.goto("https://web.whatsapp.com", wait_until="domcontentloaded", timeout=45000)
                print(f"[{SLOT}] [4/4] WhatsApp Web DOM loaded! Starting session state watcher...", flush=True)
                break
            except Exception as e:
                print(f"[{SLOT}] [Attempt {attempt + 1}] Launch/navigation failed ({type(e).__name__}): {e}", flush=True)
                if context:
                    try:
                        await context.close()
                    except Exception:
                        pass
                cleanup_stale_locks(DIR / "profile")
                if attempt == 1:
                    raise

        session_file = DIR / "monitor-session.json"
        session = json.loads(session_file.read_text()) if session_file.exists() else None
        if session:
            print(f"[{SLOT}] Restored previous session state: {session.get('state')}", flush=True)
        import time
        last_request = time.time() * 1000 - 120000
        logout_checks = 0
        asyncio.create_task(check_loop(page, lambda: bool(session and session.get("state") == "connected")))

        last_state_log = None
        sync_tick = 0
        while True:
            sync_tick += 1
            try:
                connected = await page.locator('#pane-side').is_visible()
                login_screen = await page.locator('text=/Link with phone number|Log in with phone number/i').first.is_visible()
                canvas_visible = await page.locator('canvas').first.is_visible()

                if connected:
                    if not session or session.get("state") != "connected":
                        session = {"id": str(uuid.uuid4()), "state": "connected"}
                        session_file.write_text(json.dumps(session))
                        print(f"[{SLOT}] ✅ Connected to WhatsApp Web! Active session ID: {session['id']}", flush=True)
                    logout_checks = 0
                    status({"state": "connected"})
                    await asyncio.to_thread(report, session["id"], "connected")
                    if last_state_log != "connected":
                        print(f"[{SLOT}] ✅ WhatsApp Web is CONNECTED! (#pane-side active) - Ready to process queue.", flush=True)
                        last_state_log = "connected"

                elif login_screen or canvas_visible:
                    if session and session.get("state") == "connected":
                        logout_checks += 1
                        if logout_checks >= 3:
                            session["state"] = "logged_out"
                            session_file.write_text(json.dumps(session))
                            status({"state": "error", "error": "WhatsApp logout ho gaya; dobara link karein."})
                            print(f"[{SLOT}] ⚠️ WhatsApp Web has logged out. Please relink at /link", flush=True)
                            await asyncio.to_thread(report, session["id"], "logged_out")
                            last_state_log = "logged_out"
                    else:
                        if last_state_log != "login_screen":
                            print(f"[{SLOT}] 📱 WhatsApp Web is NOT LINKED yet.", flush=True)
                            print(f"[{SLOT}] 👉 Open http://<vps-ip>:8080/link to scan QR or enter phone number.", flush=True)
                            last_state_log = "login_screen"
                        if current_state() == "qr" or canvas_visible:
                            await capture_qr(page, None)

                else:
                    if sync_tick % 5 == 1:
                        try:
                            title = await page.title()
                        except Exception:
                            title = "WhatsApp"
                        print(f"[{SLOT}] ⏳ Waiting for WhatsApp Web to sync chats... (page title: '{title}')", flush=True)

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
