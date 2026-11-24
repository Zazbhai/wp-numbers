import { createFileRoute } from "@tanstack/react-router";
import { createHash, timingSafeEqual } from "crypto";
import { randomUUID } from "node:crypto";
import { normalizePhone } from "@/lib/identity";
import { waResultSchema } from "@/lib/wa-result-schema";
import { getWhatsAppCheckTransition } from "@/lib/wa-session";
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

async function claimWorkQueue(db: Db, slot: number, limit = 1) {
  const collection = db.collection<WaCheckNumberDoc>("wa_check_numbers");
  const now = new Date();
  const claimUntil = new Date(now.getTime() + 90_000);
  const claimedPhones: string[] = [];
  const docs: Array<Pick<WaCheckNumberDoc, "phone" | "status" | "checker_claim_id">> = [];

  for (let i = 0; i < limit; i++) {
    const doc = await collection.findOneAndUpdate(
      {
        status: { $in: ["pending", "pending_verify"] },
        phone: { $nin: claimedPhones },
        $or: [
          { checker_claim_until: { $lte: now } },
          { checker_claim_until: { $exists: false } },
        ],
      },
      {
        $set: {
          checker_slot: slot,
          checker_claimed_at: now,
          checker_claim_until: claimUntil,
          checker_claim_id: randomUUID(),
        },
      },
      {
        sort: { status: 1, created_at: 1 },
        projection: { _id: 0, phone: 1, status: 1, checker_claim_id: 1 },
        returnDocument: "after",
      },
    );
    if (!doc) break;
    if (!doc.checker_claim_id) break;
    claimedPhones.push(doc.phone);
    docs.push({ phone: doc.phone, status: doc.status, checker_claim_id: doc.checker_claim_id });
  }
  return docs;
}

export async function refillPendingNumbers(db: Db, target = 6) {
  if (isRefilling) return;
  isRefilling = true;
  try {
    const pendingCount = await db.collection<WaCheckNumberDoc>("wa_check_numbers").countDocuments({ status: "pending" });
    const need = Math.max(0, target - pendingCount);
    if (need <= 0) return;

    for (let i = 0; i < need; i++) {
      const res = await requestFurySmsNumber();
      if (!res) {
        // Break early if balance empty or temporary FurySMS issue
        break;
      }
      const now = new Date();
      const existing = await db.collection<WaCheckNumberDoc>("wa_check_numbers").findOne(
        { phone: res.phone },
        { projection: { status: 1 } },
      );
      if (existing) continue;
      try {
        await db.collection<WaCheckNumberDoc>("wa_check_numbers").insertOne({
          phone: res.phone,
          status: "pending",
          provider_id: res.id,
          note: "Refilled from FurySMS",
          created_at: now,
          updated_at: now,
        });
      } catch (error: unknown) {
        // Another refill worker may have inserted the same provider number.
        if ((error as { code?: number })?.code !== 11000) throw error;
        continue;
      }
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

          // Claim work atomically so multiple monitor slots cannot check the same number.
          const getWorkQueue = () => claimWorkQueue(db, slot, 1);

          let docs = await getWorkQueue();
          if (docs.length === 0) {
            // Trigger engine to maintain pipeline towards 50 unregistered numbers
            const { maintainCheckerPipeline } = await import("@/lib/checker-engine.server");
            await maintainCheckerPipeline();
            docs = await getWorkQueue();
          }

          const numbers = docs.map((d) => ({ phone: d["phone"], claimId: d["checker_claim_id"] }));
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
          const claimId = parsed.data.claimId;
        if (!phone) return Response.json({ ok: false, error: "invalid phone" }, { status: 400 });

        try {
          const { getDb } = await import("@/integrations/mongodb/client.server");
          const db = await getDb();

          const phoneVariants = [phone, phone.replace(/^\+/, ""), phone.startsWith("+") ? phone : `+${phone}`];
          const row = await db.collection<WaCheckNumberDoc>("wa_check_numbers").findOne({ phone: { $in: phoneVariants } });
          if (!row) return Response.json({ ok: false }, { status: 404 });
          // Only process numbers that are pending a check (first or second pass)
          if (row["checker_claim_id"] !== claimId) {
            return Response.json({ ok: false, error: "stale claim" }, { status: 409 });
          }
          if (row["status"] !== "pending" && row["status"] !== "pending_verify") {
            return Response.json({ ok: true, status: row["status"] });
          }

          const now = new Date();

          const claim = await db.collection<WaCheckNumberDoc>("wa_check_numbers").findOneAndUpdate(
            { phone: row["phone"], checker_claim_id: claimId, status: row["status"] },
            {
              $set: {
                checker_claim_id: randomUUID(),
                checker_claim_until: new Date(now.getTime() + 90_000),
              },
            },
            { returnDocument: "after" },
          );
          if (!claim?.checker_claim_id) {
            return Response.json({ ok: false, error: "claim already completed" }, { status: 409 });
          }
          const activeClaimId = claim.checker_claim_id;
          const nextStatus = getWhatsAppCheckTransition(row["status"], found);

          if (nextStatus === "pending_verify") {
            await db.collection<WaCheckNumberDoc>("wa_check_numbers").updateOne(
              { phone: row["phone"], status: "pending", checker_claim_id: activeClaimId },
              {
                $set: {
                  status: "pending_verify",
                  verify_count: 1,
                  first_found_at: now,
                  note: "First unregistered result; awaiting independent confirmation",
                  updated_at: now,
                },
                $unset: {
                  checker_slot: "",
                  checker_claimed_at: "",
                  checker_claim_until: "",
                  checker_claim_id: "",
                },
              },
            );
            return Response.json({ ok: true, status: "pending_verify" });
          }

          if (nextStatus === "available") {
            // A second independent unregistered result confirms marketplace availability.
            const confirmed = await db.collection<WaCheckNumberDoc>("wa_check_numbers").updateOne(
              { phone: row["phone"], status: "pending_verify", checker_claim_id: activeClaimId },
              {
                $set: {
                  status: "available",
                  verify_count: 2,
                  note: "Verified unregistered (Available in Marketplace)",
                  updated_at: now,
                },
                $unset: {
                  owner_user_id: "",
                  active_order_id: "",
                  wallet_purchase_id: "",
                  otp: "",
                  checker_slot: "",
                  checker_claimed_at: "",
                  checker_claim_until: "",
                  checker_claim_id: "",
                },
              }
            );
            if (confirmed.modifiedCount !== 1) {
              const current = await db.collection<WaCheckNumberDoc>("wa_check_numbers").findOne(
                { phone: row["phone"] },
                { projection: { status: 1 } },
              );
              return Response.json({ ok: true, status: current?.status ?? "pending_verify" });
            }

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
            const skipped = await db.collection<WaCheckNumberDoc>("wa_check_numbers").updateOne(
              {
                phone: row["phone"],
                status: { $in: ["pending", "pending_verify"] },
                checker_claim_id: activeClaimId,
              },
              {
                $set: {
                  status: "skipped",
                  note: "WhatsApp par registered mila (Order cancelled & refunded)",
                  updated_at: now,
                },
                $unset: {
                  checker_slot: "",
                  checker_claimed_at: "",
                  checker_claim_until: "",
                  checker_claim_id: "",
                },
              },
            );
            if (skipped.modifiedCount !== 1) {
              const current = await db.collection<WaCheckNumberDoc>("wa_check_numbers").findOne(
                { phone: row["phone"] },
                { projection: { status: 1 } },
              );
              return Response.json({ ok: true, status: current?.status ?? "skipped" });
            }
            if (row["provider_id"]) {
              cancelFurySmsNumber(row["provider_id"]).catch((e) =>
                console.error("[FurySMS refund cancel error]:", e)
              );
            }

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
