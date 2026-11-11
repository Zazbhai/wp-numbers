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
          $setOnInsert: { phone: res.phone, status: "pending", note: null, created_at: now },
          $set: { provider_id: res.id, updated_at: now },
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
            // --- TWO-PASS VERIFICATION ---
            // First pass: status "pending" → "pending_verify" (needs a second independent check)
            // Second pass: status "pending_verify" → "available" (confirmed unregistered)
            const isFirstPass = row["status"] === "pending";
            const isSecondPass = row["status"] === "pending_verify";

            if (isFirstPass) {
              // Mark as needing a second-pass re-check; NOT yet visible in marketplace
              await db.collection<WaCheckNumberDoc>("wa_check_numbers").updateOne(
                { phone, status: "pending" },
                {
                  $set: {
                    status: "pending_verify",
                    verify_count: 1,
                    first_found_at: now,
                    note: "First pass: unregistered detected. Awaiting second-pass confirmation.",
                    updated_at: now,
                  },
                }
              );
              return Response.json({ ok: true, status: "pending_verify" });
            }

            if (isSecondPass) {
              // Second confirmation — now it's truly unregistered. Show in marketplace.
              await db.collection<WaCheckNumberDoc>("wa_check_numbers").updateOne(
                { phone, status: "pending_verify" },
                {
                  $set: {
                    status: "available",
                    verify_count: 2,
                    note: "Double-verified unregistered (Available in Marketplace)",
                    updated_at: now,
                  },
                }
              );

              // Telegram notification only after double-confirmation
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
                    `✅ Double-verified unregistered number!\nPhone: ${phone}\nStatus: Marketplace mein available hai.`
                  );
                }
              } catch (tErr) {
                console.error("[Telegram alert error]:", tErr);
              }

              return Response.json({ ok: true, status: "available" });
            }

            // For any other status (e.g. available, completed), just acknowledge
            return Response.json({ ok: true, status: row["status"] });
          } else {
            // Number IS on WhatsApp. Cancel FurySMS activation to refund credit if first-pass.
            if (row["status"] === "pending" && row["provider_id"]) {
              cancelFurySmsNumber(row["provider_id"]).catch((e) =>
                console.error("[FurySMS refund cancel error]:", e)
              );
            }

            const wasFirstPass = row["status"] === "pending";
            const wasSecondPass = row["status"] === "pending_verify";

            await db.collection<WaCheckNumberDoc>("wa_check_numbers").updateOne(
              { phone },
              {
                $set: {
                  status: "skipped",
                  note: wasSecondPass
                    ? "Second-pass confirmed REGISTERED on WhatsApp (false positive corrected)"
                    : wasFirstPass
                      ? "WhatsApp par registered mila (Order cancelled & refunded)"
                      : "WhatsApp par registered mila",
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
