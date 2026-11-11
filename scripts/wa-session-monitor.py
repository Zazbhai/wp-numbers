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

def load_env():
    env_file = Path(__file__).resolve().parent.parent / ".env"
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
DIR = Path(os.environ.get("WA_DATA", Path(__file__).resolve().parent.parent / ".wa-data")) / f"slot-{SLOT}"
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
CHECK_WORKERS = 3

async def check_one(page, phone):
    """Returns True (not on WhatsApp), False (on WhatsApp) or None (unclear, keep pending).
    
    Uses in-process double-confirmation: if the trigger dialog fires, we wait 3 seconds
    and re-verify before concluding unregistered. This eliminates false positives from
    transient WhatsApp Web loading states.
    """
    clean_phone = phone.lstrip('+')
    await page.goto(f"https://web.whatsapp.com/send?phone={clean_phone}", wait_until="domcontentloaded", timeout=45000)
    first_trigger_at = None
    for _ in range(200):  # up to ~60s (200 × 0.3s)
        if await page.locator('footer div[contenteditable="true"]').first.is_visible():
            # Chat input box appeared → number IS registered on WhatsApp
            return False
        dialog = page.locator('[role="dialog"]').first
        if await dialog.is_visible() and TRIGGER.search(await dialog.inner_text()):
            if first_trigger_at is None:
                # First detection — record time and keep polling for 3 more seconds
                first_trigger_at = asyncio.get_event_loop().time()
            else:
                elapsed = asyncio.get_event_loop().time() - first_trigger_at
                if elapsed >= 3.0:
                    # Trigger dialog persisted for 3+ seconds → confirmed unregistered
                    return True
                # Still within 3s window, keep checking for chat input
        elif first_trigger_at is not None:
            # Dialog disappeared — could be a transient render; reset to avoid false positive
            first_trigger_at = None
        await asyncio.sleep(0.3)
    return None

async def check_worker(context, queue, busy):
    page = await context.new_page()
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

async def check_loop(context, is_connected):
    queue, busy = asyncio.Queue(), set()
    for _ in range(CHECK_WORKERS):
        asyncio.create_task(check_worker(context, queue, busy))
    while True:
        try:
            if is_connected() and queue.qsize() < CHECK_WORKERS:
                data = await asyncio.to_thread(api, "GET")
                for row in data.get("numbers", []):
                    if row["phone"] not in busy:
                        busy.add(row["phone"])
                        queue.put_nowait(row["phone"])
        except Exception as exc:
            print("Queue fetch failed:", type(exc).__name__, flush=True)
        await asyncio.sleep(2)

def test_proxy(proxy_cfg):
    import urllib.request
    try:
        url = f"{proxy_cfg['server']}"
        proxy_url = f"http://{proxy_cfg['username']}:{proxy_cfg['password']}@{url.replace('http://', '').replace('https://', '')}"
        handler = urllib.request.ProxyHandler({'http': proxy_url, 'https': proxy_url})
        opener = urllib.request.build_opener(handler)
        req = urllib.request.Request('https://api.ipify.org', headers={'User-Agent': 'Mozilla/5.0'})
        with opener.open(req, timeout=4) as resp:
            return resp.status == 200
    except Exception as e:
        print(f"Proxy test failed for {proxy_cfg['server']}: {e}", flush=True)
        return False

def proxy_for_slot():
    """Each slot gets its own sticky residential proxy so WhatsApp doesn't block the server IP."""
    from urllib.parse import urlparse
    env_val = os.environ.get("WA_PROXIES", "proxies.txt")
    candidates = [
        Path(env_val),
        Path(__file__).resolve().parent.parent / env_val,
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
    lines = [l.strip() for l in path.read_text().splitlines() if l.strip()]
    if not lines:
        return None

    idx = int((DIR / "proxy-index").read_text()) if (DIR / "proxy-index").exists() else SLOT - 1
    
    # Try current and subsequent proxies
    for offset in range(len(lines)):
        cand_idx = (idx + offset) % len(lines)
        raw_url = lines[cand_idx]
        u = urlparse(raw_url)
        cfg = {"server": f"{u.scheme}://{u.hostname}:{u.port}", "username": u.username, "password": u.password}
        print(f"Testing proxy {cand_idx + 1}/{len(lines)}: {cfg['server']}...", flush=True)
        if test_proxy(cfg):
            print(f"[OK] Using working proxy: {cfg['server']}", flush=True)
            (DIR / "proxy-index").write_text(str(cand_idx))
            return cfg

    print("[WARN] All proxies in proxies.txt failed health check (e.g. 402 Payment Required).", flush=True)
    print("Falling back to direct connection so WhatsApp checking can proceed.", flush=True)
    return None

async def main():
    DIR.mkdir(parents=True, exist_ok=True)
    (DIR / "monitor.pid").write_text(str(os.getpid()))
    async with async_playwright() as p:
        proxy = proxy_for_slot()
        print("Proxy:", "on" if proxy else "off", flush=True)
        context = await p.chromium.launch_persistent_context(
            str(DIR / "profile"),
            headless=True,
            viewport={"width": 1280, "height": 1800},
            proxy=proxy,
            args=[
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--disable-blink-features=AutomationControlled",
            ],
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
        )
        page = context.pages[0] if context.pages else await context.new_page()
        await page.goto("https://web.whatsapp.com", wait_until="domcontentloaded")
        session_file = DIR / "monitor-session.json"
        session = json.loads(session_file.read_text()) if session_file.exists() else None
        import time
        last_request = time.time() * 1000 - 120000
        logout_checks = 0
        asyncio.create_task(check_loop(context, lambda: bool(session and session["state"] == "connected")))
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
