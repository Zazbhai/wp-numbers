import { randomUUID } from "node:crypto";
import type { UserWalletDoc, WalletTransactionDoc } from "@/integrations/mongodb/client.server";
import { isPaymentSystemDisabledByEnv, verifyBharatPePayment } from "./bharatpe.server";

export const NUMBER_PRICE = 49;

export async function getWallet(userId: string) {
  const { getDb } = await import("@/integrations/mongodb/client.server");
  const db = await getDb();
  const wallet = await db
    .collection<UserWalletDoc>("user_wallets")
    .findOneAndUpdate(
      { user_id: userId },
      { $setOnInsert: { user_id: userId, balance: 0, updated_at: new Date() } },
      { upsert: true, returnDocument: "after" },
    );
  return (
    wallet ?? {
      user_id: userId,
      balance: 0,
      unlimited: false,
      updated_at: new Date(),
    }
  );
}

export async function topUpWallet(userId: string, amount: number, utr?: string) {
  const { getDb } = await import("@/integrations/mongodb/client.server");
  const db = await getDb();
  const isTesting = isPaymentSystemDisabledByEnv();
  if (!isTesting) {
    if (!utr) return { ok: false as const, error: "Enter your payment UTR to continue." };
    const verified = await verifyBharatPePayment(utr, amount);
    if (!verified.ok) {
      const messages: Record<typeof verified.reason, string> = {
        disabled: "Online payments are not available right now.",
        configuration: "Payment verification is not configured. Contact support.",
        provider: "Payment verification is temporarily unavailable. Try again shortly.",
        not_found: "We could not find a successful payment for that UTR.",
        mismatch: "The payment status or amount does not match this top up.",
      };
      return { ok: false as const, error: messages[verified.reason] };
    }
  }

  const transactionId = `WAL-${randomUUID().toUpperCase()}`;
  const now = new Date();
  try {
    await db.collection<WalletTransactionDoc>("wallet_transactions").insertOne({
      transaction_id: transactionId,
      user_id: userId,
      type: "topup",
      amount,
      ...(utr ? { utr } : {}),
      description: isTesting ? "Testing wallet credit" : "BharatPe wallet top up",
      created_at: now,
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === 11000) {
      return { ok: false as const, error: "This UTR has already been used." };
    }
    throw error;
  }
  const wallet = await db
    .collection<UserWalletDoc>("user_wallets")
    .findOneAndUpdate(
      { user_id: userId },
      { $inc: { balance: amount }, $set: { updated_at: now } },
      { upsert: true, returnDocument: "after" },
    );
  return { ok: true as const, balance: wallet?.balance ?? amount, transactionId };
}

export async function debitWallet(userId: string, amount: number, phone: string) {
  const { getDb } = await import("@/integrations/mongodb/client.server");
  const db = await getDb();
  const now = new Date();
  const transactionId = `WAL-${randomUUID().toUpperCase()}`;

  const currentWallet = await db
    .collection<UserWalletDoc>("user_wallets")
    .findOne({ user_id: userId });

  if (currentWallet?.unlimited) {
    try {
      await db.collection<WalletTransactionDoc>("wallet_transactions").insertOne({
        transaction_id: transactionId,
        user_id: userId,
        type: "purchase",
        amount: 0,
        phone,
        description: "WhatsApp number purchase (Unlimited Balance)",
        created_at: now,
      });
    } catch {
      // ignore
    }
    return { ok: true as const, balance: currentWallet.balance, transactionId };
  }

  const wallet = await db
    .collection<UserWalletDoc>("user_wallets")
    .findOneAndUpdate(
      { user_id: userId, balance: { $gte: amount } },
      { $inc: { balance: -amount }, $set: { updated_at: now } },
      { returnDocument: "after" },
    );
  if (!wallet)
    return { ok: false as const, error: "Insufficient wallet balance. Top up to continue." };
  try {
    await db.collection<WalletTransactionDoc>("wallet_transactions").insertOne({
      transaction_id: transactionId,
      user_id: userId,
      type: "purchase",
      amount: -amount,
      phone,
      description: "WhatsApp number purchase",
      created_at: now,
    });
  } catch (error) {
    await db
      .collection<UserWalletDoc>("user_wallets")
      .updateOne(
        { user_id: userId },
        { $inc: { balance: amount }, $set: { updated_at: new Date() } },
      );
    throw error;
  }
  return { ok: true as const, balance: wallet.balance, transactionId };
}

export async function refundWallet(
  userId: string,
  amount: number,
  phone: string,
  purchaseId: string,
) {
  const { getDb } = await import("@/integrations/mongodb/client.server");
  const db = await getDb();
  const now = new Date();
  try {
    await db.collection<WalletTransactionDoc>("wallet_transactions").insertOne({
      transaction_id: `REF-${purchaseId}`,
      user_id: userId,
      type: "refund",
      amount,
      phone,
      description: "Failed or cancelled number request refund",
      created_at: now,
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === 11000) {
      return (await getWallet(userId)).balance;
    }
    throw error;
  }
  const wallet = await db
    .collection<UserWalletDoc>("user_wallets")
    .findOneAndUpdate(
      { user_id: userId },
      { $inc: { balance: amount }, $set: { updated_at: now } },
      { upsert: true, returnDocument: "after" },
    );
  return wallet?.balance ?? amount;
}
