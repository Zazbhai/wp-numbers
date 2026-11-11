import { MongoClient, Db, ObjectId, ServerApiVersion } from "mongodb";

export interface RegisteredUserDoc {
  name: string;
  email: string;
  phone: string;
  created_at: Date;
}

export interface LocalUserDoc {
  _id: ObjectId;
  email: string;
  password_hash: string;
  name?: string | null | undefined;
  phone?: string | null | undefined;
  banned?: boolean | undefined;
  ban_reason?: string | null | undefined;
  unlimited_balance?: boolean | undefined;
  created_at: Date;
  updated_at: Date;
}

export interface LocalSessionDoc {
  _id?: ObjectId;
  user_id: string;
  token_hash: string;
  created_at: Date;
  expires_at: Date;
}

export interface WaCheckNumberDoc {
  phone: string;
  /**
   * Status flow:
   *   pending        → Freshly bought from FurySMS, sent to WA checker
   *   pending_verify → First pass said "unregistered"; awaiting second independent check to confirm
   *   available      → Confirmed unregistered on BOTH checks; visible in marketplace
   *   skipped        → Registered on WhatsApp; FurySMS credit refunded
   *   pending_otp    → Customer purchased; regetNumber active, polling OTP
   *   completed      → OTP delivered to customer
   *   expired        → FurySMS session dead (ERROR/NO_ACTIVATION on regetNumber)
   *   found/sent/cancelled → Legacy/misc statuses
   */
  status:
    | "pending"
    | "pending_verify"
    | "found"
    | "sent"
    | "skipped"
    | "available"
    | "pending_otp"
    | "completed"
    | "expired"
    | "cancelled";
  note: string | null;
  provider_id?: string | null;
  active_order_id?: string | null;
  owner_user_id?: string | null;
  payment_id?: string | null;
  wallet_purchase_id?: string | null;
  otp?: string | null;
  bought_at?: Date | null;
  verify_count?: number; // how many times "unregistered" was confirmed
  first_found_at?: Date | null; // timestamp of first unregistered detection
  created_at: Date;
  updated_at: Date;
}

export interface BharatPePaymentSettingsDoc {
  _id: "bharatpe";
  enabled: boolean;
  merchant_id: string;
  access_token_encrypted: string;
  session_cookie_encrypted: string;
  upi_id: string;
  merchant_name: string;
  updated_at: Date;
}

export interface MarketplacePaymentDoc {
  payment_id: string;
  utr: string;
  user_id: string;
  phone: string;
  amount: number;
  status: "verified" | "fulfilled" | "refund_required" | "refunded";
  provider_status: string;
  provider_transaction_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface UserWalletDoc {
  user_id: string;
  balance: number;
  unlimited?: boolean | undefined;
  updated_at: Date;
}

export interface WalletTransactionDoc {
  transaction_id: string;
  user_id: string;
  type: "topup" | "purchase" | "refund";
  amount: number;
  utr?: string;
  phone?: string;
  description: string;
  created_at: Date;
}

export interface BotChatDoc {
  chat_id: number;
  first_name: string | null;
  updated_at: Date;
}

export interface WaSessionDoc {
  session_id: string;
  state: "connected" | "logged_out";
  updated_at: Date;
  alert_state: "none" | "pending" | "sending" | "sent";
  telegram_message_id?: number | null;
  alert_error?: string | null;
}

export interface BusinessLineOfferDoc {
  id: string;
  city: string;
  label: string;
  prefix: string;
  available: number;
  monthly_price: number;
  updated_at: Date;
}

export interface BusinessLineOrderDoc {
  order_id: string;
  offer_id: string;
  city: string;
  customer_name: string;
  email: string;
  quantity: number;
  monthly_price: number;
  total_monthly: number;
  status: "requested" | "fulfilled";
  created_at: Date;
  fulfilled_at: Date | null;
}

export interface ApiKeyDoc {
  key: string; // the actual secret key (sha256 hash stored)
  raw_key?: string; // full raw key for owner display & copying
  label: string; // user-visible label
  owner_email: string;
  balance: number; // credits in INR
  unlimited?: boolean | undefined;
  created_at: Date;
  updated_at: Date;
  disabled?: boolean;
}

export interface ApiOrderDoc {
  order_id: string; // our order ID
  phone: string;
  api_key: string; // which key purchased it
  status: "waiting" | "ok" | "cancelled";
  otp?: string | null;
  wa_doc_id: string; // reference phone in wa_check_numbers
  created_at: Date;
  updated_at: Date;
}

export interface BusinessLineSettingsDoc {
  _id: "store";
  maintenance: boolean;
  domain: string;
  updated_at: Date;
}

declare global {
  // eslint-disable-next-line no-var
  var __mongoClientPromise: Promise<MongoClient> | undefined;
}

let clientPromise: Promise<MongoClient> | undefined;

export function getMongoClient(): Promise<MongoClient> {
  const uri = process.env["MONGODB_URI"] || process.env["MONGO_URI"];

  if (!uri) {
    const errorMsg =
      "Missing MONGODB_URI in environment variables. Please set MONGODB_URI in your .env file.";
    console.error(`[MongoDB] ${errorMsg}`);
    throw new Error(errorMsg);
  }

  // Use cached promise across HMR / module reloads in development
  if (process.env["NODE_ENV"] === "development") {
    if (!global.__mongoClientPromise) {
      const client = new MongoClient(uri, {
        serverApi: {
          version: ServerApiVersion.v1,
          strict: false,
          deprecationErrors: true,
        },
      });
      global.__mongoClientPromise = client.connect();
    }
    return global.__mongoClientPromise;
  }

  if (!clientPromise) {
    const client = new MongoClient(uri, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: false,
        deprecationErrors: true,
      },
    });
    clientPromise = client.connect();
  }

  return clientPromise;
}

let indexesEnsured = false;
async function ensureIndexes(db: Db): Promise<void> {
  if (indexesEnsured) return;
  try {
    await Promise.all([
      db
        .collection<RegisteredUserDoc>("registered_users")
        .createIndex({ email: 1 }, { unique: true }),
      db
        .collection<RegisteredUserDoc>("registered_users")
        .createIndex({ phone: 1 }, { unique: true }),
      db.collection<LocalUserDoc>("local_users").createIndex({ email: 1 }, { unique: true }),
      db
        .collection<LocalSessionDoc>("local_sessions")
        .createIndex({ token_hash: 1 }, { unique: true }),
      db
        .collection<LocalSessionDoc>("local_sessions")
        .createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 }),
      db
        .collection<WaCheckNumberDoc>("wa_check_numbers")
        .createIndex({ phone: 1 }, { unique: true }),
      db.collection<WaCheckNumberDoc>("wa_check_numbers").createIndex({ status: 1, created_at: 1 }),
      db
        .collection<MarketplacePaymentDoc>("marketplace_payments")
        .createIndex({ utr: 1 }, { unique: true }),
      db
        .collection<MarketplacePaymentDoc>("marketplace_payments")
        .createIndex({ status: 1, created_at: -1 }),
      db.collection<UserWalletDoc>("user_wallets").createIndex({ user_id: 1 }, { unique: true }),
      db
        .collection<WalletTransactionDoc>("wallet_transactions")
        .createIndex({ transaction_id: 1 }, { unique: true }),
      db
        .collection<WalletTransactionDoc>("wallet_transactions")
        .createIndex({ utr: 1 }, { unique: true, sparse: true }),
      db
        .collection<WalletTransactionDoc>("wallet_transactions")
        .createIndex({ user_id: 1, created_at: -1 }),
      db.collection<BotChatDoc>("bot_chats").createIndex({ chat_id: 1 }, { unique: true }),
      db.collection<WaSessionDoc>("wa_sessions").createIndex({ session_id: 1 }, { unique: true }),
      db.collection<WaSessionDoc>("wa_sessions").createIndex({ alert_state: 1, updated_at: 1 }),
      db
        .collection<BusinessLineOfferDoc>("business_line_offers")
        .createIndex({ id: 1 }, { unique: true }),
      db
        .collection<BusinessLineOrderDoc>("business_line_orders")
        .createIndex({ order_id: 1 }, { unique: true }),
      db
        .collection<BusinessLineOrderDoc>("business_line_orders")
        .createIndex({ status: 1, created_at: -1 }),
      db.collection<ApiKeyDoc>("api_keys").createIndex({ key: 1 }, { unique: true }),
      db.collection<ApiKeyDoc>("api_keys").createIndex({ owner_email: 1 }),
      db.collection<ApiOrderDoc>("api_orders").createIndex({ order_id: 1 }, { unique: true }),
      db.collection<ApiOrderDoc>("api_orders").createIndex({ api_key: 1, created_at: -1 }),
    ]);
    indexesEnsured = true;
  } catch (err) {
    console.warn("[MongoDB] Notice: Could not ensure some indexes (may already exist):", err);
    indexesEnsured = true;
  }
}

export async function getDb(): Promise<Db> {
  const client = await getMongoClient();
  const dbName = process.env["MONGODB_DB_NAME"] || undefined;
  const db = client.db(dbName);
  await ensureIndexes(db);
  return db;
}

export async function testConnection(): Promise<{
  ok: boolean;
  message: string;
  database?: string;
}> {
  try {
    const db = await getDb();
    await db.command({ ping: 1 });
    return {
      ok: true,
      message: "MongoDB connected successfully!",
      database: db.databaseName,
    };
  } catch (err: unknown) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
