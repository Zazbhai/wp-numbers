import { normalizePhone } from "./identity";

const BASE_URL = "https://furysms.shop/stubs/handler_api.php";

function getApiKey(): string | null {
  return process.env["FURYSMS_API_KEY"] || null;
}

export async function getFurySmsBalance(): Promise<number | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  const url = `${BASE_URL}?api_key=${encodeURIComponent(apiKey)}&action=getBalance`;
  try {
    const res = await fetch(url);
    const text = (await res.text()).trim();
    const m = text.match(/^ACCESS_BALANCE:([\d.]+)/);
    return m?.[1] ? parseFloat(m[1]) : null;
  } catch (e) {
    console.error("[FurySMS getBalance error]:", e);
    return null;
  }
}

export async function requestFurySmsNumberWithDetails(
  service = "boyaah",
  country = "22"
): Promise<{ ok: true; id: string; phone: string } | { ok: false; error: string }> {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.error("[FurySMS getNumber] FURYSMS_API_KEY is missing from environment!");
    return { ok: false, error: "FURYSMS_API_KEY is not configured" };
  }
  const url = `${BASE_URL}?api_key=${encodeURIComponent(apiKey)}&action=getNumber&service=${encodeURIComponent(service)}&country=${encodeURIComponent(country)}`;
  try {
    const res = await fetch(url);
    const text = (await res.text()).trim();
    console.log(`[FurySMS getNumber] Response: ${text}`);
    const m = text.match(/^ACCESS_NUMBER:([^:]+):(\+?\d+)$/);
    if (!m?.[1] || !m?.[2]) {
      return { ok: false, error: text || "Empty response from FurySMS" };
    }
    const phone = normalizePhone(m[2]);
    if (!phone) return { ok: false, error: `Invalid phone format: ${m[2]}` };
    return { ok: true, id: m[1], phone };
  } catch (e) {
    console.error("[FurySMS getNumber error]:", e);
    return { ok: false, error: String(e) };
  }
}

export async function requestFurySmsNumber(
  service = "boyaah",
  country = "22"
): Promise<{ id: string; phone: string } | null> {
  const res = await requestFurySmsNumberWithDetails(service, country);
  return res.ok ? { id: res.id, phone: res.phone } : null;
}

export type RegetNumberResult =
  | { ok: true; orderId: string; phone: string; status: "NEW_ORDER" | "STILL_ACTIVE" }
  | { ok: false; error: string };

export async function regetFurySmsNumber(id: string): Promise<RegetNumberResult> {
  const apiKey = getApiKey();
  if (!apiKey || !id) return { ok: false, error: "API key or order ID missing" };
  const url = `${BASE_URL}?api_key=${encodeURIComponent(apiKey)}&action=regetNumber&id=${encodeURIComponent(id)}`;
  console.log(`[FurySMS OUTGOING] GET action=regetNumber id=${id}`);
  try {
    const res = await fetch(url);
    const text = (await res.text()).trim();
    console.log(`[FurySMS RESPONSE] regetNumber (id=${id}): ${text}`);

    if (text.startsWith("REGET_NUMBER_OK:")) {
      // Format: REGET_NUMBER_OK:NewOrderId:PhoneNumber
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
    console.error("[FurySMS regetNumber error]:", e);
    return { ok: false, error: String(e) };
  }
}

export async function cancelFurySmsNumber(id: string): Promise<boolean> {
  const apiKey = getApiKey();
  if (!apiKey || !id) return false;
  const url = `${BASE_URL}?api_key=${encodeURIComponent(apiKey)}&action=setStatus&status=8&id=${encodeURIComponent(id)}`;
  try {
    const res = await fetch(url);
    const text = (await res.text()).trim();
    return text === "ACCESS_CANCEL" || text === "STATUS_CANCEL";
  } catch (e) {
    return false;
  }
}

export async function completeFurySmsActivation(id: string): Promise<boolean> {
  const apiKey = getApiKey();
  if (!apiKey || !id) return false;
  const url = `${BASE_URL}?api_key=${encodeURIComponent(apiKey)}&action=setStatus&status=6&id=${encodeURIComponent(id)}`;
  try {
    const res = await fetch(url);
    const text = (await res.text()).trim();
    return text === "ACCESS_ACTIVATION";
  } catch (e) {
    return false;
  }
}

export type SmsStatusResult =
  | { status: "WAITING"; code: null; raw: string }
  | { status: "OK"; code: string; raw: string }
  | { status: "CANCELLED"; code: null; raw: string }
  | { status: "UNKNOWN"; code: null; raw: string };

export async function checkFurySmsStatus(id: string): Promise<SmsStatusResult> {
  const apiKey = getApiKey();
  if (!apiKey || !id) return { status: "UNKNOWN", code: null, raw: "No API key or ID" };
  const url = `${BASE_URL}?api_key=${encodeURIComponent(apiKey)}&action=getStatus&id=${encodeURIComponent(id)}`;
  console.log(`[FurySMS OUTGOING] GET action=getStatus id=${id}`);
  try {
    const res = await fetch(url);
    const text = (await res.text()).trim();
    console.log(`[FurySMS RESPONSE] getStatus (id=${id}): ${text}`);

    if (text === "STATUS_WAIT_CODE") {
      return { status: "WAITING", code: null, raw: text };
    }

    if (text.startsWith("STATUS_OK:")) {
      const rawText = text.slice("STATUS_OK:".length).trim();
      // Extract OTP: look for 6-digit or 4-8 digit code from message (e.g. "<#> 265421 is your code")
      const match = rawText.match(/\b(\d{3}[-\s]?\d{3})\b/) || rawText.match(/\b(\d{4,8})\b/);
      const code = match ? match[1]!.replace(/[-\s]/g, "") : rawText;
      return { status: "OK", code, raw: rawText };
    }

    if (text === "STATUS_CANCEL") {
      return { status: "CANCELLED", code: null, raw: text };
    }

    return { status: "UNKNOWN", code: null, raw: text };
  } catch (e) {
    console.error("[FurySMS checkStatus error]:", e);
    return { status: "UNKNOWN", code: null, raw: String(e) };
  }
}
