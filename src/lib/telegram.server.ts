export async function sendTelegramMessage(
  chatId: number,
  text: string,
): Promise<{ ok: boolean; messageId?: number; error?: string }> {
  const token = process.env["TELEGRAM_API_KEY"];
  if (!token) {
    return { ok: false, error: "TELEGRAM_API_KEY is not configured" };
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      const err = `Telegram error [${res.status}]: ${JSON.stringify(data)}`;
      console.error(err);
      return { ok: false, error: err };
    }
    return { ok: true, messageId: data.result?.message_id };
  } catch (err: any) {
    const errStr = err?.message || String(err);
    console.error("[sendTelegramMessage error]:", errStr);
    return { ok: false, error: errStr };
  }
}

