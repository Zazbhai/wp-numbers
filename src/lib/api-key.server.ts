import { randomBytes, createHash } from "node:crypto";
import type { ApiKeyDoc } from "@/integrations/mongodb/client.server";

export function hashKey(raw: string): string {
  return createHash("sha256").update(raw.trim()).digest("hex");
}

export function generateRawKey(): string {
  return "sk_live_" + randomBytes(16).toString("hex");
}

export async function getOrCreateApiKeyCore(
  data: { storedKey?: string | undefined; email?: string | undefined } = {}
) {
  try {
    const { getDb } = await import("@/integrations/mongodb/client.server");
    const db = await getDb();
    let email = data.email?.trim().toLowerCase();

    // 1. If storedKey was provided, verify it directly
    if (data.storedKey) {
      const hashed = hashKey(data.storedKey);
      const doc = await db.collection<ApiKeyDoc>("api_keys").findOne({ key: hashed });
      if (doc && !doc.disabled) {
        const raw = doc.raw_key || data.storedKey;
        const isUnlimited = Boolean(doc.unlimited);
        return {
          ok: true as const,
          apiKey: {
            key: raw,
            maskedKey: raw.slice(0, 10) + "••••••••••••••••" + raw.slice(-4),
            label: doc.label || "Live API Key",
            balance: doc.balance,
            balanceFormatted: isUnlimited ? "∞ Unlimited" : `₹${doc.balance.toFixed(2)}`,
            unlimited: isUnlimited,
            ownerEmail: doc.owner_email,
            createdAt: doc.created_at ? new Date(doc.created_at).toISOString() : new Date().toISOString(),
            disabled: Boolean(doc.disabled),
          },
        };
      }
    }

    // 2. If email is known, look up existing key
    if (email) {
      const doc = await db
        .collection<ApiKeyDoc>("api_keys")
        .find({ owner_email: email, disabled: { $ne: true } })
        .sort({ created_at: -1 })
        .limit(1)
        .next();

      if (doc) {
        const raw = doc.raw_key || doc.key;
        const isUnlimited = Boolean(doc.unlimited);
        return {
          ok: true as const,
          apiKey: {
            key: raw,
            maskedKey: raw.slice(0, 10) + "••••••••••••••••" + raw.slice(-4),
            label: doc.label || "Live API Key",
            balance: doc.balance,
            balanceFormatted: isUnlimited ? "∞ Unlimited" : `₹${doc.balance.toFixed(2)}`,
            unlimited: isUnlimited,
            ownerEmail: doc.owner_email,
            createdAt: doc.created_at ? new Date(doc.created_at).toISOString() : new Date().toISOString(),
            disabled: Boolean(doc.disabled),
          },
        };
      }
    }

    // 3. Default key in system if user hasn't generated one yet
    const defaultDoc = await db
      .collection<ApiKeyDoc>("api_keys")
      .find({ disabled: { $ne: true } })
      .sort({ balance: -1 })
      .limit(1)
      .next();

    if (defaultDoc) {
      const raw = defaultDoc.raw_key || defaultDoc.key;
      const isUnlimited = Boolean(defaultDoc.unlimited);
      return {
        ok: true as const,
        apiKey: {
          key: raw,
          maskedKey: raw.slice(0, 10) + "••••••••••••••••" + raw.slice(-4),
          label: defaultDoc.label || "Default Live Key",
          balance: defaultDoc.balance,
          balanceFormatted: isUnlimited ? "∞ Unlimited" : `₹${defaultDoc.balance.toFixed(2)}`,
          unlimited: isUnlimited,
          ownerEmail: defaultDoc.owner_email,
          createdAt: defaultDoc.created_at ? new Date(defaultDoc.created_at).toISOString() : new Date().toISOString(),
          disabled: Boolean(defaultDoc.disabled),
        },
      };
    }

    // 4. If completely empty, auto-generate a fresh live key
    const raw = generateRawKey();
    const hashed = hashKey(raw);
    const now = new Date();

    const newDoc: ApiKeyDoc = {
      key: hashed,
      raw_key: raw,
      label: "Default Live Key",
      owner_email: email || "user@whatsappnumbers.com",
      balance: 200, // ₹200 free starting balance
      disabled: false,
      created_at: now,
      updated_at: now,
    };

    await db.collection<ApiKeyDoc>("api_keys").insertOne(newDoc);

    return {
      ok: true as const,
      apiKey: {
        key: raw,
        maskedKey: raw.slice(0, 10) + "••••••••••••••••" + raw.slice(-4),
        label: newDoc.label,
        balance: newDoc.balance,
        balanceFormatted: `₹${newDoc.balance.toFixed(2)}`,
        ownerEmail: newDoc.owner_email,
        createdAt: now.toISOString(),
        disabled: false,
      },
    };
  } catch (error) {
    console.error("[getOrCreateApiKey error]:", error);
    return { ok: false as const, error: "Failed to retrieve API key" };
  }
}

export async function generateNewApiKeyCore(
  data: { email?: string | undefined; label?: string | undefined } = {}
) {
  try {
    const { getDb } = await import("@/integrations/mongodb/client.server");
    const db = await getDb();

    const email = data.email?.trim().toLowerCase() || "developer@whatsappnumbers.com";
    const label = data.label?.trim() || "Live API Key";

    const raw = generateRawKey();
    const hashed = hashKey(raw);
    const now = new Date();

    const newDoc: ApiKeyDoc = {
      key: hashed,
      raw_key: raw,
      label,
      owner_email: email,
      balance: 200, // ₹200 starter credit
      disabled: false,
      created_at: now,
      updated_at: now,
    };

    await db.collection<ApiKeyDoc>("api_keys").insertOne(newDoc);

    return {
      ok: true as const,
      apiKey: {
        key: raw,
        maskedKey: raw.slice(0, 10) + "••••••••••••••••" + raw.slice(-4),
        label: newDoc.label,
        balance: newDoc.balance,
        balanceFormatted: `₹${newDoc.balance.toFixed(2)}`,
        ownerEmail: newDoc.owner_email,
        createdAt: now.toISOString(),
        disabled: false,
      },
    };
  } catch (error) {
    console.error("[generateNewApiKey error]:", error);
    return { ok: false as const, error: "Failed to generate new API key" };
  }
}

export async function topUpApiKeyBalanceCore(data: { key: string; amount: number }) {
  try {
    const { getDb } = await import("@/integrations/mongodb/client.server");
    const db = await getDb();
    const hashed = hashKey(data.key);

    const res = await db.collection<ApiKeyDoc>("api_keys").findOneAndUpdate(
      { key: hashed },
      { $inc: { balance: data.amount }, $set: { updated_at: new Date() } },
      { returnDocument: "after" }
    );

    if (!res) {
      return { ok: false as const, error: "API key not found" };
    }

    return {
      ok: true as const,
      newBalance: res.balance,
      balanceFormatted: res.unlimited ? "∞ Unlimited" : `₹${res.balance.toFixed(2)}`,
      unlimited: Boolean(res.unlimited),
    };
  } catch (error) {
    console.error("[topUpApiKeyBalance error]:", error);
    return { ok: false as const, error: "Failed to top up balance" };
  }
}

