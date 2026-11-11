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
        context = await p.chromium.launch_persistent_context(str(DIR / "profile"), headless=True,
                    viewport={"width": 1280, "height": 1800}, proxy=proxy,
                    args=["--disable-blink-features=AutomationControlled"],
                    user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36")
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
                        phone = request["phone"]
                        if len(phone) == 10:
                            phone = "91" + phone
                        await page.goto("https://web.whatsapp.com", wait_until="domcontentloaded")
                        status({"state": "starting", "phone": phone})
                        await page.wait_for_timeout(6000)
                        link_btn = page.locator('text=/Link with phone number|Log in with phone number/i >> visible=true').first
                        await link_btn.click(timeout=30000)
                        field = page.locator('input[type="text"], input[inputmode="numeric"], [role="textbox"]').first
                        await field.click()
                        await field.press("ControlOrMeta+A")
                        await field.press_sequentially("+" + phone, delay=100)
                        await page.get_by_role("button", name="Next", exact=True).click()
                        code = page.locator('[data-link-code]').first
                        try:
                            await code.wait_for(timeout=60000)
                            value = (await code.get_attribute("data-link-code") or "").replace(",", "")
                            status({"state": "code", "phone": phone, "code": value})
                        except Exception:
                            qr_btn = page.locator('text=/Log in with QR code|Scan QR code/i').first
                            if await qr_btn.is_visible():
                                await qr_btn.click(timeout=15000)
                            await capture_qr(page, phone)
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
