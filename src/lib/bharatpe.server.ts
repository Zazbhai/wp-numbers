import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { BharatPePaymentSettingsDoc } from "@/integrations/mongodb/client.server";

const SETTINGS_ID = "bharatpe" as const;
const SUCCESS_STATUSES = new Set(["SUCCESS", "SUCCESSFUL", "COMPLETED", "PAYMENT_SUCCESS"]);

export function isPaymentSystemDisabledByEnv() {
  const setting = process.env["PAYMENT_SYSTEM_ENABLED"]?.trim().toLowerCase();
  return setting === "false" || setting === "0";
}

export function validateBharatPeTransactions(
  payload: unknown,
  utr: string,
  expectedAmount: number,
) {
  const transactions = (payload as { data?: { transactions?: unknown[] } } | null)?.data
    ?.transactions;
  const transaction = transactions?.find((item) => {
    if (!item || typeof item !== "object") return false;
    const row = item as Record<string, unknown>;
    return String(row["bankReferenceNo"] ?? "").trim() === utr;
  }) as Record<string, unknown> | undefined;

  if (!transaction) return { ok: false as const, reason: "not_found" as const };
  const amount = Number(transaction["amount"]);
  const status = String(transaction["status"] ?? "")
    .trim()
    .toUpperCase();
  if (!Number.isFinite(amount) || amount !== expectedAmount || !SUCCESS_STATUSES.has(status)) {
    return { ok: false as const, reason: "mismatch" as const };
  }

  return {
    ok: true as const,
    amount,
    status,
    transactionId: String(
      transaction["id"] ?? transaction["transactionId"] ?? transaction["bankReferenceNo"],
    ),
  };
}

function encryptionKey() {
  const encoded = process.env["PAYMENT_CONFIG_ENCRYPTION_KEY"];
  if (!encoded) throw new Error("PAYMENT_CONFIG_ENCRYPTION_KEY is not configured");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32)
    throw new Error("PAYMENT_CONFIG_ENCRYPTION_KEY must be 32 bytes in base64");
  return key;
}

function encrypt(value: string) {
  if (!value) return "";
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${encrypted.toString("base64")}`;
}

function decrypt(value: string) {
  if (!value) return "";
  const [ivPart, tagPart, encryptedPart] = value.split(".");
  if (!ivPart || !tagPart || !encryptedPart) throw new Error("Invalid encrypted payment setting");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivPart, "base64"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export async function getPaymentSettings() {
  const { getDb } = await import("@/integrations/mongodb/client.server");
  return (
    (await (
      await getDb()
    )
      .collection<BharatPePaymentSettingsDoc>("payment_settings")
      .findOne({ _id: SETTINGS_ID })) ?? {
      _id: SETTINGS_ID,
      enabled: false,
      merchant_id: "",
      access_token_encrypted: "",
      session_cookie_encrypted: "",
      upi_id: "",
      merchant_name: "",
      updated_at: new Date(0),
    }
  );
}

export async function savePaymentSettings(input: {
  enabled: boolean;
  merchantId: string;
  accessToken?: string | undefined;
  sessionCookie?: string | undefined;
  upiId: string;
  merchantName: string;
}) {
  const { getDb } = await import("@/integrations/mongodb/client.server");
  const collection = (await getDb()).collection<BharatPePaymentSettingsDoc>("payment_settings");
  const previous = await collection.findOne({ _id: SETTINGS_ID });
  const accessToken = input.accessToken
    ? encrypt(input.accessToken)
    : (previous?.access_token_encrypted ?? "");
  const sessionCookie = input.sessionCookie
    ? encrypt(input.sessionCookie)
    : (previous?.session_cookie_encrypted ?? "");

  if (input.enabled && (!input.merchantId || !accessToken || !input.upiId || !input.merchantName)) {
    throw new Error(
      "Merchant ID, access token, UPI ID, and merchant name are required when enabled",
    );
  }
  await collection.updateOne(
    { _id: SETTINGS_ID },
    {
      $set: {
        enabled: input.enabled,
        merchant_id: input.merchantId,
        access_token_encrypted: accessToken,
        session_cookie_encrypted: sessionCookie,
        upi_id: input.upiId,
        merchant_name: input.merchantName,
        updated_at: new Date(),
      },
    },
    { upsert: true },
  );
}

export async function getPaymentSettingsForAdmin() {
  const settings = await getPaymentSettings();
  return {
    enabled: settings.enabled,
    environmentDisabled: isPaymentSystemDisabledByEnv(),
    merchantId: settings.merchant_id,
    upiId: settings.upi_id,
    merchantName: settings.merchant_name,
    hasAccessToken: Boolean(settings.access_token_encrypted),
    hasSessionCookie: Boolean(settings.session_cookie_encrypted),
  };
}

export async function getPublicPaymentSettings() {
  const settings = await getPaymentSettings();
  const testingMode = isPaymentSystemDisabledByEnv();
  return {
    enabled: !testingMode && settings.enabled && Boolean(settings.upi_id),
    testingMode,
    upiId: settings.upi_id,
    merchantName: settings.merchant_name,
  };
}

export async function verifyBharatPePayment(utr: string, expectedAmount: number) {
  if (isPaymentSystemDisabledByEnv()) return { ok: false as const, reason: "disabled" as const };
  const settings = await getPaymentSettings();
  if (!settings.enabled) return { ok: false as const, reason: "disabled" as const };

  let accessToken: string;
  let sessionCookie: string;
  try {
    accessToken = decrypt(settings.access_token_encrypted);
    sessionCookie = decrypt(settings.session_cookie_encrypted);
  } catch (error) {
    console.error("[BharatPe config decrypt]", error);
    return { ok: false as const, reason: "configuration" as const };
  }
  if (!settings.merchant_id || !accessToken) {
    return { ok: false as const, reason: "configuration" as const };
  }

  const url = new URL("https://payments-tesseract.bharatpe.in/api/v1/merchant/transactions");
  url.searchParams.set("module", "PAYMENT_QR");
  url.searchParams.set("merchantId", settings.merchant_id);
  const headers = new Headers({
    token: accessToken,
    "User-Agent": "Mozilla/5.0",
    Accept: "application/json",
    Referer: "https://dashboard.bharatpe.in/",
  });
  if (sessionCookie) headers.set("Cookie", sessionCookie);

  let payload: unknown;
  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      console.error(`[BharatPe verify] HTTP ${response.status}`);
      return { ok: false as const, reason: "provider" as const };
    }
    payload = await response.json();
  } catch (error) {
    console.error("[BharatPe verify request]", error instanceof Error ? error.message : error);
    return { ok: false as const, reason: "provider" as const };
  }

  return validateBharatPeTransactions(payload, utr, expectedAmount);
}
