/**
 * Public REST API v1
 * Base URL: /api/v1?action=...&api_key=...
 *
 * Compatible with FurySMS-style query-param interface so integrations are familiar.
 */
import { createFileRoute } from "@tanstack/react-router";
import { randomBytes, createHash } from "crypto";
import type {
  ApiKeyDoc,
  ApiOrderDoc,
  LocalUserDoc,
  WaCheckNumberDoc,
} from "@/integrations/mongodb/client.server";
import type { Collection } from "mongodb";

// ─── helpers ────────────────────────────────────────────────────────────────

function hashKey(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

function generateOrderId() {
  return randomBytes(12).toString("base64url").slice(0, 16);
}

async function claimRandomAvailableNumber(
  numbers: Collection<WaCheckNumberDoc>,
): Promise<WaCheckNumberDoc | null> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = await numbers
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
    if (!candidate) return null;

    const claimed = await numbers.findOneAndUpdate(
      {
        phone: candidate.phone,
        status: { $in: ["available", "sent", "found"] },
        owner_user_id: { $in: [null] },
      },
      { $set: { status: "pending_otp", updated_at: new Date() } },
      { returnDocument: "after" },
    );
    if (claimed) return claimed;
  }
  return null;
}

function txt(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function resolveKey(raw: string | null) {
  if (!raw) return null;
  const { getDb } = await import("@/integrations/mongodb/client.server");
  const db = await getDb();
  const doc = await db
    .collection<ApiKeyDoc>("api_keys")
    .findOne({ key: hashKey(raw), disabled: { $ne: true } });
  if (!doc) return null;

  // Check if owner is banned
  const bannedUser = await db.collection<LocalUserDoc>("local_users").findOne({
    email: doc.owner_email.toLowerCase(),
    banned: true,
  });
  if (bannedUser) return null;

  return doc;
}

// ─── rate limit (simple in-memory, 30 req/sec per key) ──────────────────────
const rateBuckets = new Map<string, { count: number; reset: number }>();
function checkRate(key: string): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const bucket = rateBuckets.get(key) ?? { count: 0, reset: now + 1000 };
  if (now > bucket.reset) {
    bucket.count = 0;
    bucket.reset = now + 1000;
  }
  bucket.count++;
  rateBuckets.set(key, bucket);
  if (bucket.count > 30) {
    return { ok: false, retryAfter: Math.ceil((bucket.reset - now) / 1000) };
  }
  return { ok: true, retryAfter: 0 };
}

// ─── Parameter Normalizer (Accepts any user parameters, ignores unnecessary ones) ──
async function extractParams(request: Request) {
  const url = new URL(request.url);
  const params: Record<string, string> = {};

  // 1. Gather all query parameters (case-insensitive keys)
  for (const [key, value] of url.searchParams.entries()) {
    params[key.toLowerCase()] = value.trim();
  }

  // 2. Parse body if POST / PUT (JSON or Form URL Encoded)
  if (request.method === "POST" || request.method === "PUT") {
    const contentType = request.headers.get("content-type") || "";
    try {
      if (contentType.includes("application/json")) {
        const body = await request.clone().json().catch(() => null);
        if (body && typeof body === "object") {
          for (const [k, v] of Object.entries(body)) {
            if (typeof v === "string" || typeof v === "number") {
              params[k.toLowerCase()] = String(v).trim();
            }
          }
        }
      } else if (
        contentType.includes("application/x-www-form-urlencoded") ||
        contentType.includes("multipart/form-data")
      ) {
        const formData = await request.clone().formData().catch(() => null);
        if (formData) {
          for (const [k, v] of formData.entries()) {
            if (typeof v === "string") {
              params[k.toLowerCase()] = v.trim();
            }
          }
        }
      }
    } catch {
      // ignore body parsing error, proceed with query params
    }
  }

  // 3. Extract API Key (support api_key, apikey, key, token, api-key, header x-api-key, Bearer token)
  let rawKey =
    params["api_key"] ||
    params["apikey"] ||
    params["key"] ||
    params["token"] ||
    params["api-key"] ||
    request.headers.get("x-api-key") ||
    request.headers.get("api-key") ||
    "";

  if (!rawKey) {
    const authHeader = request.headers.get("authorization") || "";
    if (authHeader.startsWith("Bearer ")) {
      rawKey = authHeader.slice(7).trim();
    }
  }

  // 4. Extract and normalize Action (normalize case, remove dashes/underscores)
  const rawAction = (params["action"] || params["act"] || params["method"] || "")
    .toLowerCase()
    .replace(/[-_]/g, "");

  let normalizedAction = "";
  if (rawAction === "getbalance" || rawAction === "balance") {
    normalizedAction = "getBalance";
  } else if (rawAction === "getnumber" || rawAction === "buy" || rawAction === "buynumber") {
    normalizedAction = "getNumber";
  } else if (rawAction === "getnumberv2" || rawAction === "buynumberv2") {
    normalizedAction = "getNumberV2";
  } else if (rawAction === "getstatus" || rawAction === "status" || rawAction === "getsms") {
    normalizedAction = "getStatus";
  } else if (rawAction === "setstatus" || rawAction === "cancel") {
    normalizedAction = "setStatus";
  } else if (rawAction === "regetnumber" || rawAction === "reget") {
    normalizedAction = "regetNumber";
  } else if (rawAction === "getcountries") {
    normalizedAction = "getCountries";
  } else if (rawAction === "getservices") {
    normalizedAction = "getServices";
  } else if (rawAction === "getservers") {
    normalizedAction = "getServers";
  }

  // 5. Extract Order ID (support id, order_id, orderid, activation_id, activationid)
  const orderId =
    params["id"] ||
    params["order_id"] ||
    params["orderid"] ||
    params["activation_id"] ||
    params["activationid"] ||
    "";

  // 6. Extract Status (support status, status_code, statuscode, code)
  const statusParam =
    params["status"] ||
    params["status_code"] ||
    params["statuscode"] ||
    params["code"] ||
    "";

  return {
    rawKey,
    action: normalizedAction,
    rawAction,
    orderId,
    statusParam,
  };
}

// ─── route ───────────────────────────────────────────────────────────────────
async function handleApi(request: Request) {
  const p = await extractParams(request);
  const action = p.action;
  const rawKey = p.rawKey;

  if (!action) return txt("WRONG_ACTION");
  if (!rawKey) return txt("BAD_KEY");

  // Rate limit
  const rate = checkRate(rawKey);
  if (!rate.ok) {
    return new Response("RATE_LIMIT_EXCEEDED", {
      status: 429,
      headers: {
        "Content-Type": "text/plain",
        "Retry-After": String(rate.retryAfter),
        "X-RateLimit-Limit": "30",
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(Math.floor(Date.now() / 1000) + rate.retryAfter),
      },
    });
  }

  // ── getBalance ──────────────────────────────────────────────────────
  if (action === "getBalance") {
    const keyDoc = await resolveKey(rawKey);
    if (!keyDoc) return txt("BAD_KEY");
    if (keyDoc.unlimited) {
      return txt("ACCESS_BALANCE:999999.00");
    }
    return txt(`ACCESS_BALANCE:${keyDoc.balance.toFixed(2)}`);
  }

  // ── getNumber ───────────────────────────────────────────────────────
  if (action === "getNumber") {
          const keyDoc = await resolveKey(rawKey);
          if (!keyDoc) return txt("BAD_KEY");

          if (!keyDoc.unlimited && keyDoc.balance < 49) return txt("NO_BALANCE");

          const { getDb } = await import("@/integrations/mongodb/client.server");
          const db = await getDb();
          const { regetFurySmsNumber } = await import("@/lib/furysms.server");

          const numbers = db.collection<WaCheckNumberDoc>("wa_check_numbers");
          let numDoc: WaCheckNumberDoc | null = null;
          let reget: Awaited<ReturnType<typeof regetFurySmsNumber>> | null = null;

          // Randomly claim an eligible unregistered number with a live provider session.
          while ((numDoc = await claimRandomAvailableNumber(numbers))) {
            if (!numDoc) break;

            reget = await regetFurySmsNumber(numDoc.provider_id ?? "");
            if (reget.ok) {
              break;
            } else {
              // Provider activation dead: mark expired and advance to next available number
              await numbers.updateOne(
                { phone: numDoc.phone, status: "pending_otp" },
                { $set: { status: "expired", note: reget.error, updated_at: new Date() } },
              );
              numDoc = null;
            }
          }

          if (!numDoc || !reget || !reget.ok) return txt("NO_NUMBER");

          const orderId = generateOrderId();
          const now = new Date();

          // Create API order record
          await db.collection<ApiOrderDoc>("api_orders").insertOne({
            order_id: orderId,
            phone: numDoc.phone,
            api_key: hashKey(rawKey),
            status: "waiting",
            otp: null,
            wa_doc_id: numDoc.phone,
            created_at: now,
            updated_at: now,
          });

          // Store active_order_id on the number doc
          await db.collection<WaCheckNumberDoc>("wa_check_numbers").updateOne(
            { phone: numDoc.phone },
            {
              $set: {
                status: "pending_otp",
                active_order_id: reget.orderId,
                bought_at: now,
                updated_at: now,
              },
            },
          );

          // Deduct balance (if not unlimited)
          if (!keyDoc.unlimited) {
            await db
              .collection<ApiKeyDoc>("api_keys")
              .updateOne(
                { key: hashKey(rawKey) },
                { $inc: { balance: -49 }, $set: { updated_at: now } },
              );
          }

          const cleanPhone = numDoc.phone.replace("+", "");
          return txt(`ACCESS_NUMBER:${orderId}:${cleanPhone}`);
        }

        // ── getNumberV2 ─────────────────────────────────────────────────────
        if (action === "getNumberV2") {
          const keyDoc = await resolveKey(rawKey);
          if (!keyDoc) return json({ status: "ERROR", error: "BAD_KEY" }, 401);

          if (!keyDoc.unlimited && keyDoc.balance < 49) return json({ status: "ERROR", error: "NO_BALANCE" });

          const { getDb } = await import("@/integrations/mongodb/client.server");
          const db = await getDb();
          const { regetFurySmsNumber } = await import("@/lib/furysms.server");

          const numbers = db.collection<WaCheckNumberDoc>("wa_check_numbers");
          let numDoc: WaCheckNumberDoc | null = null;
          let reget: Awaited<ReturnType<typeof regetFurySmsNumber>> | null = null;

          while ((numDoc = await claimRandomAvailableNumber(numbers))) {
            if (!numDoc) break;

            reget = await regetFurySmsNumber(numDoc.provider_id ?? "");
            if (reget.ok) {
              break;
            } else {
              await numbers.updateOne(
                { phone: numDoc.phone, status: "pending_otp" },
                { $set: { status: "expired", note: reget.error, updated_at: new Date() } },
              );
              numDoc = null;
            }
          }

          if (!numDoc || !reget || !reget.ok) return json({ status: "ERROR", error: "NO_NUMBER" });

          const orderId = generateOrderId();
          const now = new Date();

          await db.collection<ApiOrderDoc>("api_orders").insertOne({
            order_id: orderId,
            phone: numDoc.phone,
            api_key: hashKey(rawKey),
            status: "waiting",
            otp: null,
            wa_doc_id: numDoc.phone,
            created_at: now,
            updated_at: now,
          });

          await db.collection<WaCheckNumberDoc>("wa_check_numbers").updateOne(
            { phone: numDoc.phone },
            {
              $set: {
                status: "pending_otp",
                active_order_id: reget.orderId,
                bought_at: now,
                updated_at: now,
              },
            },
          );

          if (!keyDoc.unlimited) {
            await db
              .collection<ApiKeyDoc>("api_keys")
              .updateOne(
                { key: hashKey(rawKey) },
                { $inc: { balance: -49 }, $set: { updated_at: now } },
              );
          }

          return json({
            status: "OK",
            order_id: orderId,
            number: numDoc.phone.replace("+", ""),
            service: "WhatsApp",
            service_code: "whatsapp",
            country: "India",
            country_code: "22",
            price: 49,
            unlimited: Boolean(keyDoc.unlimited),
          });
        }

        // ── regetNumber ─────────────────────────────────────────────────────
        if (action === "regetNumber") {
          const keyDoc = await resolveKey(rawKey);
          if (!keyDoc) return txt("BAD_KEY");

          const orderId = p.orderId;
          if (!orderId) return txt("NO_ACTIVATION");

          if (!keyDoc.unlimited && keyDoc.balance < 49) return txt("NO_BALANCE");

          const { getDb } = await import("@/integrations/mongodb/client.server");
          const db = await getDb();

          const order = await db.collection<ApiOrderDoc>("api_orders").findOne({
            order_id: orderId,
            api_key: hashKey(rawKey),
          });
          if (!order) return txt("NO_ACTIVATION");
          if (order.status !== "ok") return txt("BAD_ACTION");

          const numDoc = await db
            .collection<WaCheckNumberDoc>("wa_check_numbers")
            .findOne({ phone: order.phone });
          if (!numDoc || !numDoc.provider_id) return txt("NO_ACTIVATION");

          const { regetFurySmsNumber } = await import("@/lib/furysms.server");
          const reget = await regetFurySmsNumber(numDoc.provider_id);
          if (!reget.ok) {
            if (reget.error.includes("NO_BALANCE")) return txt("NO_BALANCE");
            if (reget.error.includes("NO_ACTIVATION")) return txt("NO_ACTIVATION");
            return txt("ERROR");
          }

          if (reget.status === "STILL_ACTIVE") {
            return txt("NUMBER_STILL_ACTIVE");
          }

          const newOrderId = generateOrderId();
          const now = new Date();

          await db.collection<ApiOrderDoc>("api_orders").insertOne({
            order_id: newOrderId,
            phone: numDoc.phone,
            api_key: hashKey(rawKey),
            status: "waiting",
            otp: null,
            wa_doc_id: numDoc.phone,
            created_at: now,
            updated_at: now,
          });

          await db.collection<WaCheckNumberDoc>("wa_check_numbers").updateOne(
            { phone: numDoc.phone },
            {
              $set: {
                status: "pending_otp",
                active_order_id: reget.orderId,
                updated_at: now,
              },
            },
          );

          if (!keyDoc.unlimited) {
            await db
              .collection<ApiKeyDoc>("api_keys")
              .updateOne(
                { key: hashKey(rawKey) },
                { $inc: { balance: -49 }, $set: { updated_at: now } },
              );
          }

          const cleanPhone = numDoc.phone.replace("+", "");
          return txt(`REGET_NUMBER_OK:${newOrderId}:${cleanPhone}`);
        }

        // ── getStatus ───────────────────────────────────────────────────────
        if (action === "getStatus") {
          const keyDoc = await resolveKey(rawKey);
          if (!keyDoc) return txt("BAD_KEY");

          const orderId = p.orderId;
          if (!orderId) return txt("NO_ACTIVATION");

          const { getDb } = await import("@/integrations/mongodb/client.server");
          const db = await getDb();

          const order = await db.collection<ApiOrderDoc>("api_orders").findOne({
            order_id: orderId,
            api_key: hashKey(rawKey),
          });
          if (!order) return txt("NO_ACTIVATION");

          if (order.status === "cancelled") return txt("STATUS_CANCEL");
          if (order.status === "ok" && order.otp) return txt(`STATUS_OK:${order.otp}`);

          // Pull fresh status from wa_check_numbers
          const numDoc = await db
            .collection<WaCheckNumberDoc>("wa_check_numbers")
            .findOne({ phone: order.phone });
          if (!numDoc) return txt("STATUS_WAIT_CODE");

          if (numDoc.status === "completed" && numDoc.otp) {
            // Sync to api_orders
            await db
              .collection<ApiOrderDoc>("api_orders")
              .updateOne(
                { order_id: orderId },
                { $set: { status: "ok", otp: numDoc.otp, updated_at: new Date() } },
              );
            return txt(`STATUS_OK:${numDoc.otp}`);
          }

          if (numDoc.active_order_id) {
            // Poll FurySMS directly for freshest status
            const { checkFurySmsStatus } = await import("@/lib/furysms.server");
            const res = await checkFurySmsStatus(numDoc.active_order_id);
            if (res.status === "OK" && res.code) {
              const now = new Date();
              await db
                .collection<WaCheckNumberDoc>("wa_check_numbers")
                .updateOne(
                  { phone: order.phone },
                  { $set: { status: "completed", otp: res.code, updated_at: now } },
                );
              await db
                .collection<ApiOrderDoc>("api_orders")
                .updateOne(
                  { order_id: orderId },
                  { $set: { status: "ok", otp: res.code, updated_at: now } },
                );
              return txt(`STATUS_OK:${res.code}`);
            }
            if (res.status === "CANCELLED") {
              await db
                .collection<ApiOrderDoc>("api_orders")
                .updateOne(
                  { order_id: orderId },
                  { $set: { status: "cancelled", updated_at: new Date() } },
                );
              return txt("STATUS_CANCEL");
            }
          }

          return txt("STATUS_WAIT_CODE");
        }

        // ── setStatus ───────────────────────────────────────────────────────
        if (action === "setStatus") {
          const keyDoc = await resolveKey(rawKey);
          if (!keyDoc) return txt("BAD_KEY");

          const orderId = p.orderId;
          const status = p.statusParam;
          if (!orderId) return txt("NO_ACTIVATION");
          if (status !== "8" && status !== "3") return txt("BAD_STATUS");

          const { getDb } = await import("@/integrations/mongodb/client.server");
          const db = await getDb();

          const order = await db.collection<ApiOrderDoc>("api_orders").findOne({
            order_id: orderId,
            api_key: hashKey(rawKey),
          });
          if (!order) return txt("NO_ACTIVATION");
          if (order.status === "ok") return txt("ACCESS_ACTIVATION"); // already has SMS

          if (status === "8") {
            // Cancel
            const ageMs = Date.now() - order.created_at.getTime();
            if (ageMs < 2 * 60 * 1000) {
              const secondsLeft = Math.ceil((2 * 60 * 1000 - ageMs) / 1000);
              return txt(`EARLY_CANCEL_DENIED:${secondsLeft}`);
            }
            const now = new Date();
            await db
              .collection<ApiOrderDoc>("api_orders")
              .updateOne({ order_id: orderId }, { $set: { status: "cancelled", updated_at: now } });
            // Restore number to available
            await db
              .collection<WaCheckNumberDoc>("wa_check_numbers")
              .updateOne(
                { phone: order.phone },
                { $set: { status: "available", active_order_id: null, updated_at: now } },
              );
            // Refund if not unlimited
            if (!keyDoc.unlimited) {
              await db
                .collection<ApiKeyDoc>("api_keys")
                .updateOne(
                  { key: hashKey(rawKey) },
                  { $inc: { balance: 49 }, $set: { updated_at: now } },
                );
            }
            return txt("STATUS_CANCEL");
          }

          if (status === "3") {
            // next SMS — only valid after SMS received
            const orderStatus: string = order.status;
            if (orderStatus !== "ok") return txt("BAD_ACTION");
            return txt("ACCESS_RETRY_GET");
          }

          return txt("BAD_STATUS");
        }

        // ── Compatibility Endpoints ─────────────────────────────────────────
        if (action === "getCountries") {
          return json({ "22": "India" });
        }

        if (action === "getServices") {
          return json({
            whatsapp: { name: "WhatsApp", price: "49", server: "india" },
          });
        }

        if (action === "getServers") {
          return json({
            india: { id: "india", name: "India", countryCode: "22" },
          });
        }

        return txt("WRONG_ACTION");
}

export const Route = createFileRoute("/api/v1")({
  server: {
    handlers: {
      GET: async ({ request }) => handleApi(request),
      POST: async ({ request }) => handleApi(request),
    },
  },
});
