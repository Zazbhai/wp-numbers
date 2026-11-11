import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";

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

  const domain = process.argv[2]?.trim().replace(/\/+$/, "");
  if (!domain) {
    console.log("Usage: pnpm run bot:webhook <PUBLIC_HTTPS_DOMAIN>");
    console.log("Example: pnpm run bot:webhook https://mywebsite.com");
    process.exit(1);
  }

  const webhookUrl = `${domain}/api/public/telegram/webhook`;
  const secret = createHash("sha256").update(`telegram-webhook:${token}`).digest("base64url");

  console.log(`Setting Telegram webhook for @bot to: ${webhookUrl}`);

  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: secret,
      drop_pending_updates: false,
    }),
  });

  const data = await res.json();
  if (data?.ok) {
    console.log("✅ Webhook configured successfully!");
    console.log("Response:", data);
  } else {
    console.error("❌ Failed to set webhook:", data);
  }
}

main();

