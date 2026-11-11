import { createFileRoute } from "@tanstack/react-router";
import { createHash, timingSafeEqual } from "crypto";
import { handleTelegramUpdate } from "@/lib/telegram-bot.server";

function deriveSecret(key: string) {
  return createHash("sha256").update(`telegram-webhook:${key}`).digest("base64url");
}
function safeEqual(a: string, b: string) {
  const l = Buffer.from(a);
  const r = Buffer.from(b);
  return l.length === r.length && timingSafeEqual(l, r);
}

export const Route = createFileRoute("/api/public/telegram/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env["TELEGRAM_API_KEY"];
        if (!key) return new Response("Not configured", { status: 500 });
        const got = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
        if (!safeEqual(got, deriveSecret(key))) return new Response("Unauthorized", { status: 401 });

        const update = await request.json().catch(() => null);
        if (!update) return Response.json({ ok: true });

        const site = new URL(request.url).origin;
        try {
          await handleTelegramUpdate(update, site);
        } catch (err) {
          console.error("[telegram webhook error]:", err);
        }
        return Response.json({ ok: true });
      },
    },
  },
});
