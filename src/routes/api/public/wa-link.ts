import { createFileRoute } from "@tanstack/react-router";
import { writeFile, mkdir } from "fs/promises";
import * as path from "path";
import {
  ensureMonitor,
  dir,
  readJson,
  knownSlots,
  resetSlot,
  MAX_SLOTS,
} from "@/lib/wa-monitor.server";
import { isRequestAdmin } from "@/lib/admin-auth.server";

export const Route = createFileRoute("/api/public/wa-link")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isRequestAdmin(request)) {
          return Response.json({ ok: false, error: "Unauthorized: Admin access required" }, { status: 401 });
        }
        const body = await request.json().catch(() => null);
        const phone = String(body?.phone ?? "").replace(/\D/g, "");
        const slot = Number(body?.slot ?? 1);
        if (phone.length < 10 || phone.length > 15) {
          return Response.json({ ok: false, error: "Number sahi nahi hai" }, { status: 400 });
        }
        if (!Number.isInteger(slot) || slot < 1 || slot > MAX_SLOTS) {
          return Response.json({ ok: false, error: "Slot galat hai" }, { status: 400 });
        }
        const slotDir = dir(slot);
        await mkdir(slotDir, { recursive: true });
        await ensureMonitor(slot, true);
        await writeFile(path.join(slotDir, "link-request.json"), JSON.stringify({ phone, at: Date.now() }));
        await writeFile(path.join(slotDir, "link-status.json"), JSON.stringify({ state: "starting", phone }));
        return Response.json({ ok: true });
      },
      DELETE: async ({ request }) => {
        if (!isRequestAdmin(request)) {
          return Response.json({ ok: false, error: "Unauthorized: Admin access required" }, { status: 401 });
        }
        const body = await request.json().catch(() => null);
        const slot = Number(body?.slot ?? 1);
        if (!Number.isInteger(slot) || slot < 1 || slot > MAX_SLOTS) {
          return Response.json({ ok: false, error: "Slot galat hai" }, { status: 400 });
        }
        await resetSlot(slot);
        return Response.json({ ok: true, slot });
      },
      GET: async ({ request }) => {
        if (!isRequestAdmin(request)) {
          return Response.json({ ok: false, error: "Unauthorized: Admin access required", slots: [], max: MAX_SLOTS }, { status: 401 });
        }
        const slots = [];
        for (const slot of await knownSlots()) {
          const status = (await readJson(path.join(dir(slot), "link-status.json"))) ?? { state: "idle" };
          if (status.state && status.state !== "idle" && status.state !== "error") {
            await ensureMonitor(slot);
          }
          slots.push({ slot, ...status });
        }
        return Response.json({ slots, max: MAX_SLOTS }, { headers: { "Cache-Control": "no-store" } });
      },
    },
  },
});
