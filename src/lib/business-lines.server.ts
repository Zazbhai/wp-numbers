import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { ObjectId } from "mongodb";
import { z } from "zod";
import type {
  ApiKeyDoc,
  BusinessLineOfferDoc,
  BusinessLineOrderDoc,
  BusinessLineSettingsDoc,
  LocalUserDoc,
  RegisteredUserDoc,
  UserWalletDoc,
  WalletTransactionDoc,
} from "@/integrations/mongodb/client.server";
import type { AdminUserItem } from "./numbers";

export const orderRequestSchema = z.object({
  offerId: z.string().min(1).max(80),
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(255),
  quantity: z.number().int().min(1).max(25),
});

const offerSchema = z.object({
  id: z.string().trim().min(1).max(80),
  city: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(120),
  prefix: z.string().trim().min(1).max(24),
  available: z.number().int().min(0).max(100000),
  monthlyPrice: z.number().int().min(0).max(10000000),
});

export const adminUpdateSchema = z.object({
  offers: z.array(offerSchema).max(30).optional(),
  maintenance: z.boolean().optional(),
  domain: z.string().trim().min(1).max(180).optional(),
  fulfillOrderId: z.string().min(1).max(80).optional(),
  markPaymentRefundedId: z.string().min(1).max(100).optional(),
  payment: z
    .object({
      enabled: z.boolean(),
      merchantId: z.string().trim().max(120),
      accessToken: z.string().max(5000).optional(),
      sessionCookie: z.string().max(10000).optional(),
      upiId: z.string().trim().max(200),
      merchantName: z.string().trim().max(120),
    })
    .optional(),
  editUserPassword: z
    .object({
      userId: z.string().min(1),
      newPassword: z.string().min(6).max(128),
    })
    .optional(),
  editUserBalance: z
    .object({
      userId: z.string().min(1),
      balance: z.number().min(0).max(10000000),
      unlimited: z.boolean().optional(),
      syncApiKey: z.boolean().optional(),
      reason: z.string().max(200).optional(),
    })
    .optional(),
  banUser: z
    .object({
      userId: z.string().min(1),
      banReason: z.string().max(200).optional(),
    })
    .optional(),
  unbanUser: z
    .object({
      userId: z.string().min(1),
    })
    .optional(),
  editUserProfile: z
    .object({
      userId: z.string().min(1),
      name: z.string().max(100).optional(),
      phone: z.string().max(25).optional(),
    })
    .optional(),
});

const defaultOffers = [
  {
    id: "mum",
    city: "Mumbai",
    label: "Mumbai business line",
    prefix: "+91 22",
    available: 0,
    monthlyPrice: 899,
  },
  {
    id: "del",
    city: "Delhi NCR",
    label: "Delhi NCR business line",
    prefix: "+91 11",
    available: 0,
    monthlyPrice: 949,
  },
  {
    id: "blr",
    city: "Bengaluru",
    label: "Bengaluru business line",
    prefix: "+91 80",
    available: 0,
    monthlyPrice: 899,
  },
  {
    id: "hyd",
    city: "Hyderabad",
    label: "Hyderabad business line",
    prefix: "+91 40",
    available: 0,
    monthlyPrice: 849,
  },
];

export function isValidAdminKey(candidate: string) {
  const secret = process.env["BUSINESS_LINES_ADMIN_KEY"];
  if (!secret) return false;
  const expected = createHash("sha256").update(secret).digest();
  const actual = createHash("sha256").update(candidate).digest();
  return timingSafeEqual(expected, actual) && candidate.length > 0;
}

export async function ensureBusinessLineStore() {
  const { getDb } = await import("@/integrations/mongodb/client.server");
  const db = await getDb();
  const offers = db.collection<BusinessLineOfferDoc>("business_line_offers");
  const settings = db.collection<BusinessLineSettingsDoc>("business_line_settings");
  const now = new Date();

  await Promise.all(
    defaultOffers.map((offer) =>
      offers.updateOne(
        { id: offer.id },
        {
          $setOnInsert: {
            ...offer,
            monthly_price: offer.monthlyPrice,
            updated_at: now,
          },
        },
        { upsert: true },
      ),
    ),
  );
  await settings.updateOne(
    { _id: "store" },
    { $setOnInsert: { maintenance: false, domain: "fury.in", updated_at: now } },
    { upsert: true },
  );
  return { db, offers, settings };
}

export async function getPublicBusinessLines() {
  const { offers, settings } = await ensureBusinessLineStore();
  const [offerRows, store] = await Promise.all([
    offers
      .find({}, { projection: { _id: 0 } })
      .sort({ city: 1 })
      .toArray(),
    settings.findOne({ _id: "store" }),
  ]);
  return {
    offers: offerRows
      .filter((offer) => offer.available > 0)
      .map((offer) => ({
        id: offer.id,
        city: offer.city,
        label: offer.label,
        prefix: offer.prefix,
        available: offer.available,
        monthlyPrice: offer.monthly_price,
      })),
    maintenance: store?.maintenance ?? false,
    domain: store?.domain ?? "fury.in",
  };
}

export async function createBusinessLineOrder(input: z.infer<typeof orderRequestSchema>) {
  const { offers, db, settings } = await ensureBusinessLineStore();
  const storeSettings = await settings.findOne({ _id: "store" });
  if (storeSettings?.maintenance) return { ok: false as const, reason: "maintenance" as const };
  const offer = await offers.findOne({ id: input.offerId, available: { $gte: input.quantity } });
  if (!offer) return { ok: false as const, reason: "unavailable" as const };

  const now = new Date();
  const order: BusinessLineOrderDoc = {
    order_id: `BL-${randomUUID().toUpperCase()}`,
    offer_id: offer.id,
    city: offer.city,
    customer_name: input.name,
    email: input.email,
    quantity: input.quantity,
    monthly_price: offer.monthly_price,
    total_monthly: offer.monthly_price * input.quantity,
    status: "requested",
    created_at: now,
    fulfilled_at: null,
  };
  await db.collection<BusinessLineOrderDoc>("business_line_orders").insertOne(order);
  return {
    ok: true as const,
    order: {
      id: order.order_id,
      city: order.city,
      quantity: order.quantity,
      totalMonthly: order.total_monthly,
      status: order.status,
    },
  };
}

export async function getAdminBusinessLines() {
  const { db, offers, settings } = await ensureBusinessLineStore();
  const [offerRows, store, orders, paymentRows, localUsers, registeredUsers, wallets, apiKeys] =
    await Promise.all([
      offers
        .find({}, { projection: { _id: 0 } })
        .sort({ city: 1 })
        .toArray(),
      settings.findOne({ _id: "store" }),
      db
        .collection<BusinessLineOrderDoc>("business_line_orders")
        .find({}, { projection: { _id: 0 } })
        .sort({ created_at: -1 })
        .limit(100)
        .toArray(),
      db
        .collection("marketplace_payments")
        .find({}, { projection: { _id: 0 } })
        .sort({ created_at: -1 })
        .limit(100)
        .toArray(),
      db
        .collection<LocalUserDoc>("local_users")
        .find()
        .sort({ created_at: -1 })
        .toArray(),
      db.collection<RegisteredUserDoc>("registered_users").find().toArray(),
      db.collection<UserWalletDoc>("user_wallets").find().toArray(),
      db.collection<ApiKeyDoc>("api_keys").find().toArray(),
    ]);

  const walletMap = new Map<string, { balance: number; unlimited?: boolean }>();
  for (const w of wallets) {
    walletMap.set(w.user_id, { balance: w.balance, unlimited: Boolean(w.unlimited) });
  }

  const apiKeyMap = new Map<string, { raw?: string | undefined; balance: number; unlimited?: boolean }>();
  for (const k of apiKeys) {
    apiKeyMap.set(k.owner_email.toLowerCase(), {
      raw: k.raw_key,
      balance: k.balance,
      unlimited: Boolean(k.unlimited),
    });
  }

  const regMap = new Map<string, RegisteredUserDoc>();
  for (const r of registeredUsers) {
    regMap.set(r.email.toLowerCase(), r);
  }

  const users: AdminUserItem[] = [];
  const seenEmails = new Set<string>();

  for (const u of localUsers) {
    const email = u.email.toLowerCase();
    seenEmails.add(email);
    const reg = regMap.get(email);
    const uid = u._id.toHexString();
    const apiKeyInfo = apiKeyMap.get(email);
    const walletInfo = walletMap.get(uid) ?? walletMap.get(email);
    const isUnlimited = Boolean(walletInfo?.unlimited || u.unlimited_balance || apiKeyInfo?.unlimited);

    users.push({
      id: uid,
      email: u.email,
      name: u.name || reg?.name || "—",
      phone: u.phone || reg?.phone || "—",
      walletBalance: walletInfo?.balance ?? 0,
      apiBalance: apiKeyInfo?.balance ?? 0,
      apiKey: apiKeyInfo?.raw,
      banned: Boolean(u.banned),
      banReason: u.ban_reason ? u.ban_reason : undefined,
      unlimited: isUnlimited,
      createdAt: u.created_at ? new Date(u.created_at).toISOString() : new Date().toISOString(),
      updatedAt: u.updated_at ? new Date(u.updated_at).toISOString() : new Date().toISOString(),
      hasPassword: Boolean(u.password_hash),
    });
  }

  for (const r of registeredUsers) {
    const email = r.email.toLowerCase();
    if (!seenEmails.has(email)) {
      seenEmails.add(email);
      const apiKeyInfo = apiKeyMap.get(email);
      const walletInfo = walletMap.get(email);
      const isUnlimited = Boolean(walletInfo?.unlimited || apiKeyInfo?.unlimited);
      users.push({
        id: `reg_${email}`,
        email: r.email,
        name: r.name || "—",
        phone: r.phone || "—",
        walletBalance: walletInfo?.balance ?? 0,
        apiBalance: apiKeyInfo?.balance ?? 0,
        apiKey: apiKeyInfo?.raw,
        banned: false,
        unlimited: isUnlimited,
        createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
        updatedAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
        hasPassword: false,
      });
    }
  }

  const fulfilled = orders.filter((order) => order.status === "fulfilled");
  const { getPaymentSettingsForAdmin } = await import("./bharatpe.server");
  return {
    offers: offerRows.map((offer) => ({
      id: offer.id,
      city: offer.city,
      label: offer.label,
      prefix: offer.prefix,
      available: offer.available,
      monthlyPrice: offer.monthly_price,
    })),
    settings: { maintenance: store?.maintenance ?? false, domain: store?.domain ?? "fury.in" },
    paymentSettings: await getPaymentSettingsForAdmin(),
    orders: orders.map((order) => ({
      id: order.order_id,
      city: order.city,
      customer: order.customer_name,
      email: order.email,
      quantity: order.quantity,
      monthlyTotal: order.total_monthly,
      status: order.status,
      createdAt: order.created_at,
    })),
    payments: paymentRows.map((payment) => ({
      id: String(payment["payment_id"] ?? ""),
      utr: String(payment["utr"] ?? ""),
      phone: String(payment["phone"] ?? ""),
      userId: String(payment["user_id"] ?? ""),
      amount: Number(payment["amount"] ?? 0),
      status: String(payment["status"] ?? "verified"),
      createdAt: payment["created_at"],
    })),
    users,
    totals: {
      grossMonthly: fulfilled.reduce((sum, order) => sum + order.total_monthly, 0),
      fulfilledOrders: fulfilled.length,
      pendingOrders: orders.filter((order) => order.status === "requested").length,
      stock: offerRows.reduce((sum, offer) => sum + offer.available, 0),
      totalUsers: users.length,
      bannedUsers: users.filter((u) => u.banned).length,
      totalUserBalance: users.reduce((sum, u) => sum + u.walletBalance, 0),
    },
  };
}

export async function updateAdminBusinessLines(input: z.infer<typeof adminUpdateSchema>) {
  const { db, offers, settings } = await ensureBusinessLineStore();

  if (input.offers) {
    const ids = input.offers.map((offer) => offer.id);
    if (new Set(ids).size !== ids.length)
      return { ok: false as const, reason: "duplicate-offer" as const };
    const current = await offers.find({}, { projection: { id: 1, available: 1 } }).toArray();
    if (current.some((row) => !ids.includes(row.id) && row.available > 0)) {
      return { ok: false as const, reason: "stock-remains" as const };
    }
    await offers.deleteMany({ id: { $nin: ids } });
    if (input.offers.length) {
      await offers.bulkWrite(
        input.offers.map((offer) => ({
          updateOne: {
            filter: { id: offer.id },
            update: {
              $set: { ...offer, monthly_price: offer.monthlyPrice, updated_at: new Date() },
            },
            upsert: true,
          },
        })),
      );
    }
  }

  if (input.maintenance !== undefined || input.domain !== undefined) {
    await settings.updateOne(
      { _id: "store" },
      {
        $set: {
          ...(input.maintenance !== undefined ? { maintenance: input.maintenance } : {}),
          ...(input.domain !== undefined ? { domain: input.domain } : {}),
          updated_at: new Date(),
        },
      },
      { upsert: true },
    );
  }

  if (input.payment) {
    const { savePaymentSettings } = await import("./bharatpe.server");
    try {
      await savePaymentSettings(input.payment);
    } catch (error) {
      return {
        ok: false as const,
        reason: error instanceof Error ? error.message : "payment-config-invalid",
      };
    }
  }

  if (input.fulfillOrderId) {
    const orders = db.collection<BusinessLineOrderDoc>("business_line_orders");
    const order = await orders.findOne({ order_id: input.fulfillOrderId, status: "requested" });
    if (!order) return { ok: false as const, reason: "order-not-pending" as const };
    const stockClaim = await offers.updateOne(
      { id: order.offer_id, available: { $gte: order.quantity } },
      { $inc: { available: -order.quantity }, $set: { updated_at: new Date() } },
    );
    if (stockClaim.modifiedCount !== 1)
      return { ok: false as const, reason: "stock-shortage" as const };
    const fulfilled = await orders.updateOne(
      { order_id: order.order_id, status: "requested" },
      { $set: { status: "fulfilled", fulfilled_at: new Date() } },
    );
    if (fulfilled.modifiedCount !== 1) {
      await offers.updateOne({ id: order.offer_id }, { $inc: { available: order.quantity } });
      return { ok: false as const, reason: "order-not-pending" as const };
    }
  }

  if (input.markPaymentRefundedId) {
    const updated = await db
      .collection("marketplace_payments")
      .updateOne(
        { payment_id: input.markPaymentRefundedId, status: "refund_required" },
        { $set: { status: "refunded", updated_at: new Date() } },
      );
    if (!updated.modifiedCount)
      return { ok: false as const, reason: "payment-not-refundable" as const };
  }

  // ─── USER MANAGEMENT ACTIONS ──────────────────────────────────────────────
  if (input.editUserPassword) {
    const { userId, newPassword } = input.editUserPassword;
    const { hashPassword } = await import("./local-auth-crypto");
    const passwordHash = await hashPassword(newPassword);
    const now = new Date();

    if (userId.startsWith("reg_")) {
      const email = userId.replace("reg_", "").trim().toLowerCase();
      const reg = await db.collection<RegisteredUserDoc>("registered_users").findOne({ email });
      const insertDoc: Partial<LocalUserDoc> = {
        _id: new ObjectId(),
        email,
        banned: false,
        created_at: now,
      };
      if (reg?.name) insertDoc.name = reg.name;
      if (reg?.phone) insertDoc.phone = reg.phone;
      await db.collection<LocalUserDoc>("local_users").updateOne(
        { email },
        {
          $setOnInsert: insertDoc,
          $set: { password_hash: passwordHash, updated_at: now },
        },
        { upsert: true },
      );
    } else {
      let objectId: ObjectId;
      try {
        objectId = new ObjectId(userId);
      } catch {
        return { ok: false as const, reason: "invalid-user-id" as const };
      }
      const res = await db
        .collection<LocalUserDoc>("local_users")
        .updateOne({ _id: objectId }, { $set: { password_hash: passwordHash, updated_at: now } });
      if (res.matchedCount === 0) {
        return { ok: false as const, reason: "user-not-found" as const };
      }
      // Revoke any active sessions so user must sign in with new password
      await db.collection("local_sessions").deleteMany({ user_id: userId });
    }
  }

  if (input.editUserBalance) {
    const { userId, balance, syncApiKey, reason } = input.editUserBalance;
    const now = new Date();
    let targetUserId = userId;
    let targetEmail: string | undefined;

    if (userId.startsWith("reg_")) {
      targetEmail = userId.replace("reg_", "").trim().toLowerCase();
      const local = await db.collection<LocalUserDoc>("local_users").findOne({ email: targetEmail });
      if (local) {
        targetUserId = local._id.toHexString();
      } else {
        targetUserId = targetEmail;
      }
    } else {
      try {
        const local = await db
          .collection<LocalUserDoc>("local_users")
          .findOne({ _id: new ObjectId(userId) });
        if (local) targetEmail = local.email;
      } catch {
        // ignore
      }
    }

    const currentWallet = await db
      .collection<UserWalletDoc>("user_wallets")
      .findOne({ user_id: targetUserId });
    const oldBalance = currentWallet?.balance ?? 0;
    const diff = balance - oldBalance;
    const isUnlimited = Boolean(input.editUserBalance.unlimited);

    await db.collection<UserWalletDoc>("user_wallets").updateOne(
      { user_id: targetUserId },
      { $set: { balance, unlimited: isUnlimited, updated_at: now } },
      { upsert: true },
    );

    // Update local user record
    if (!targetUserId.startsWith("reg_")) {
      try {
        await db.collection<LocalUserDoc>("local_users").updateOne(
          { _id: new ObjectId(targetUserId) },
          { $set: { unlimited_balance: isUnlimited, updated_at: now } },
        );
      } catch {
        // ignore
      }
    }

    // Audit transaction
    await db.collection<WalletTransactionDoc>("wallet_transactions").insertOne({
      transaction_id: `ADM-${randomUUID().toUpperCase()}`,
      user_id: targetUserId,
      type: diff >= 0 ? "topup" : "purchase",
      amount: diff,
      description: isUnlimited
        ? `Admin balance adjustment: Set to Unlimited (was ₹${oldBalance.toFixed(2)})`
        : `Admin balance adjustment: ${reason || "Manual update"} (₹${oldBalance.toFixed(2)} → ₹${balance.toFixed(2)})`,
      created_at: now,
    });

    // If syncApiKey is true or API key exists, update API key balance as well
    if (targetEmail && (syncApiKey || syncApiKey === undefined)) {
      await db.collection<ApiKeyDoc>("api_keys").updateMany(
        { owner_email: targetEmail.toLowerCase() },
        { $set: { balance, unlimited: isUnlimited, updated_at: now } },
      );
    }
  }

  if (input.banUser) {
    const { userId, banReason } = input.banUser;
    const now = new Date();
    let email: string | undefined;

    if (userId.startsWith("reg_")) {
      email = userId.replace("reg_", "").trim().toLowerCase();
      await db.collection<LocalUserDoc>("local_users").updateOne(
        { email },
        {
          $setOnInsert: {
            _id: new ObjectId(),
            email,
            password_hash: "",
            created_at: now,
          },
          $set: {
            banned: true,
            ban_reason: banReason || "Banned by administrator",
            updated_at: now,
          },
        },
        { upsert: true },
      );
    } else {
      let objectId: ObjectId;
      try {
        objectId = new ObjectId(userId);
      } catch {
        return { ok: false as const, reason: "invalid-user-id" as const };
      }
      const user = await db.collection<LocalUserDoc>("local_users").findOneAndUpdate(
        { _id: objectId },
        {
          $set: {
            banned: true,
            ban_reason: banReason || "Banned by administrator",
            updated_at: now,
          },
        },
        { returnDocument: "after" },
      );
      if (!user) return { ok: false as const, reason: "user-not-found" as const };
      email = user.email;
      // Invalidate all active sessions
      await db.collection("local_sessions").deleteMany({ user_id: userId });
    }

    if (email) {
      // Disable any active API keys
      await db.collection<ApiKeyDoc>("api_keys").updateMany(
        { owner_email: email.toLowerCase() },
        { $set: { disabled: true, updated_at: now } },
      );
    }
  }

  if (input.unbanUser) {
    const { userId } = input.unbanUser;
    const now = new Date();
    let email: string | undefined;

    if (userId.startsWith("reg_")) {
      email = userId.replace("reg_", "").trim().toLowerCase();
      await db.collection<LocalUserDoc>("local_users").updateOne(
        { email },
        { $set: { banned: false, updated_at: now }, $unset: { ban_reason: "" } },
      );
    } else {
      let objectId: ObjectId;
      try {
        objectId = new ObjectId(userId);
      } catch {
        return { ok: false as const, reason: "invalid-user-id" as const };
      }
      const user = await db.collection<LocalUserDoc>("local_users").findOneAndUpdate(
        { _id: objectId },
        { $set: { banned: false, updated_at: now }, $unset: { ban_reason: "" } },
        { returnDocument: "after" },
      );
      if (!user) return { ok: false as const, reason: "user-not-found" as const };
      email = user.email;
    }

    if (email) {
      // Re-enable API keys
      await db.collection<ApiKeyDoc>("api_keys").updateMany(
        { owner_email: email.toLowerCase() },
        { $set: { disabled: false, updated_at: now } },
      );
    }
  }

  if (input.editUserProfile) {
    const { userId, name, phone } = input.editUserProfile;
    const now = new Date();
    let email: string | undefined;

    if (userId.startsWith("reg_")) {
      email = userId.replace("reg_", "").trim().toLowerCase();
      await db.collection<RegisteredUserDoc>("registered_users").updateOne(
        { email },
        { $set: { ...(name ? { name } : {}), ...(phone ? { phone } : {}) } },
      );
      await db.collection<LocalUserDoc>("local_users").updateOne(
        { email },
        {
          $setOnInsert: { _id: new ObjectId(), email, password_hash: "", created_at: now },
          $set: { ...(name ? { name } : {}), ...(phone ? { phone } : {}), updated_at: now },
        },
        { upsert: true },
      );
    } else {
      let objectId: ObjectId;
      try {
        objectId = new ObjectId(userId);
      } catch {
        return { ok: false as const, reason: "invalid-user-id" as const };
      }
      const user = await db.collection<LocalUserDoc>("local_users").findOneAndUpdate(
        { _id: objectId },
        { $set: { ...(name ? { name } : {}), ...(phone ? { phone } : {}), updated_at: now } },
        { returnDocument: "after" },
      );
      if (!user) return { ok: false as const, reason: "user-not-found" as const };
      email = user.email;
      if (email) {
        await db.collection<RegisteredUserDoc>("registered_users").updateOne(
          { email: email.toLowerCase() },
          { $set: { ...(name ? { name } : {}), ...(phone ? { phone } : {}) } },
        );
      }
    }
  }

  return { ok: true as const };
}
