import { getDb } from "@/integrations/mongodb/client.server";
import { requestFurySmsNumber } from "./furysms.server";
import { ensureMonitor, isRunning } from "./wa-monitor.server";
import type { WaCheckNumberDoc } from "@/integrations/mongodb/client.server";

export const UNREGISTERED_TARGET = 50;
const HOURLY_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const SHORT_POLL_INTERVAL_MS = 45 * 1000; // 45 seconds check for active pipeline

let isEngineRunning = false;
let isRefilling = false;
let engineTimer: NodeJS.Timeout | null = null;
let shortTimer: NodeJS.Timeout | null = null;
let lastHourlyRun = 0;

export async function maintainCheckerPipeline(): Promise<{
  availableCount: number;
  pendingCount: number;
  target: number;
  monitorRunning: boolean;
} | null> {
  if (isRefilling) return null;
  isRefilling = true;

  try {
    const db = await getDb();

    // Count currently confirmed unregistered numbers (double-verified, in marketplace)
    const availableCount = await db.collection<WaCheckNumberDoc>("wa_check_numbers").countDocuments({
      status: { $in: ["available", "sent", "found", "pending_otp"] },
    });

    // Count numbers in first-pass limbo (found unregistered once, awaiting second check)
    const pendingVerifyCount = await db.collection<WaCheckNumberDoc>("wa_check_numbers").countDocuments({
      status: "pending_verify",
    });

    const pendingCount = await db.collection<WaCheckNumberDoc>("wa_check_numbers").countDocuments({
      status: "pending",
    });

    // Ensure WhatsApp monitor is running
    const monitorRunning = await isRunning(1).catch(() => false);
    if (!monitorRunning) {
      await ensureMonitor(1, false).catch(() => {});
    }

    // Pipeline goal: keep available + pending_verify + pending filled so we can reach 50 confirmed
    // Each number needs 2 checks, so pipeline needs to be deeper
    const inPipeline = availableCount + pendingVerifyCount;
    if (inPipeline < UNREGISTERED_TARGET) {
      // Maintain enough pending numbers in queue; account for ~50% pass rate on WhatsApp check
      const batchSize = Math.min(10, Math.max(0, 10 - pendingCount));
      if (batchSize > 0) {
        for (let i = 0; i < batchSize; i++) {
          const res = await requestFurySmsNumber("boyaah", "22");
          if (!res) {
            break;
          }
          const now = new Date();
          await db.collection<WaCheckNumberDoc>("wa_check_numbers").updateOne(
            { phone: res.phone },
            {
              $setOnInsert: { phone: res.phone, status: "pending", note: null, created_at: now },
              $set: { provider_id: res.id, updated_at: now },
            },
            { upsert: true }
          );
          if (i < batchSize - 1) {
            await new Promise((r) => setTimeout(r, 600));
          }
        }
      }
    }

    return {
      availableCount,
      pendingCount,
      target: UNREGISTERED_TARGET,
      monitorRunning: await isRunning(1).catch(() => false),
    };
  } catch (error) {
    console.error("[maintainCheckerPipeline error]:", error);
    return null;
  } finally {
    isRefilling = false;
  }
}

export async function runHourlyCheckerTask() {
  lastHourlyRun = Date.now();

  try {
    // 1. Force start/ensure monitor is active
    await ensureMonitor(1, true).catch(() => {});

    // 2. Refill and maintain pipeline if unregistered count < 50
    await maintainCheckerPipeline();
  } catch (err) {
    // Silent
  }
}

export function initCheckerEngine() {
  if (isEngineRunning) return;
  isEngineRunning = true;

  // Run initial check after a short delay
  setTimeout(() => {
    maintainCheckerPipeline().catch(() => {});
  }, 3000);

  // Setup 1-hour recurring schedule
  if (!engineTimer) {
    engineTimer = setInterval(() => {
      runHourlyCheckerTask().catch(() => {});
    }, HOURLY_INTERVAL_MS);
  }

  // Setup short periodic maintenance check (every 45s) to keep pipeline moving towards 50
  if (!shortTimer) {
    shortTimer = setInterval(() => {
      maintainCheckerPipeline().catch(() => {});
    }, SHORT_POLL_INTERVAL_MS);
  }
}

export function getEngineStats() {
  return {
    target: UNREGISTERED_TARGET,
    hourlyIntervalMinutes: 60,
    lastHourlyRun: lastHourlyRun ? new Date(lastHourlyRun).toISOString() : null,
    isEngineRunning,
  };
}
