import { readFile, writeFile, mkdir, readdir, unlink, rm } from "fs/promises";
import { spawn } from "child_process";
import { openSync } from "fs";
import * as path from "path";

export const ROOT = process.env["WA_DATA"] || path.resolve(process.cwd(), ".wa-data");
export const SCRIPT = path.resolve(process.cwd(), "scripts", "wa-session-monitor.py");
export const MAX_SLOTS = 5;

const PY = process.env["PYTHON"] || (process.platform === "win32" ? "python" : "python3");

export const dir = (slot: number) => path.join(ROOT, `slot-${slot}`);

export async function readJson(filePath: string) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

export async function isRunning(slot: number): Promise<boolean> {
  const pidFile = path.join(dir(slot), "monitor.pid");
  const pidStr = await readFile(pidFile, "utf8").catch(() => "0");
  const pid = Number(pidStr.trim());
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const lastSpawnTimes = new Map<number, number>();

export async function ensureMonitor(slot: number, force = false): Promise<boolean> {
  if (await isRunning(slot)) return true;

  const now = Date.now();
  const lastSpawn = lastSpawnTimes.get(slot) || 0;
  if (!force && now - lastSpawn < 10000) {
    return false;
  }
  lastSpawnTimes.set(slot, now);

  const slotDir = dir(slot);
  await mkdir(slotDir, { recursive: true });
  const logFile = path.join(slotDir, "monitor.log");
  const log = openSync(logFile, "a");

  const child = spawn(PY, [SCRIPT], {
    detached: true,
    windowsHide: true,
    cwd: process.cwd(),
    stdio: ["ignore", log, log],
    env: {
      ...process.env,
      PYTHONIOENCODING: "utf-8",
      WA_SLOT: String(slot),
      WA_DATA: ROOT,
      WA_APP_ORIGIN: process.env["WA_APP_ORIGIN"] || "http://localhost:8080",
    },
  });

  if (child.pid) {
    await writeFile(path.join(slotDir, "monitor.pid"), String(child.pid));
  }
  child.unref();
  return true;
}

export async function knownSlots(): Promise<number[]> {
  const names = await readdir(ROOT).catch(() => [] as string[]);
  const slots = names
    .map((n) => Number(n.replace("slot-", "")))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= MAX_SLOTS)
    .sort((a, b) => a - b);

  return slots.length > 0 ? slots : [1];
}

export async function stopMonitor(slot: number): Promise<void> {
  const pidFile = path.join(dir(slot), "monitor.pid");
  try {
    const pidStr = await readFile(pidFile, "utf8").catch(() => "0");
    const pid = Number(pidStr.trim());
    if (pid && !Number.isNaN(pid)) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // already stopped
      }
    }
  } catch {
    // ignore
  }
}

export async function resetSlot(slot: number): Promise<void> {
  await stopMonitor(slot);
  const slotDir = dir(slot);
  lastSpawnTimes.delete(slot);
  try {
    await unlink(path.join(slotDir, "link-request.json")).catch(() => {});
    await unlink(path.join(slotDir, "monitor-session.json")).catch(() => {});
    await unlink(path.join(slotDir, "monitor.pid")).catch(() => {});
    await writeFile(path.join(slotDir, "link-status.json"), JSON.stringify({ state: "idle" }));
    await rm(path.join(slotDir, "profile"), { recursive: true, force: true }).catch(() => {});
  } catch {
    // ignore
  }
}


