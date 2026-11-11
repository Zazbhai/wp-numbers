import { parseLookup } from "./identity";
import { sendTelegramMessage } from "./telegram.server";
import type { RegisteredUserDoc, WaCheckNumberDoc, BotChatDoc } from "@/integrations/mongodb/client.server";

export async function handleTelegramUpdate(update: any, siteOrigin = "http://localhost:8080"): Promise<void> {
  const msg = update?.message;
  const chatId: number | undefined = msg?.chat?.id;
  const text: string = typeof msg?.text === "string" ? msg.text.trim().slice(0, 200) : "";
  if (!chatId) return;

  const { getDb } = await import("@/integrations/mongodb/client.server");
  const db = await getDb();

  await db.collection<BotChatDoc>("bot_chats").updateOne(
    { chat_id: chatId },
    {
      $set: {
        chat_id: chatId,
        first_name: msg?.from?.first_name ?? null,
        updated_at: new Date(),
      },
    },
    { upsert: true }
  );

  // Deliver numbers that were found while no Telegram chat existed.
  const held = await db
    .collection<WaCheckNumberDoc>("wa_check_numbers")
    .find({ status: "found" }, { projection: { phone: 1 } })
    .limit(50)
    .toArray();

  if (held && held.length) {
    const phones = held.map((h) => h["phone"]);
    await sendTelegramMessage(chatId, `WhatsApp screen par invite / not-on-WhatsApp text mila:\n${phones.join("\n")}`);
    await db.collection<WaCheckNumberDoc>("wa_check_numbers").updateMany(
      { phone: { $in: phones }, status: "found" },
      {
        $set: {
          status: "sent",
          note: "Invite / not-on-WhatsApp text mila",
          updated_at: new Date(),
        },
      }
    );
  }

  if (!text || text.startsWith("/start") || text.startsWith("/help")) {
    await sendTelegramMessage(
      chatId,
      "Namaste! 👋\nApna email ya phone number bhejiye, main bataunga ki aap registered ho ya nahi.\n/stats — checker ka hisaab"
    );
    return;
  }

  if (text.startsWith("/stats")) {
    const [users, total, pending, sent, skipped] = await Promise.all([
      db.collection<RegisteredUserDoc>("registered_users").countDocuments(),
      db.collection<WaCheckNumberDoc>("wa_check_numbers").countDocuments(),
      db.collection<WaCheckNumberDoc>("wa_check_numbers").countDocuments({ status: "pending" }),
      db.collection<WaCheckNumberDoc>("wa_check_numbers").countDocuments({ status: "sent" }),
      db.collection<WaCheckNumberDoc>("wa_check_numbers").countDocuments({ status: "skipped" }),
    ]);
    await sendTelegramMessage(
      chatId,
      `📊 Stats\nRegistered users: ${users}\nNumbers: ${total}\nCheck baaki: ${pending}\nTelegram par bheje: ${sent}\nSkip: ${skipped}`
    );
    return;
  }

  const lookup = parseLookup(text);
  if (!lookup) {
    await sendTelegramMessage(chatId, "Sahi email ya phone number bhejein. Example: name@gmail.com ya 9876543210");
    return;
  }

  const userDoc = await db.collection<RegisteredUserDoc>("registered_users").findOne(
    { [lookup.kind]: lookup.value },
    { projection: { name: 1 } }
  );

  if (userDoc) {
    const first = userDoc["name"].split(" ")[0];
    await sendTelegramMessage(chatId, `✅ Registered hai (naam: ${first})`);
  } else {
    await sendTelegramMessage(chatId, `❌ Registered nahi hai.\nYahan register karein: ${siteOrigin}/register`);
  }
}

