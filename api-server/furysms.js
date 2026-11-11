const BASE_URL =
  process.env.FURYSMS_BASE_URL || "https://furysms.shop/stubs/handler_api.php";

function getApiKey() {
  return process.env.FURYSMS_API_KEY || null;
}

export function normalizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  if (digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  return null;
}

export async function getFurySmsBalance() {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  const url = `${BASE_URL}?api_key=${encodeURIComponent(apiKey)}&action=getBalance`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const text = (await res.text()).trim();
    const m = text.match(/^ACCESS_BALANCE:([\d.]+)/);
    return m?.[1] ? parseFloat(m[1]) : null;
  } catch (e) {
    console.error("[FurySMS getBalance error]:", e.message);
    return null;
  }
}

export async function regetFurySmsNumber(id) {
  const apiKey = getApiKey();
  if (!apiKey || !id) return { ok: false, error: "API key or order ID missing" };
  const url = `${BASE_URL}?api_key=${encodeURIComponent(apiKey)}&action=regetNumber&id=${encodeURIComponent(id)}`;
  console.log(`[FurySMS OUTGOING] GET action=regetNumber id=${id}`);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    const text = (await res.text()).trim();
    console.log(`[FurySMS RESPONSE] regetNumber (id=${id}): ${text}`);

    if (text.startsWith("REGET_NUMBER_OK:")) {
      const parts = text.split(":");
      const newOrderId = parts[1];
      const phone = parts[2] ? normalizePhone(parts[2]) || parts[2] : "";
      if (newOrderId) {
        return { ok: true, orderId: newOrderId, phone, status: "NEW_ORDER" };
      }
    }

    if (text === "NUMBER_STILL_ACTIVE") {
      return { ok: true, orderId: id, phone: "", status: "STILL_ACTIVE" };
    }

    if (text === "NO_ACTIVATION" || text === "ERROR" || text === "BAD_ACTION") {
      return { ok: false, error: `Activation closed or expired on FurySMS (${text})` };
    }

    if (text === "NO_BALANCE") {
      return { ok: false, error: "Insufficient wallet balance on FurySMS" };
    }

    return { ok: false, error: `FurySMS reply: ${text}` };
  } catch (e) {
    console.error("[FurySMS regetNumber error]:", e.message);
    return { ok: false, error: String(e.message || e) };
  }
}

export async function checkFurySmsStatus(id) {
  const apiKey = getApiKey();
  if (!apiKey || !id) return { status: "UNKNOWN", code: null, raw: "No API key or ID" };
  const url = `${BASE_URL}?api_key=${encodeURIComponent(apiKey)}&action=getStatus&id=${encodeURIComponent(id)}`;
  console.log(`[FurySMS OUTGOING] GET action=getStatus id=${id}`);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const text = (await res.text()).trim();
    console.log(`[FurySMS RESPONSE] getStatus (id=${id}): ${text}`);

    if (text === "STATUS_WAIT_CODE") {
      return { status: "WAITING", code: null, raw: text };
    }

    if (text.startsWith("STATUS_OK:")) {
      const rawText = text.slice("STATUS_OK:".length).trim();
      const match = rawText.match(/\b(\d{3}[-\s]?\d{3})\b/) || rawText.match(/\b(\d{4,8})\b/);
      const code = match ? match[1].replace(/[-\s]/g, "") : rawText;
      return { status: "OK", code, raw: rawText };
    }

    if (text === "STATUS_CANCEL") {
      return { status: "CANCELLED", code: null, raw: text };
    }

    return { status: "UNKNOWN", code: null, raw: text };
  } catch (e) {
    console.error("[FurySMS checkStatus error]:", e.message);
    return { status: "UNKNOWN", code: null, raw: String(e.message || e) };
  }
}

export async function cancelFurySmsNumber(id) {
  const apiKey = getApiKey();
  if (!apiKey || !id) return false;
  const url = `${BASE_URL}?api_key=${encodeURIComponent(apiKey)}&action=setStatus&status=8&id=${encodeURIComponent(id)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const text = (await res.text()).trim();
    return text === "ACCESS_CANCEL" || text === "STATUS_CANCEL";
  } catch (e) {
    return false;
  }
}

