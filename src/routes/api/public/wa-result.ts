import { createFileRoute } from "@tanstack/react-router";
import { createHash, timingSafeEqual } from "crypto";
import { normalizePhone } from "@/lib/identity";
import { waResultSchema } from "@/lib/wa-result-schema";
import { sendTelegramMessage } from "@/lib/telegram.server";
import { requestFurySmsNumber, cancelFurySmsNumber } from "@/lib/furysms.server";
import type { Db } from "mongodb";
import type { WaCheckNumberDoc, BotChatDoc } from "@/integrations/mongodb/client.server";

function deriveSecret(key: string) {
  return createHash("sha256").update(`wa-checker:${key}`).digest("base64url");
}

function safeEqual(a: string, b: string) {
  const l = Buffer.from(a);
  const r = Buffer.from(b);
  return l.length === r.length && timingSafeEqual(l, r);
}

let isRefilling = false;

export async function refillPendingNumbers(db: Db, target = 6) {
  if (isRefilling) return;
  isRefilling = true;
  try {
    const pendingCount = await db.collection<WaCheckNumberDoc>("wa_check_numbers").countDocuments({ status: "pending" });
    const need = Math.max(0, target - pendingCount);
    if (need <= 0) return;

    for (let i = 0; i < need; i++) {
      const res = await requestFurySmsNumber("boyaah", "22");
      if (!res) {
        // Break early if balance empty or temporary FurySMS issue
        break;
      }
      const now = new Date();
      await db.collection<WaCheckNumberDoc>("wa_check_numbers").updateOne(
        { phone: res.phone },
        {
          $setOnInsert: { phone: res.phone, created_at: now },
          $set: { status: "pending", provider_id: res.id, note: "Refilled from FurySMS", updated_at: now },
        },
        { upsert: true }
      );
      if (i < need - 1) {
        await new Promise((r) => setTimeout(r, 800));
      }
    }
  } catch (err) {
    console.error("[refillPendingNumbers error]:", err);
  } finally {
    isRefilling = false;
  }
}

export const Route = createFileRoute("/api/public/wa-result")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const key = process.env["TELEGRAM_API_KEY"];
        if (!key || !safeEqual(request.headers.get("X-Checker-Key") ?? "", deriveSecret(key))) {
          return new Response("Unauthorized", { status: 401 });
        }

        try {
          const { getDb } = await import("@/integrations/mongodb/client.server");
          const db = await getDb();
          const slot = Math.min(Math.max(Number(new URL(request.url).searchParams.get("slot")) || 1, 1), 5);

          // Fetch both fresh pending AND first-pass-verified numbers that need a second check
          const getWorkQueue = () =>
            db
              .collection<WaCheckNumberDoc>("wa_check_numbers")
              .find(
                { status: { $in: ["pending", "pending_verify"] } },
                { projection: { _id: 0, phone: 1, status: 1 } }
              )
              .sort({ status: 1, created_at: 1 }) // "pending" sorts before "pending_verify" alphabetically, fine
              .skip((slot - 1) * 10)
              .limit(10)
              .toArray();

          let docs = await getWorkQueue();
          if (docs.length < 5) {
            // Trigger engine to maintain pipeline towards 50 unregistered numbers
            const { maintainCheckerPipeline } = await import("@/lib/checker-engine.server");
            await maintainCheckerPipeline();
            docs = await getWorkQueue();
          }

          const numbers = docs.map((d) => ({ phone: d["phone"] }));
          return Response.json({ ok: true, numbers }, { headers: { "Cache-Control": "no-store" } });
        } catch (error) {
          console.error("[wa-result GET error]:", error);
          return Response.json({ ok: false }, { status: 503 });
        }
      },
      POST: async ({ request }) => {
        const key = process.env["TELEGRAM_API_KEY"];
        if (!key) return new Response("Not configured", { status: 500 });
        const got = request.headers.get("X-Checker-Key") ?? "";
        if (!safeEqual(got, deriveSecret(key))) return new Response("Unauthorized", { status: 401 });

        const parsed = waResultSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ ok: false }, { status: 400 });
        const phone = normalizePhone(parsed.data.phone);
        const found = parsed.data.found; // true = not on WhatsApp (UNREGISTERED); false = on WhatsApp
        if (!phone) return Response.json({ ok: false, error: "invalid phone" }, { status: 400 });

        try {
          const { getDb } = await import("@/integrations/mongodb/client.server");
          const db = await getDb();

          const row = await db.collection<WaCheckNumberDoc>("wa_check_numbers").findOne({ phone });
          if (!row) return Response.json({ ok: false }, { status: 404 });
          // Only process numbers that are pending a check (first or second pass)
          if (row["status"] !== "pending" && row["status"] !== "pending_verify") {
            return Response.json({ ok: true, status: row["status"] });
          }

          const now = new Date();

          if (found) {
            // Confirmed unregistered! Immediately mark as available for Marketplace
            await db.collection<WaCheckNumberDoc>("wa_check_numbers").updateOne(
              { phone },
              {
                $set: {
                  status: "available",
                  verify_count: 1,
                  note: "Verified unregistered (Available in Marketplace)",
                  updated_at: now,
                },
              }
            );

            // Send Telegram alert
            try {
              const chat = await db
                .collection<BotChatDoc>("bot_chats")
                .find({}, { projection: { chat_id: 1 } })
                .sort({ updated_at: -1 })
                .limit(1)
                .next();

              if (chat && chat["chat_id"]) {
                await sendTelegramMessage(
                  chat["chat_id"],
                  `✅ Verified unregistered WhatsApp number!\nPhone: ${phone}\nStatus: Marketplace mein available hai.`
                );
              }
            } catch (tErr) {
              console.error("[Telegram alert error]:", tErr);
            }

            return Response.json({ ok: true, status: "available" });
          } else {
            // Number IS on WhatsApp. Cancel FurySMS activation to refund credit.
            if (row["provider_id"]) {
              cancelFurySmsNumber(row["provider_id"]).catch((e) =>
                console.error("[FurySMS refund cancel error]:", e)
              );
            }

            await db.collection<WaCheckNumberDoc>("wa_check_numbers").updateOne(
              { phone },
              {
                $set: {
                  status: "skipped",
                  note: "WhatsApp par registered mila (Order cancelled & refunded)",
                  updated_at: now,
                },
              }
            );

            return Response.json({ ok: true, status: "skipped" });
          }
        } catch (error) {
          console.error("[wa-result POST error]:", error);
          return Response.json({ ok: false }, { status: 503 });
        }
      },
    },
  },
});
