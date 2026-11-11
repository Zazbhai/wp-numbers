import * as fs from "fs";
import * as path from "path";
import { handleTelegramUpdate } from "../src/lib/telegram-bot.server";

function loadEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

async function main() {
  loadEnv();

  const token = process.env["TELEGRAM_API_KEY"];
  if (!token) {
    console.error("❌ TELEGRAM_API_KEY is not set in .env!");
    process.exit(1);
  }

  console.log("==========================================");
  console.log("      Telegram Bot Long Polling Runner     ");
  console.log("==========================================\n");

  // Verify bot identity
  try {
    const meRes = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const me = await meRes.json();
    if (!me.ok) {
      console.error("❌ Telegram token is invalid:", me.description);
      process.exit(1);
    }
    console.log(`🤖 Logged in as: @${me.result.username} (${me.result.first_name})`);

    // Ensure webhook is removed so polling receives updates
    const hookInfoRes = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
    const hookInfo = await hookInfoRes.json();
    if (hookInfo?.result?.url) {
      console.log(`Clearing existing webhook (${hookInfo.result.url}) for local polling...`);
      await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`);
      console.log("✅ Webhook cleared.");
    }
  } catch (err: any) {
    console.error("❌ Network error connecting to Telegram:", err?.message || err);
    process.exit(1);
  }

  console.log("\n🚀 Listening for messages on Telegram... Send a message to your bot!");
  console.log("Press Ctrl+C to stop.\n");

  let offset = 0;
  let running = true;

  process.on("SIGINT", () => {
    console.log("\nStopping bot polling...");
    running = false;
    process.exit(0);
  });

  while (running) {
    try {
      const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=20`;
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      const data = await res.json();

      if (data?.ok && Array.isArray(data.result)) {
        for (const update of data.result) {
          offset = Math.max(offset, (update.update_id ?? 0) + 1);
          const from = update.message?.from?.first_name || "Unknown";
          const text = update.message?.text || "(non-text)";
          console.log(`📩 [${new Date().toLocaleTimeString()}] From ${from}: "${text}"`);
          try {
            await handleTelegramUpdate(update);
            console.log(`   ↳ Reply sent successfully!`);
          } catch (handlerErr: any) {
            console.error(`   ↳ Error handling message:`, handlerErr?.message || handlerErr);
          }
        }
      } else if (!data?.ok) {
        console.warn("Telegram warning:", data?.description);
        await new Promise((r) => setTimeout(r, 3000));
      }
    } catch (pollErr: any) {
      if (pollErr?.name !== "TimeoutError") {
        console.error("Polling error:", pollErr?.message || pollErr);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }
}

main();

