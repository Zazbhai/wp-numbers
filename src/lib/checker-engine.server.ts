import { getDb } from "@/integrations/mongodb/client.server";
import { cancelFurySmsNumber, requestFurySmsNumber } from "./furysms.server";
import { ensureMonitor, isRunning } from "./wa-monitor.server";
import type { WaCheckNumberDoc } from "@/integrations/mongodb/client.server";

export const UNREGISTERED_TARGET = 100; // Auto-refill when available unregistered < 100
export const HOURLY_PULL_COUNT = 20; // Auto-pull 20 numbers constantly every hour
const HOURLY_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const SHORT_POLL_INTERVAL_MS = 45 * 1000; // 45 seconds check for active pipeline

let isEngineRunning = false;
let isRefilling = false;
let isHourlyPulling = false;
let engineTimer: NodeJS.Timeout | null = null;
let shortTimer: NodeJS.Timeout | null = null;
let lastHourlyRun = 0;

/**
 * Helper to pull fresh numbers from FurySMS getNumber endpoint and enqueue them
 */
async function pullNumbersFromFurySms(count: number, notePrefix: string): Promise<number> {
  const db = await getDb();
  let pulled = 0;
  for (let i = 0; i < count; i++) {
    const res = await requestFurySmsNumber();
    if (!res) {
      console.warn(`[Auto-Refill] FurySMS getNumber returned empty or stopped at ${pulled}/${count}`);
      break;
    }
    const now = new Date();
    const existing = await db.collection<WaCheckNumberDoc>("wa_check_numbers").findOne(
      { phone: res.phone },
      { projection: { status: 1 } },
    );
    if (existing) {
      await cancelFurySmsNumber(res.id).catch(() => false);
      continue;
    }
    try {
      await db.collection<WaCheckNumberDoc>("wa_check_numbers").insertOne({
        phone: res.phone,
        status: "pending",
        provider_id: res.id,
        note: `${notePrefix} (${pulled + 1}/${count})`,
        created_at: now,
        updated_at: now,
      });
    } catch (error: unknown) {
      if ((error as { code?: number })?.code !== 11000) throw error;
      await cancelFurySmsNumber(res.id).catch(() => false);
      continue;
    }
    pulled++;
    if (i < count - 1) {
      await new Promise((r) => setTimeout(r, 600));
    }
  }
  return pulled;
}

/**
 * Maintains queue when available unregistered numbers are less than 100
 */
export async function maintainCheckerPipeline(): Promise<{
  availableCount: number;
  pendingCount: number;
  target: number;
  monitorRunning: boolean;
  refilled: number;
} | null> {
  if (isRefilling) return null;
  isRefilling = true;

  try {
    const db = await getDb();

    // Count currently confirmed unregistered numbers in marketplace
    const availableCount = await db.collection<WaCheckNumberDoc>("wa_check_numbers").countDocuments({
      status: { $in: ["available", "sent", "found"] },
      provider_id: { $exists: true, $nin: [null, ""] },
    });

    // Count numbers currently in queue waiting to be verified
    const pendingCount = await db.collection<WaCheckNumberDoc>("wa_check_numbers").countDocuments({
      status: { $in: ["pending", "pending_verify"] },
    });

    // Ensure WhatsApp monitor is running
    const monitorRunning = await isRunning(1).catch(() => false);
    if (!monitorRunning) {
      await ensureMonitor(1, false).catch(() => {});
    }

    let refilled = 0;

    // Requirement: When unregistered numbers count is less than 100, auto-pull numbers to check
    if (availableCount < UNREGISTERED_TARGET) {
      // Maintain up to 15 pending numbers in queue so monitor stays busy
      const batchSize = Math.min(10, Math.max(0, 15 - pendingCount));
      if (batchSize > 0) {
        console.log(`[Auto-Refill] Available unregistered (${availableCount}) < ${UNREGISTERED_TARGET}. Pulling batch of ${batchSize} numbers from FurySMS...`);
        refilled = await pullNumbersFromFurySms(batchSize, `Auto-refill (<100 target: ${availableCount}/100)`);
        console.log(`[Auto-Refill] Enqueued ${refilled} fresh numbers from FurySMS for WhatsApp checking.`);
      }
    }

    return {
      availableCount,
      pendingCount,
      target: UNREGISTERED_TARGET,
      monitorRunning: await isRunning(1).catch(() => false),
      refilled,
    };
  } catch (error) {
    console.error("[maintainCheckerPipeline error]:", error);
    return null;
  } finally {
    isRefilling = false;
  }
}

/**
 * Hourly scheduled task: automatically calls getNumber to pull 20 numbers constantly every hour
 */
export async function runHourlyCheckerTask() {
  if (isHourlyPulling) return;
  isHourlyPulling = true;
  const now = Date.now();
  lastHourlyRun = now;

  try {
    const db = await getDb();
    await db.collection<{
      _id: string;
      lastHourlyRun?: Date | string | number;
      lastHourlyPullCount?: number;
      updatedAt?: Date;
    }>("system_settings").updateOne(
      { _id: "checker_engine_state" },
      { $set: { lastHourlyRun: new Date(now), lastHourlyPullCount: HOURLY_PULL_COUNT, updatedAt: new Date(now) } },
      { upsert: true }
    );

    // 1. Force start / ensure WhatsApp session monitor is running
    await ensureMonitor(1, true).catch(() => {});

    // 2. Requirement: Auto-call getNumber on FurySMS to get 20 numbers constantly every hour
    console.log(`[Hourly Auto-Fetch] ⏰ Starting hourly pull of ${HOURLY_PULL_COUNT} numbers from FurySMS...`);
    const pulled = await pullNumbersFromFurySms(HOURLY_PULL_COUNT, "Hourly constant auto-fetch (20 batch)");
    console.log(`[Hourly Auto-Fetch] ✅ Added ${pulled}/${HOURLY_PULL_COUNT} numbers to checking queue.`);

    // 3. Maintain pipeline towards 100 target
    await maintainCheckerPipeline();
  } catch (err) {
    console.error("[runHourlyCheckerTask error]:", err);
  } finally {
    isHourlyPulling = false;
  }
}

/**
 * Starts background engine loops
 */
export function initCheckerEngine() {
  if (isEngineRunning) return;
  isEngineRunning = true;

  console.log(`[Checker Engine] Initialized! Auto-refill target: ${UNREGISTERED_TARGET} unregistered. Hourly pull: ${HOURLY_PULL_COUNT} numbers.`);

  // Load state and check if hourly task is due
  setTimeout(async () => {
    try {
      const db = await getDb();
      const state = await db
        .collection<{ _id: string; lastHourlyRun?: Date | string | number }>("system_settings")
        .findOne({ _id: "checker_engine_state" });
      const rawLast = state ? (state["lastHourlyRun"] as Date | string | number | undefined) : undefined;
      const lastRun = rawLast ? new Date(rawLast).getTime() : 0;
      lastHourlyRun = lastRun;

      const timeSinceLast = Date.now() - lastRun;
      if (timeSinceLast >= HOURLY_INTERVAL_MS) {
        console.log(`[Checker Engine] Last hourly pull was ${Math.round(timeSinceLast / 60000)}m ago. Running hourly ${HOURLY_PULL_COUNT}-number pull now...`);
        runHourlyCheckerTask().catch(() => {});
      } else {
        const nextInMinutes = Math.round((HOURLY_INTERVAL_MS - timeSinceLast) / 60000);
        console.log(`[Checker Engine] Next hourly pull due in ~${nextInMinutes} minutes.`);
        maintainCheckerPipeline().catch(() => {});
      }
    } catch {
      maintainCheckerPipeline().catch(() => {});
    }
  }, 3000);

  // Setup 1-hour recurring schedule
  if (!engineTimer) {
    engineTimer = setInterval(() => {
      runHourlyCheckerTask().catch(() => {});
    }, HOURLY_INTERVAL_MS);
  }

  // Setup short periodic check (every 45s) to keep pipeline moving towards 100
  if (!shortTimer) {
    shortTimer = setInterval(() => {
      maintainCheckerPipeline().catch(() => {});
    }, SHORT_POLL_INTERVAL_MS);
  }
}

export function getEngineStats() {
  const nextRun = lastHourlyRun ? new Date(lastHourlyRun + HOURLY_INTERVAL_MS).toISOString() : null;

  return {
    target: UNREGISTERED_TARGET,
    hourlyPullCount: HOURLY_PULL_COUNT,
    hourlyIntervalMinutes: 60,
    lastHourlyRun: lastHourlyRun ? new Date(lastHourlyRun).toISOString() : null,
    nextHourlyRun: nextRun,
    isEngineRunning,
  };
}
