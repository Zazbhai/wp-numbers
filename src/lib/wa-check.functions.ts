import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { normalizePhone } from "./identity";
import {
  checkFurySmsStatus,
  completeFurySmsActivation,
  cancelFurySmsNumber,
  getFurySmsBalance,
} from "./furysms.server";
import { ensureMonitor, isRunning } from "./wa-monitor.server";
import { refillPendingNumbers } from "@/routes/api/public/wa-result";
import type { WaCheckNumberDoc } from "@/integrations/mongodb/client.server";
import { requireLocalAuth } from "@/integrations/mongodb/local-auth-middleware";
import { requireAdminAuth } from "./admin-auth.middleware";
import { randomUUID } from "node:crypto";
import { getPublicPaymentSettings } from "./bharatpe.server";
import { debitWallet, getWallet, NUMBER_PRICE, refundWallet } from "./wallet.server";

const MARKETPLACE_READY_STATUSES = ["available", "sent", "found"] as const;
const CHECK_QUEUE_STATUSES = ["pending", "pending_verify"] as const;

function formatIndianPhone(raw: string): string {
  const clean = raw.replace(/\D/g, "");
  if (clean.length === 12 && clean.startsWith("91")) {
    return `+91 ${clean.slice(2, 7)} ${clean.slice(7)}`;
  }
  if (clean.length === 10) {
    return `+91 ${clean.slice(0, 5)} ${clean.slice(5)}`;
  }
  return raw.startsWith("+") ? raw : `+${raw}`;
}

export interface MarketplaceNumberItem {
  phone: string;
  formattedPhone: string;
  status: string;
  price: number;
  priceFormatted: string;
  provider_id: string | null;
  otp: string | null;
  created_at: string;
  updated_at: string;
}

export const listMarketplaceNumbers = createServerFn({ method: "GET" })
  .middleware([requireLocalAuth])
  .handler(async () => {
    try {
      const { getDb } = await import("@/integrations/mongodb/client.server");
      const db = await getDb();
      const { getLocalSession } = await import("./local-auth.server");
      const session = await getLocalSession();
      if (!session)
        return {
          ok: false as const,
          numbers: [],
          stats: {
            totalAvailable: 0,
            targetUnregistered: 0,
            pendingChecking: 0,
            furySmsBalance: null,
            monitorActive: false,
            payment: { enabled: false, testingMode: false, upiId: "", merchantName: "" },
            walletBalance: 0,
            walletUnlimited: false,
          },
        };

      // Trigger checker engine to maintain 50 unregistered numbers and keep monitor running
      const { maintainCheckerPipeline, UNREGISTERED_TARGET, getEngineStats } =
        await import("./checker-engine.server");
      maintainCheckerPipeline().catch((e) => console.error("[Marketplace engine error]:", e));

      const pendingCount = await db
        .collection<WaCheckNumberDoc>("wa_check_numbers")
        .countDocuments({ status: "pending" });

      // Numbers that are unregistered on WhatsApp and ready for purchase
      const availableDocs = await db
        .collection<WaCheckNumberDoc>("wa_check_numbers")
        .find({
          status: { $in: MARKETPLACE_READY_STATUSES },
        })
        .sort({ updated_at: -1, created_at: -1 })
        .limit(100)
        .toArray();

      const numbers: MarketplaceNumberItem[] = availableDocs.map((doc) => ({
        phone: doc.phone,
        formattedPhone: formatIndianPhone(doc.phone),
        status: doc.status === "sent" || doc.status === "found" ? "available" : doc.status,
        price: 49,
        priceFormatted: "₹49",
        provider_id: null,
        otp: null,
        created_at: doc.created_at
          ? new Date(doc.created_at).toISOString()
          : new Date().toISOString(),
        updated_at: doc.updated_at
          ? new Date(doc.updated_at).toISOString()
          : new Date().toISOString(),
      }));

      const balance = await getFurySmsBalance().catch(() => null);
      const monitorActive = await isRunning(1).catch(() => false);
      const engineStats = getEngineStats();
      const payment = await getPublicPaymentSettings();
      const wallet = await getWallet(session.userId);
      const walletRows = await db
        .collection("wallet_transactions")
        .find({ user_id: session.userId }, { projection: { _id: 0 } })
        .sort({ created_at: -1 })
        .limit(6)
        .toArray();

      return {
        ok: true as const,
        numbers: [],
        stats: {
          totalAvailable: availableDocs.length,
          targetUnregistered: UNREGISTERED_TARGET,
          pendingChecking: pendingCount,
          furySmsBalance: balance,
          monitorActive,
          engineRunning: engineStats.isEngineRunning,
          hourlyIntervalMinutes: engineStats.hourlyIntervalMinutes,
          payment,
          walletBalance: wallet.balance,
          walletUnlimited: Boolean(wallet.unlimited),
          walletTransactions: walletRows.map((row) => ({
            id: String(row["transaction_id"] ?? ""),
            type: String(row["type"] ?? ""),
            amount: Number(row["amount"] ?? 0),
            description: String(row["description"] ?? ""),
            createdAt:
              row["created_at"] instanceof Date
                ? row["created_at"].toISOString()
                : String(row["created_at"] ?? ""),
          })),
        },
      };
    } catch (error) {
      console.error("[listMarketplaceNumbers error]:", error);
      return {
        ok: false as const,
        numbers: [] as MarketplaceNumberItem[],
        stats: {
          totalAvailable: 0,
          pendingChecking: 0,
          furySmsBalance: null,
          monitorActive: false,
          payment: { enabled: false, upiId: "", merchantName: "" },
          walletBalance: 0,
          walletUnlimited: false,
        },
        error: "Marketplace load nahi ho paya",
      };
    }
  });

const phoneSchema = z.object({ phone: z.string().min(8).max(32) });
const walletTopUpSchema = z.object({
  amount: z.number().int().min(49).max(10000),
  utr: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{8,30}$/)
    .optional(),
});

export const topUpUserWallet = createServerFn({ method: "POST" })
  .middleware([requireLocalAuth])
  .validator((d: unknown) => walletTopUpSchema.parse(d))
  .handler(async ({ data }) => {
    try {
      const { getLocalSession } = await import("./local-auth.server");
      const session = await getLocalSession();
      if (!session) return { ok: false as const, error: "Sign in is required." };
      const { topUpWallet } = await import("./wallet.server");
      return await topUpWallet(session.userId, data.amount, data.utr);
    } catch (error) {
      console.error("[topUpUserWallet error]:", error);
      return { ok: false as const, error: "Could not top up wallet. Try again." };
    }
  });

export const buyMarketplaceNumber = createServerFn({ method: "POST" })
  .middleware([requireLocalAuth])
  .validator((d: unknown) => z.object({}).parse(d))
  .handler(async ({ data }) => {
    void data;
    let phone = "";
    let userId = "";
    let walletDebited = false;
    try {
      const { getDb } = await import("@/integrations/mongodb/client.server");
      const db = await getDb();
      const { getLocalSession } = await import("./local-auth.server");
      const session = await getLocalSession();
      if (!session) return { ok: false as const, error: "Sign in is required." };
      userId = session.userId;

      const numberCollection = db.collection<WaCheckNumberDoc>("wa_check_numbers");
      const candidate = await numberCollection
        .aggregate<WaCheckNumberDoc>([
          {
            $match: {
              status: { $in: ["available", "sent", "found"] },
              provider_id: { $exists: true, $nin: [null, ""] },
              owner_user_id: { $in: [null] },
            },
          },
          { $sample: { size: 1 } },
        ])
        .next();
      if (!candidate) {
        return { ok: false as const, error: "Number nahi mila" };
      }
      phone = candidate.phone;

      const now = new Date();
      const debit = await debitWallet(session.userId, NUMBER_PRICE, phone);
      if (!debit.ok) return debit;
      walletDebited = true;

      const claim = await numberCollection.updateOne(
        {
          phone,
          status: { $in: ["available", "sent", "found"] },
          owner_user_id: { $in: [null] },
        },
        {
          $set: {
            status: "pending_otp",
            owner_user_id: session.userId,
            wallet_purchase_id: debit.transactionId,
            bought_at: now,
            active_order_id: null,
            updated_at: now,
          },
        },
      );
      if (claim.modifiedCount !== 1) {
        await refundWallet(session.userId, NUMBER_PRICE, phone, debit.transactionId);
        walletDebited = false;
        return {
          ok: false as const,
          error: "That number was just claimed. ₹49 was returned to your wallet; please retry.",
        };
      }

      // Call regetNumber on FurySMS to reactivate this phone number for a fresh SMS session
      const { regetFurySmsNumber } = await import("./furysms.server");
      console.log(`[buyMarketplaceNumber] Calling regetNumber for ${phone}`);
      const reget = await regetFurySmsNumber(candidate.provider_id ?? "");
      console.log(`[buyMarketplaceNumber] regetNumber reply for ${phone}:`, reget);

      if (!reget.ok) {
        // If regetNumber failed on FurySMS (ERROR / NO_ACTIVATION), the provider session is dead -> remove from marketplace
        await db
          .collection<WaCheckNumberDoc>("wa_check_numbers")
          .updateOne(
            { phone },
            { $set: { status: "expired", note: reget.error, updated_at: new Date() } },
          );
        await refundWallet(session.userId, NUMBER_PRICE, phone, debit.transactionId);
        walletDebited = false;
        return {
          ok: false as const,
          error: "The number could not be activated. ₹49 was returned to your wallet.",
        };
      }

      const activeOrderId = reget.orderId;
      const activatedAt = new Date();
      await db.collection<WaCheckNumberDoc>("wa_check_numbers").updateOne(
        {
          phone,
          owner_user_id: session.userId,
          wallet_purchase_id: debit.transactionId,
        },
        {
          $set: {
            status: "pending_otp",
            active_order_id: activeOrderId,
            bought_at: activatedAt,
            updated_at: activatedAt,
          },
        },
      );
      walletDebited = false;

      const userWallet = await getWallet(userId);
      return {
        ok: true as const,
        phone,
        formattedPhone: formatIndianPhone(phone),
        walletBalance: userWallet.balance,
        walletUnlimited: Boolean(userWallet.unlimited),
        active_order_id: activeOrderId,
        bought_at: activatedAt.toISOString(),
      };
    } catch (error) {
      console.error("[buyMarketplaceNumber error]:", error);
      if (walletDebited && userId && phone) {
        const ownedNumber = await (
          await import("@/integrations/mongodb/client.server")
        )
          .getDb()
          .then((db) =>
            db
              .collection<WaCheckNumberDoc>("wa_check_numbers")
              .findOne({ phone, owner_user_id: userId }),
          );
        if (ownedNumber?.wallet_purchase_id) {
          await refundWallet(userId, NUMBER_PRICE, phone, ownedNumber.wallet_purchase_id).catch(
            () => {},
          );
        }
      }
      return { ok: false as const, error: "Number activate nahi ho saka" };
    }
  });

export const listRecentNumbers = createServerFn({ method: "GET" })
  .middleware([requireLocalAuth])
  .handler(async () => {
    const { getDb } = await import("@/integrations/mongodb/client.server");
    const { getLocalSession } = await import("./local-auth.server");
    const session = await getLocalSession();
    if (!session) return { ok: false as const, numbers: [] };

    const db = await getDb();
    const purchases = await db
      .collection("wallet_transactions")
      .find({ user_id: session.userId, type: "purchase", phone: { $type: "string" } })
      .sort({ created_at: -1 })
      .toArray();
    const phones = [...new Set(purchases.map((purchase) => String(purchase["phone"])))];
    if (phones.length === 0) return { ok: true as const, numbers: [] };

    const currentDocs = await db
      .collection<WaCheckNumberDoc>("wa_check_numbers")
      .find({ phone: { $in: phones } })
      .toArray();
    const currentByPhone = new Map(currentDocs.map((doc) => [doc.phone, doc]));
    const latestPurchases = new Map<string, (typeof purchases)[number]>();
    for (const purchase of purchases) {
      const phone = String(purchase["phone"] ?? "");
      if (phone && !latestPurchases.has(phone)) latestPurchases.set(phone, purchase);
    }

    return {
      ok: true as const,
      numbers: [...latestPurchases.entries()].map(([phone, purchase]) => {
        const current = currentByPhone.get(phone);
        const available =
          current &&
          ["available", "sent", "found"].includes(current.status) &&
          !current.owner_user_id &&
          Boolean(current.provider_id);
        const createdAt = purchase["created_at"];
        return {
          phone,
          formattedPhone: formatIndianPhone(phone),
          purchasedAt:
            createdAt instanceof Date ? createdAt.toISOString() : String(createdAt ?? ""),
          status:
            current?.owner_user_id === session.userId
              ? current.status
              : (current?.status ?? "removed"),
          canRebuy: Boolean(available),
        };
      }),
    };
  });

export const rebuyRecentNumber = createServerFn({ method: "POST" })
  .middleware([requireLocalAuth])
  .validator((data: unknown) => phoneSchema.parse(data))
  .handler(async ({ data }) => {
    let walletDebited = false;
    let userId = "";
    const phone = normalizePhone(data.phone) || data.phone;
    let purchaseId = "";
    try {
      const { getDb } = await import("@/integrations/mongodb/client.server");
      const db = await getDb();
      const { getLocalSession } = await import("./local-auth.server");
      const session = await getLocalSession();
      if (!session) return { ok: false as const, error: "Sign in is required." };
      userId = session.userId;

      const priorPurchase = await db.collection("wallet_transactions").findOne({
        user_id: userId,
        type: "purchase",
        phone,
      });
      if (!priorPurchase) {
        return { ok: false as const, error: "You have not purchased this number before." };
      }

      const numberCollection = db.collection<WaCheckNumberDoc>("wa_check_numbers");
      const candidate = await numberCollection.findOne({
        phone,
        status: { $in: ["available", "sent", "found"] },
        provider_id: { $exists: true, $nin: [null, ""] },
        owner_user_id: { $in: [null] },
      });
      if (!candidate) {
        return { ok: false as const, error: "This number is not currently available to rebuy." };
      }

      const debit = await debitWallet(userId, NUMBER_PRICE, phone);
      if (!debit.ok) return debit;
      walletDebited = true;
      purchaseId = debit.transactionId;

      const now = new Date();
      const claim = await numberCollection.updateOne(
        {
          phone,
          status: { $in: ["available", "sent", "found"] },
          owner_user_id: { $in: [null] },
        },
        {
          $set: {
            status: "pending_otp",
            owner_user_id: userId,
            wallet_purchase_id: purchaseId,
            bought_at: now,
            active_order_id: null,
            updated_at: now,
          },
        },
      );
      if (claim.modifiedCount !== 1) {
        await refundWallet(userId, NUMBER_PRICE, phone, purchaseId);
        walletDebited = false;
        return { ok: false as const, error: "Number was just claimed; the charge was refunded." };
      }

      const { regetFurySmsNumber } = await import("./furysms.server");
      const activation = await regetFurySmsNumber(candidate.provider_id ?? "");
      if (!activation.ok) {
        await numberCollection.updateOne(
          { phone, owner_user_id: userId, wallet_purchase_id: purchaseId },
          { $set: { status: "expired", note: activation.error, updated_at: new Date() } },
        );
        await refundWallet(userId, NUMBER_PRICE, phone, purchaseId);
        walletDebited = false;
        return {
          ok: false as const,
          error: "Could not activate this number; the charge was refunded.",
        };
      }

      const activatedAt = new Date();
      await numberCollection.updateOne(
        { phone, owner_user_id: userId, wallet_purchase_id: purchaseId },
        {
          $set: {
            active_order_id: activation.orderId,
            bought_at: activatedAt,
            updated_at: activatedAt,
          },
        },
      );
      walletDebited = false;
      const userWallet = await getWallet(userId);
      return {
        ok: true as const,
        phone,
        formattedPhone: formatIndianPhone(phone),
        walletBalance: userWallet.balance,
        walletUnlimited: Boolean(userWallet.unlimited),
      };
    } catch (error) {
      console.error("[rebuyRecentNumber error]:", error);
      if (walletDebited && userId && purchaseId) {
        await refundWallet(userId, NUMBER_PRICE, phone, purchaseId).catch(() => {});
      }
      return { ok: false as const, error: "Could not rebuy this number. Try again." };
    }
  });

export const checkSmsOtp = createServerFn({ method: "POST" })
  .middleware([requireLocalAuth])
  .validator((d: unknown) => phoneSchema.parse(d))
  .handler(async ({ data }) => {
    try {
      const { getDb } = await import("@/integrations/mongodb/client.server");
      const db = await getDb();
      const phone = normalizePhone(data.phone) || data.phone;

      const doc = await db.collection<WaCheckNumberDoc>("wa_check_numbers").findOne({ phone });
      if (!doc) {
        return { ok: false as const, error: "Number nahi mila" };
      }
      const { getLocalSession } = await import("./local-auth.server");
      const session = await getLocalSession();
      if (!session || doc.owner_user_id !== session.userId) {
        return { ok: false as const, error: "This number is not assigned to your account." };
      }

      // Must poll the fresh active_order_id generated by regetNumber, NEVER the stale check-time provider_id
      const orderIdToPoll = doc.active_order_id;
      if (!orderIdToPoll) {
        console.log(`[checkSmsOtp] active_order_id is not set yet for ${phone}, waiting...`);
        return { ok: true as const, state: "WAITING" as const, code: null };
      }

      console.log(`[checkSmsOtp] Polling OTP for phone=${phone}, activeOrderId=${orderIdToPoll}`);
      const res = await checkFurySmsStatus(orderIdToPoll);
      console.log(
        `[checkSmsOtp] FurySMS reply for ${phone}: status=${res.status}, code=${res.code}`,
      );

      if (res.status === "OK") {
        const now = new Date();
        await completeFurySmsActivation(orderIdToPoll).catch(() => {});
        // ONLY REMOVE FROM MARKETPLACE WHEN OTP IS ACTUALLY RECEIVED:
        await db.collection<WaCheckNumberDoc>("wa_check_numbers").updateOne(
          { phone },
          {
            $set: {
              status: "completed",
              otp: res.code,
              updated_at: now,
            },
          },
        );
        return { ok: true as const, state: "OK" as const, code: res.code, raw: res.raw };
      }

      if (res.status === "WAITING") {
        return { ok: true as const, state: "WAITING" as const, code: null };
      }

      if (res.status === "CANCELLED") {
        // No OTP received -> KEEP the number in marketplace as "available"!
        await db.collection<WaCheckNumberDoc>("wa_check_numbers").updateOne(
          { phone },
          {
            $set: {
              status: "available",
              active_order_id: null,
              owner_user_id: null,
              updated_at: new Date(),
            },
          },
        );
        if (doc.wallet_purchase_id) {
          await refundWallet(session.userId, NUMBER_PRICE, phone, doc.wallet_purchase_id);
        }
        return {
          ok: false as const,
          state: "CANCELLED" as const,
          error:
            "The SMS request was cancelled. A manual refund request was recorded; contact support for the refund.",
        };
      }

      return {
        ok: false as const,
        state: "UNKNOWN" as const,
        error: "SMS status check nahi ho saka",
      };
    } catch (error) {
      console.error("[checkSmsOtp error]:", error);
      return { ok: false as const, error: "SMS check mein error aayi" };
    }
  });

export const cancelPurchase = createServerFn({ method: "POST" })
  .middleware([requireLocalAuth])
  .validator((d: unknown) => phoneSchema.parse(d))
  .handler(async ({ data }) => {
    try {
      const { getDb } = await import("@/integrations/mongodb/client.server");
      const db = await getDb();
      const phone = normalizePhone(data.phone) || data.phone;

      const doc = await db.collection<WaCheckNumberDoc>("wa_check_numbers").findOne({ phone });
      const { getLocalSession } = await import("./local-auth.server");
      const session = await getLocalSession();
      if (!session || doc?.owner_user_id !== session.userId) {
        return { ok: false as const, error: "This number is not assigned to your account." };
      }
      if (doc.status !== "pending_otp" || doc.otp) {
        return { ok: false as const, error: "This number request can no longer be cancelled." };
      }
      const orderIdToCancel = doc?.active_order_id || doc?.provider_id;
      if (orderIdToCancel) {
        await cancelFurySmsNumber(orderIdToCancel).catch(() => {});
      }

      // No OTP received -> keep number available in marketplace!
      await db.collection<WaCheckNumberDoc>("wa_check_numbers").updateOne(
        { phone, owner_user_id: session.userId },
        {
          $set: {
            status: "available",
            active_order_id: null,
            owner_user_id: null,
            updated_at: new Date(),
          },
        },
      );
      if (doc?.wallet_purchase_id) {
        await refundWallet(session.userId, NUMBER_PRICE, phone, doc.wallet_purchase_id);
      }

      return { ok: true as const };
    } catch (error) {
      console.error("[cancelPurchase error]:", error);
      return { ok: false as const, error: "Cancel nahi ho saka" };
    }
  });

export const triggerAutoRefill = createServerFn({ method: "POST" })
  .middleware([requireLocalAuth])
  .handler(async () => {
    try {
      const { runHourlyCheckerTask } = await import("./checker-engine.server");
      await runHourlyCheckerTask();
      return { ok: true as const };
    } catch (error) {
      console.error("[triggerAutoRefill error]:", error);
      return { ok: false as const, error: "Refill trigger nahi ho saka" };
    }
  });

// Legacy / admin server functions for /checker dashboard backwards-compatibility
const addSchema = z.object({ raw: z.string().max(200000) });

export const addNumbers = createServerFn({ method: "POST" })
  .middleware([requireAdminAuth])
  .validator((d: unknown) => addSchema.parse(d))
  .handler(async ({ data }) => {
    const tokens = data.raw
      .split(/[\n,;]+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .flatMap((line) =>
        /^[\d\s()+\-.]+$/.test(line)
          ? [line.replace(/[\s()+\-.]/g, "")]
          : line.split(/\s+/).filter(Boolean),
      );
    const valid = new Set<string>();
    const invalid = new Set<string>();
    for (const t of tokens) {
      const p = normalizePhone(t);
      if (p) valid.add(p);
      else invalid.add(t);
    }
    const phones = [...valid];
    if (phones.length === 0) return { ok: false as const, error: "Koi sahi number nahi mila" };

    try {
      const { getDb } = await import("@/integrations/mongodb/client.server");
      const db = await getDb();
      const now = new Date();
      const ops = phones.map((p) => ({
        updateOne: {
          filter: { phone: p },
          update: {
            $setOnInsert: {
              phone: p,
              status: "pending",
              note: null,
              provider_id: null,
              created_at: now,
            },
            $set: {
              updated_at: now,
            },
          },
          upsert: true,
        },
      }));

      await db.collection("wa_check_numbers").bulkWrite(ops, { ordered: false });
      return { ok: true as const, added: phones.length, invalid: [...invalid].slice(0, 5) };
    } catch (error) {
      console.error("[addNumbers error]:", error);
      return { ok: false as const, error: "Number save nahi hue, dobara try karein" };
    }
  });

export const listNumbers = createServerFn({ method: "GET" })
  .middleware([requireAdminAuth])
  .handler(async () => {
    try {
      const { getDb } = await import("@/integrations/mongodb/client.server");
      const db = await getDb();
      const numbersCollection = db.collection<WaCheckNumberDoc>("wa_check_numbers");
      const [docs, totalCount, availableCount, pendingCount, skippedCount] = await Promise.all([
        numbersCollection
          .find(
            {},
            { projection: { _id: 0, phone: 1, status: 1, note: 1, created_at: 1, updated_at: 1 } },
          )
          .sort({ created_at: -1 })
          .limit(500)
          .toArray(),
        numbersCollection.countDocuments(),
        numbersCollection.countDocuments({ status: { $in: MARKETPLACE_READY_STATUSES } }),
        numbersCollection.countDocuments({ status: { $in: CHECK_QUEUE_STATUSES } }),
        numbersCollection.countDocuments({ status: "skipped" }),
      ]);

      const numbers = docs.map((d) => ({
        phone: String(d.phone ?? ""),
        status: String(d.status ?? "pending"),
        note: d.note ? String(d.note) : null,
        created_at:
          d.created_at instanceof Date ? d.created_at.toISOString() : String(d.created_at || ""),
        updated_at:
          d.updated_at instanceof Date ? d.updated_at.toISOString() : String(d.updated_at || ""),
      }));

      return {
        ok: true as const,
        numbers,
        counts: {
          total: totalCount,
          available: availableCount,
          pending: pendingCount,
          skipped: skippedCount,
        },
      };
    } catch (error) {
      console.error("[listNumbers error]:", error);
      return {
        ok: false as const,
        counts: { total: 0, available: 0, pending: 0, skipped: 0 },
        numbers: [] as {
          phone: string;
          status: string;
          note: string | null;
          created_at: string;
          updated_at: string;
        }[],
      };
    }
  });

export const getCheckerKey = createServerFn({ method: "GET" })
  .middleware([requireAdminAuth])
  .handler(async () => {
    const key = process.env["TELEGRAM_API_KEY"];
    if (!key) return null;
    const { createHash } = await import("crypto");
    return createHash("sha256").update(`wa-checker:${key}`).digest("base64url");
  });

const fetchSchema = z.object({ count: z.number().int().min(1).max(100).default(1) });

export const fetchNumberFromApi = createServerFn({ method: "POST" })
  .middleware([requireAdminAuth])
  .validator((d: unknown) => fetchSchema.parse(d ?? {}))
  .handler(async ({ data }) => {
    try {
      const { getDb } = await import("@/integrations/mongodb/client.server");
      const db = await getDb();
      const count = Math.min(Math.max(data.count, 1), 25);
      const addedPhones: string[] = [];
      let lastError = "";

      for (let i = 0; i < count; i++) {
        const { requestFurySmsNumberWithDetails } = await import("./furysms.server");
        const res = await requestFurySmsNumberWithDetails("boyaah", "22");
        if (!res.ok) {
          lastError = res.error;
          console.warn(`[fetchNumberFromApi] FurySMS getNumber stopped at ${i}/${count}: ${res.error}`);
          break;
        }

        const now = new Date();
        await db.collection("wa_check_numbers").updateOne(
          { phone: res.phone },
          {
            $setOnInsert: { phone: res.phone, created_at: now },
            $set: {
              status: "pending",
              provider_id: res.id,
              note: "Queued for WhatsApp registration check",
              updated_at: now,
            },
          },
          { upsert: true },
        );
        addedPhones.push(res.phone);
        if (i < count - 1) {
          await new Promise((r) => setTimeout(r, 800));
        }
      }

      // Automatically make sure the checker monitor is running
      await ensureMonitor(1).catch(() => {});

      if (addedPhones.length === 0) {
        return {
          ok: false as const,
          error: lastError ? `FurySMS reply: ${lastError}` : "FurySMS se koi number nahi mila",
        };
      }

      const note =
        addedPhones.length < count
          ? `FurySMS se ${addedPhones.length} numbers mile (${count} maange the; FurySMS: ${lastError || "Out of stock"})`
          : undefined;

      return { ok: true as const, phones: addedPhones, note };
    } catch (error) {
      console.error("[fetchNumberFromApi error]:", error);
      return { ok: false as const, error: "API se number lene mein error aayi" };
    }
  });

export const getMonitorStatus = createServerFn({ method: "GET" })
  .middleware([requireAdminAuth])
  .handler(async () => {
    try {
      const running = await isRunning(1);
      const { dir, readJson } = await import("./wa-monitor.server");
      const path = await import("path");
      const json = await readJson(path.join(dir(1), "link-status.json"));
      return {
        running,
        state: json?.state || (running ? "running" : "idle"),
        phone: json?.phone || null,
      };
    } catch {
      return { running: false, state: "idle", phone: null };
    }
  });

export const startChecker = createServerFn({ method: "POST" })
  .middleware([requireAdminAuth])
  .handler(async () => {
    try {
      const ok = await ensureMonitor(1, true);
      return { ok };
    } catch (error) {
      console.error("[startChecker error]:", error);
      return { ok: false };
    }
  });

export const deleteNumber = createServerFn({ method: "POST" })
  .middleware([requireAdminAuth])
  .validator((d: unknown) => phoneSchema.parse(d))
  .handler(async ({ data }) => {
    try {
      const { getDb } = await import("@/integrations/mongodb/client.server");
      const db = await getDb();
      await db.collection("wa_check_numbers").deleteOne({ phone: data.phone });
      return { ok: true as const };
    } catch (error) {
      console.error("[deleteNumber error]:", error);
      return { ok: false as const };
    }
  });

export const recheckNumber = createServerFn({ method: "POST" })
  .middleware([requireAdminAuth])
  .validator((d: unknown) => phoneSchema.parse(d))
  .handler(async ({ data }) => {
    try {
      const { getDb } = await import("@/integrations/mongodb/client.server");
      const db = await getDb();
      await db
        .collection("wa_check_numbers")
        .updateOne(
          { phone: data.phone },
          { $set: { status: "pending", note: null, updated_at: new Date() } },
        );
      return { ok: true as const };
    } catch (error) {
      console.error("[recheckNumber error]:", error);
      return { ok: false as const };
    }
  });
