import { getDb } from "./db.js";

const DEFAULT_BASE_URL = "https://furysms.shop/stubs/handler_api.php";
let cachedConfig = null;
let cachedTime = 0;

export async function getProviderConfig(force = false) {
  const now = Date.now();
  if (!force && cachedConfig && now - cachedTime < 30000) {
    return cachedConfig;
  }
  const defaultBaseUrl = process.env.FURYSMS_BASE_URL || DEFAULT_BASE_URL;
  const defaultApiKey = process.env.FURYSMS_API_KEY || null;

  try {
    const db = await getDb();
    const doc = await db.collection("system_settings").findOne({ _id: "sms_provider" });
    cachedConfig = {
      baseUrl:
        doc && typeof doc.base_url === "string" && doc.base_url.trim()
          ? doc.base_url.trim()
          : defaultBaseUrl,
      apiKey:
        doc && typeof doc.api_key === "string" && doc.api_key.trim()
          ? doc.api_key.trim()
          : defaultApiKey,
      serviceId:
        doc && typeof doc.service_id === "string" && doc.service_id.trim()
          ? doc.service_id.trim()
          : "boyaah",
      countryId:
        doc && typeof doc.country_id === "string" && doc.country_id.trim()
          ? doc.country_id.trim()
          : "22",
    };
    cachedTime = now;
    return cachedConfig;
  } catch {
    return {
      baseUrl: defaultBaseUrl,
      apiKey: defaultApiKey,
      serviceId: "boyaah",
      countryId: "22",
    };
  }
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
  const { baseUrl, apiKey } = await getProviderConfig();
  if (!apiKey) return null;
  const url = `${baseUrl}?api_key=${encodeURIComponent(apiKey)}&action=getBalance`;
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
  const { baseUrl, apiKey } = await getProviderConfig();
  if (!apiKey || !id) return { ok: false, error: "API key or order ID missing" };
  const url = `${baseUrl}?api_key=${encodeURIComponent(apiKey)}&action=regetNumber&id=${encodeURIComponent(id)}`;
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
      return { ok: false, error: `Activation closed or expired on SMS provider (${text})` };
    }

    if (text === "NO_BALANCE") {
      return { ok: false, error: "Insufficient wallet balance on SMS provider" };
    }

    return { ok: false, error: `SMS provider reply: ${text}` };
  } catch (e) {
    console.error("[FurySMS regetNumber error]:", e.message);
    return { ok: false, error: String(e.message || e) };
  }
}

export async function checkFurySmsStatus(id) {
  const { baseUrl, apiKey } = await getProviderConfig();
  if (!apiKey || !id) return { status: "UNKNOWN", code: null, raw: "No API key or ID" };
  const url = `${baseUrl}?api_key=${encodeURIComponent(apiKey)}&action=getStatus&id=${encodeURIComponent(id)}`;
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
  const { baseUrl, apiKey } = await getProviderConfig();
  if (!apiKey || !id) return false;
  const url = `${baseUrl}?api_key=${encodeURIComponent(apiKey)}&action=setStatus&status=8&id=${encodeURIComponent(id)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const text = (await res.text()).trim();
    return text === "ACCESS_CANCEL" || text === "STATUS_CANCEL";
  } catch (e) {
    return false;
  }
}
