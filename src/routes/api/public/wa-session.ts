import { createFileRoute } from "@tanstack/react-router";
import { createHash, timingSafeEqual } from "node:crypto";
import { sessionReportSchema, shouldQueueLogout } from "@/lib/wa-session";
import { sendTelegramMessage } from "@/lib/telegram.server";
import type { WaSessionDoc, BotChatDoc } from "@/integrations/mongodb/client.server";

export const Route = createFileRoute("/api/public/wa-session")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env["TELEGRAM_API_KEY"];
        if (!key) return new Response("Not configured", { status: 503 });
        const expected = createHash("sha256").update(`wa-checker:${key}`).digest("base64url");
        const actual = request.headers.get("X-Checker-Key") ?? "";
        if (actual.length !== expected.length || !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) {
          return new Response("Unauthorized", { status: 401 });
        }
        const parsed = sessionReportSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return new Response("Invalid session report", { status: 400 });

        try {
          const { getDb } = await import("@/integrations/mongodb/client.server");
          const db = await getDb();
          const { sessionId, state } = parsed.data;

          const previous = await db
            .collection<WaSessionDoc>("wa_sessions")
            .findOne({ session_id: sessionId }, { projection: { state: 1 } });

          // A logged-out session cannot reconnect under the same id. The monitor creates a new id.
          if (previous?.["state"] !== "logged_out") {
            const updateDoc: any = {
              $set: {
                session_id: sessionId,
                state,
                updated_at: new Date(),
              },
            };
            if (shouldQueueLogout(previous?.["state"] ?? null, state)) {
              updateDoc.$set.alert_state = "pending";
            }
            await db.collection<WaSessionDoc>("wa_sessions").updateOne({ session_id: sessionId }, updateDoc, { upsert: true });
          }

          // Retry pending alerts on every report; no browser page must stay open for this.
          const pending = await db
            .collection<WaSessionDoc>("wa_sessions")
            .find({ alert_state: "pending" }, { projection: { session_id: 1 } })
            .sort({ updated_at: 1 })
            .limit(10)
            .toArray();

          if (pending?.length) {
            const chat = await db
              .collection<BotChatDoc>("bot_chats")
              .find({}, { projection: { chat_id: 1 } })
              .sort({ updated_at: -1 })
              .limit(1)
              .next();

            if (chat && chat["chat_id"] != null) {
              for (const alert of pending) {
                const targetSessionId = alert["session_id"];
                const claimed = await db.collection<WaSessionDoc>("wa_sessions").findOneAndUpdate(
                  { session_id: targetSessionId, alert_state: "pending" },
                  { $set: { alert_state: "sending" } },
                  { returnDocument: "after" }
                );

                if (!claimed) continue;

                const sendRes = await sendTelegramMessage(
                  chat["chat_id"],
                  "⚠️ WhatsApp logout ho gaya hai. Auto-check ke liye dobara WhatsApp link karein."
                );

                if (!sendRes.ok) {
                  console.error(`Telegram logout alert failed: ${sendRes.error}`);
                  await db.collection<WaSessionDoc>("wa_sessions").updateOne(
                    { session_id: targetSessionId },
                    { $set: { alert_state: "pending", alert_error: sendRes.error ?? null } }
                  );
                  return Response.json({ ok: false, error: sendRes.error }, { status: 502 });
                }

                await db.collection<WaSessionDoc>("wa_sessions").updateOne(
                  { session_id: targetSessionId },
                  {
                    $set: {
                      alert_state: "sent",
                      telegram_message_id: sendRes.messageId ?? null,
                      alert_error: null,
                    },
                  }
                );
              }
            }
          }
          return Response.json({ ok: true });
        } catch (error) {
          console.error("[wa-session POST error]:", error);
          return new Response("Database operation failed", { status: 503 });
        }
      },
    },
  },
});
