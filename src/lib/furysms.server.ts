import { normalizePhone } from "./identity";
import type { SmsProviderSettingsDoc } from "@/integrations/mongodb/client.server";

export interface SmsProviderConfig {
  baseUrl: string;
  serviceId: string;
  countryId: string;
  apiKey: string | null;
}

const DEFAULT_BASE_URL = "https://furysms.shop/stubs/handler_api.php";
const DEFAULT_SERVICE_ID = "boyaah";
const DEFAULT_COUNTRY_ID = "22";

let cachedConfig: { config: SmsProviderConfig; expiresAt: number } | null = null;

export async function getSmsProviderConfig(forceRefresh = false): Promise<SmsProviderConfig> {
  const now = Date.now();
  if (!forceRefresh && cachedConfig && cachedConfig.expiresAt > now) {
    return cachedConfig.config;
  }

  const defaultBaseUrl = process.env["FURYSMS_BASE_URL"] || DEFAULT_BASE_URL;
  const defaultService = process.env["FURYSMS_SERVICE_ID"] || DEFAULT_SERVICE_ID;
  const defaultCountry = process.env["FURYSMS_COUNTRY_ID"] || DEFAULT_COUNTRY_ID;
  const defaultApiKey = process.env["FURYSMS_API_KEY"] || null;

  try {
    const { getDb } = await import("@/integrations/mongodb/client.server");
    const db = await getDb();
    const doc = await db.collection<SmsProviderSettingsDoc>("system_settings").findOne({ _id: "sms_provider" });

    const config: SmsProviderConfig = {
      baseUrl:
        typeof doc?.base_url === "string" && doc.base_url.trim() ? doc.base_url.trim() : defaultBaseUrl,
      serviceId:
        typeof doc?.service_id === "string" && doc.service_id.trim()
          ? doc.service_id.trim()
          : defaultService,
      countryId:
        typeof doc?.country_id === "string" && doc.country_id.trim()
          ? doc.country_id.trim()
          : defaultCountry,
      apiKey:
        typeof doc?.api_key === "string" && doc.api_key.trim() ? doc.api_key.trim() : defaultApiKey,
    };

    cachedConfig = { config, expiresAt: now + 30000 };
    return config;
  } catch {
    return {
      baseUrl: defaultBaseUrl,
      serviceId: defaultService,
      countryId: defaultCountry,
      apiKey: defaultApiKey,
    };
  }
}

export function clearSmsProviderConfigCache() {
  cachedConfig = null;
}

export async function getFurySmsBalance(
  overrideConfig?: Partial<SmsProviderConfig>,
): Promise<number | null> {
  const cfg = await getSmsProviderConfig();
  const apiKey = overrideConfig?.apiKey ?? cfg.apiKey;
  const baseUrl = overrideConfig?.baseUrl ?? cfg.baseUrl;
  if (!apiKey) return null;

  const url = `${baseUrl}?api_key=${encodeURIComponent(apiKey)}&action=getBalance`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const text = (await res.text()).trim();
    const m = text.match(/^ACCESS_BALANCE:([\d.]+)/);
    return m?.[1] ? parseFloat(m[1]) : null;
  } catch (e) {
    console.error("[FurySMS getBalance error]:", e);
    return null;
  }
}

export async function requestFurySmsNumberWithDetails(
  service?: string,
  country?: string,
): Promise<{ ok: true; id: string; phone: string } | { ok: false; error: string }> {
  const cfg = await getSmsProviderConfig();
  const apiKey = cfg.apiKey;
  const targetService = service || cfg.serviceId;
  const targetCountry = country || cfg.countryId;
  const baseUrl = cfg.baseUrl;

  if (!apiKey) {
    console.error("[FurySMS getNumber] FURYSMS_API_KEY is missing from environment and database!");
    return { ok: false, error: "SMS Provider API key is not configured" };
  }
  const url = `${baseUrl}?api_key=${encodeURIComponent(apiKey)}&action=getNumber&service=${encodeURIComponent(targetService)}&country=${encodeURIComponent(targetCountry)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    const text = (await res.text()).trim();
    console.log(`[FurySMS getNumber] Response (${targetService}, c=${targetCountry}): ${text}`);
    const m = text.match(/^ACCESS_NUMBER:([^:]+):(\+?\d+)$/);
    if (!m?.[1] || !m?.[2]) {
      return { ok: false, error: text || "Empty response from SMS provider" };
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
  service?: string,
  country?: string,
): Promise<{ id: string; phone: string } | null> {
  const res = await requestFurySmsNumberWithDetails(service, country);
  return res.ok ? { id: res.id, phone: res.phone } : null;
}

export type RegetNumberResult =
  | { ok: true; orderId: string; phone: string; status: "NEW_ORDER" | "STILL_ACTIVE" }
  | { ok: false; error: string };

export async function regetFurySmsNumber(id: string): Promise<RegetNumberResult> {
  const { baseUrl, apiKey } = await getSmsProviderConfig();
  if (!apiKey || !id) return { ok: false, error: "API key or order ID missing" };
  const url = `${baseUrl}?api_key=${encodeURIComponent(apiKey)}&action=regetNumber&id=${encodeURIComponent(id)}`;
  console.log(`[FurySMS OUTGOING] GET action=regetNumber id=${id}`);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
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
      return { ok: false, error: `Activation closed or expired on SMS provider (${text})` };
    }

    if (text === "NO_BALANCE") {
      return { ok: false, error: "Insufficient wallet balance on SMS provider" };
    }

    return { ok: false, error: `SMS provider reply: ${text}` };
  } catch (e) {
    console.error("[FurySMS regetNumber error]:", e);
    return { ok: false, error: String(e) };
  }
}

export async function cancelFurySmsNumber(id: string): Promise<boolean> {
  const { baseUrl, apiKey } = await getSmsProviderConfig();
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

export async function completeFurySmsActivation(id: string): Promise<boolean> {
  const { baseUrl, apiKey } = await getSmsProviderConfig();
  if (!apiKey || !id) return false;
  const url = `${baseUrl}?api_key=${encodeURIComponent(apiKey)}&action=setStatus&status=6&id=${encodeURIComponent(id)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
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
  const { baseUrl, apiKey } = await getSmsProviderConfig();
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
