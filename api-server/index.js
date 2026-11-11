try {
  process.loadEnvFile?.();
} catch {}
try {
  process.loadEnvFile?.("./api-server/.env");
} catch {}
import "dotenv/config";
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { getDb, closeDb } from "./db.js";
import { regetFurySmsNumber, checkFurySmsStatus } from "./furysms.js";

const PORT = Number(process.env.PORT || process.env.API_PORT || 5000);
const NUMBER_PRICE = Number(process.env.NUMBER_PRICE || 49);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_PER_SEC || 30);
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hashKey(raw) {
  return createHash("sha256").update(raw).digest("hex");
}

function generateOrderId() {
  return randomBytes(12).toString("base64url").slice(0, 16);
}

function sendText(res, text, status = 200, extraHeaders = {}) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Access-Control-Allow-Origin": CORS_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
    ...extraHeaders,
  });
  res.end(text);
}

function sendJson(res, data, status = 200, extraHeaders = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Access-Control-Allow-Origin": CORS_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
    ...extraHeaders,
  });
  res.end(JSON.stringify(data));
}

// ─── In-Memory Rate Limiting (30 req/sec per API Key) ─────────────────────────
const rateBuckets = new Map();

function checkRate(key) {
  const now = Date.now();
  const bucket = rateBuckets.get(key) ?? { count: 0, reset: now + 1000 };
  if (now > bucket.reset) {
    bucket.count = 0;
    bucket.reset = now + 1000;
  }
  bucket.count++;
  rateBuckets.set(key, bucket);

  if (bucket.count > RATE_LIMIT_MAX) {
    const retryAfter = Math.ceil((bucket.reset - now) / 1000);
    return { ok: false, retryAfter };
  }
  return { ok: true, retryAfter: 0 };
}

// ─── Key & User Resolution ───────────────────────────────────────────────────

async function resolveKey(rawKey) {
  if (!rawKey) return null;
  const db = await getDb();
  const hashed = hashKey(rawKey);

  const doc = await db.collection("api_keys").findOne({
    key: hashed,
    disabled: { $ne: true },
  });
  if (!doc) return null;

  // Verify owner is not banned
  if (doc.owner_email) {
    const bannedUser = await db.collection("local_users").findOne({
      email: doc.owner_email.toLowerCase(),
      banned: true,
    });
    if (bannedUser) return null;
  }

  return doc;
}

// ─── Number Allocation ───────────────────────────────────────────────────────

async function claimRandomAvailableNumber(numbersCollection) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = await numbersCollection
      .aggregate([
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

    const claimed = await numbersCollection.findOneAndUpdate(
      {
        phone: candidate.phone,
        status: { $in: ["available", "sent", "found"] },
        owner_user_id: { $in: [null] },
      },
      { $set: { status: "pending_otp", updated_at: new Date() } },
      { returnDocument: "after" }
    );

    if (claimed) return claimed;
  }
  return null;
}

// ─── Body Parser (for POST / PUT requests) ──────────────────────────────────

function parseBody(req) {
  if (req.method !== "POST" && req.method !== "PUT") return Promise.resolve({});
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        req.destroy();
        resolve({});
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      const contentType = req.headers["content-type"] || "";
      if (contentType.includes("application/json")) {
        try {
          return resolve(JSON.parse(body));
        } catch {
          return resolve({});
        }
      }
      if (
        contentType.includes("application/x-www-form-urlencoded") ||
        contentType.includes("multipart/form-data")
      ) {
        try {
          const params = {};
          const searchParams = new URLSearchParams(body);
          for (const [k, v] of searchParams.entries()) {
            params[k] = v;
          }
          return resolve(params);
        } catch {
          return resolve({});
        }
      }
      resolve({});
    });
    req.on("error", () => resolve({}));
  });
}

// ─── Parameter Normalizer (Accepts any user parameters, ignores unnecessary ones) ──

async function extractParams(req, url) {
  const params = {};

  // 1. Gather all query parameters (case-insensitive keys)
  for (const [key, value] of url.searchParams.entries()) {
    params[key.toLowerCase()] = String(value).trim();
  }

  // 2. Parse body if POST / PUT
  const body = await parseBody(req);
  if (body && typeof body === "object") {
    for (const [k, v] of Object.entries(body)) {
      if (typeof v === "string" || typeof v === "number") {
        params[k.toLowerCase()] = String(v).trim();
      }
    }
  }

  // 3. Extract API Key (support api_key, apikey, key, token, api-key, header x-api-key, Bearer token)
  let rawKey =
    params["api_key"] ||
    params["apikey"] ||
    params["key"] ||
    params["token"] ||
    params["api-key"] ||
    req.headers["x-api-key"] ||
    req.headers["api-key"] ||
    "";

  if (!rawKey) {
    const authHeader = req.headers["authorization"] || "";
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

// ─── Main Request Handler ───────────────────────────────────────────────────

async function handleRequest(req, res) {
  const host = req.headers.host || `localhost:${PORT}`;
  const url = new URL(req.url, `http://${host}`);
  const pathname = url.pathname;

  // Handle CORS Preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": CORS_ORIGIN,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, x-api-key",
      "Access-Control-Max-Age": "86400",
    });
    res.end();
    return;
  }

  // Health check endpoint
  if (pathname === "/health") {
    try {
      const db = await getDb();
      await db.command({ ping: 1 });
      return sendJson(res, {
        status: "ok",
        database: "connected",
        port: PORT,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      return sendJson(res, { status: "error", database: err.message }, 503);
    }
  }

  // Check valid API paths: /api/v1, /stubs/handler_api.php, or root / with query
  const isApiRoute =
    pathname === "/api/v1" ||
    pathname === "/stubs/handler_api.php" ||
    pathname === "/";

  const p = await extractParams(req, url);
  const action = p.action;
  const rawKey = p.rawKey;

  // Root accessed without query params: return service banner
  if (pathname === "/" && !action && !rawKey) {
    return sendJson(res, {
      name: "FurySMS Standalone Public API Gateway",
      version: "1.0.0",
      status: "online",
      endpoints: ["/api/v1", "/stubs/handler_api.php"],
      docs: "/api-docs",
      usage: "Pass action and api_key as query parameters or POST body.",
    });
  }

  if (!isApiRoute) {
    return sendText(res, "404 Not Found", 404);
  }

  if (!action) return sendText(res, "WRONG_ACTION");
  if (!rawKey) return sendText(res, "BAD_KEY");

  // Rate Limiting Check
  const rate = checkRate(rawKey);
  if (!rate.ok) {
    return sendText(res, "RATE_LIMIT_EXCEEDED", 429, {
      "Retry-After": String(rate.retryAfter),
      "X-RateLimit-Limit": String(RATE_LIMIT_MAX),
      "X-RateLimit-Remaining": "0",
      "X-RateLimit-Reset": String(Math.floor(Date.now() / 1000) + rate.retryAfter),
    });
  }

  // ── getBalance ─────────────────────────────────────────────────────────────
  if (action === "getBalance") {
    const keyDoc = await resolveKey(rawKey);
    if (!keyDoc) return sendText(res, "BAD_KEY");
    if (keyDoc.unlimited) {
      return sendText(res, "ACCESS_BALANCE:999999.00");
    }
    return sendText(res, `ACCESS_BALANCE:${Number(keyDoc.balance || 0).toFixed(2)}`);
  }

  // ── getNumber ──────────────────────────────────────────────────────────────
  if (action === "getNumber") {
    const keyDoc = await resolveKey(rawKey);
    if (!keyDoc) return sendText(res, "BAD_KEY");

    if (!keyDoc.unlimited && Number(keyDoc.balance || 0) < NUMBER_PRICE) {
      return sendText(res, "NO_BALANCE");
    }

    const db = await getDb();
    const numbers = db.collection("wa_check_numbers");
    let numDoc = null;
    let reget = null;

    while ((numDoc = await claimRandomAvailableNumber(numbers))) {
      if (!numDoc) break;

      reget = await regetFurySmsNumber(numDoc.provider_id || "");
      if (reget && reget.ok) {
        break;
      } else {
        await numbers.updateOne(
          { phone: numDoc.phone, status: "pending_otp" },
          { $set: { status: "expired", note: reget?.error || "Expired", updated_at: new Date() } }
        );
        numDoc = null;
      }
    }

    if (!numDoc || !reget || !reget.ok) {
      return sendText(res, "NO_NUMBER");
    }

    const orderId = generateOrderId();
    const now = new Date();

    // Insert order record
    await db.collection("api_orders").insertOne({
      order_id: orderId,
      phone: numDoc.phone,
      api_key: hashKey(rawKey),
      status: "waiting",
      otp: null,
      wa_doc_id: numDoc.phone,
      created_at: now,
      updated_at: now,
    });

    // Update number doc
    await db.collection("wa_check_numbers").updateOne(
      { phone: numDoc.phone },
      {
        $set: {
          status: "pending_otp",
          active_order_id: reget.orderId,
          bought_at: now,
          updated_at: now,
        },
      }
    );

    // Deduct balance (if not unlimited)
    if (!keyDoc.unlimited) {
      await db.collection("api_keys").updateOne(
        { key: hashKey(rawKey) },
        { $inc: { balance: -NUMBER_PRICE }, $set: { updated_at: now } }
      );
    }

    const cleanPhone = numDoc.phone.replace("+", "");
    return sendText(res, `ACCESS_NUMBER:${orderId}:${cleanPhone}`);
  }

  // ── getNumberV2 (JSON Output) ──────────────────────────────────────────────
  if (action === "getNumberV2") {
    const keyDoc = await resolveKey(rawKey);
    if (!keyDoc) return sendJson(res, { status: "ERROR", error: "BAD_KEY" }, 401);

    if (!keyDoc.unlimited && Number(keyDoc.balance || 0) < NUMBER_PRICE) {
      return sendJson(res, { status: "ERROR", error: "NO_BALANCE" });
    }

    const db = await getDb();
    const numbers = db.collection("wa_check_numbers");
    let numDoc = null;
    let reget = null;

    while ((numDoc = await claimRandomAvailableNumber(numbers))) {
      if (!numDoc) break;

      reget = await regetFurySmsNumber(numDoc.provider_id || "");
      if (reget && reget.ok) {
        break;
      } else {
        await numbers.updateOne(
          { phone: numDoc.phone, status: "pending_otp" },
          { $set: { status: "expired", note: reget?.error || "Expired", updated_at: new Date() } }
        );
        numDoc = null;
      }
    }

    if (!numDoc || !reget || !reget.ok) {
      return sendJson(res, { status: "ERROR", error: "NO_NUMBER" });
    }

    const orderId = generateOrderId();
    const now = new Date();

    await db.collection("api_orders").insertOne({
      order_id: orderId,
      phone: numDoc.phone,
      api_key: hashKey(rawKey),
      status: "waiting",
      otp: null,
      wa_doc_id: numDoc.phone,
      created_at: now,
      updated_at: now,
    });

    await db.collection("wa_check_numbers").updateOne(
      { phone: numDoc.phone },
      {
        $set: {
          status: "pending_otp",
          active_order_id: reget.orderId,
          bought_at: now,
          updated_at: now,
        },
      }
    );

    if (!keyDoc.unlimited) {
      await db.collection("api_keys").updateOne(
        { key: hashKey(rawKey) },
        { $inc: { balance: -NUMBER_PRICE }, $set: { updated_at: now } }
      );
    }

    return sendJson(res, {
      status: "OK",
      order_id: orderId,
      activation_id: reget.orderId,
      number: numDoc.phone.replace("+", ""),
      service: "WhatsApp",
      service_code: "whatsapp",
      country: "India",
      country_code: "22",
      price: NUMBER_PRICE,
      unlimited: Boolean(keyDoc.unlimited),
    });
  }

  // ── regetNumber ────────────────────────────────────────────────────────────
  if (action === "regetNumber") {
    const keyDoc = await resolveKey(rawKey);
    if (!keyDoc) return sendText(res, "BAD_KEY");

    const orderId = p.orderId;
    if (!orderId) return sendText(res, "NO_ACTIVATION");

    if (!keyDoc.unlimited && Number(keyDoc.balance || 0) < NUMBER_PRICE) {
      return sendText(res, "NO_BALANCE");
    }

    const db = await getDb();

    const order = await db.collection("api_orders").findOne({
      order_id: orderId,
      api_key: hashKey(rawKey),
    });
    if (!order) return sendText(res, "NO_ACTIVATION");
    if (order.status !== "ok") return sendText(res, "BAD_ACTION");

    const numDoc = await db.collection("wa_check_numbers").findOne({ phone: order.phone });
    if (!numDoc || !numDoc.provider_id) return sendText(res, "NO_ACTIVATION");

    const reget = await regetFurySmsNumber(numDoc.provider_id);
    if (!reget.ok) {
      if (reget.error.includes("NO_BALANCE")) return sendText(res, "NO_BALANCE");
      if (reget.error.includes("NO_ACTIVATION")) return sendText(res, "NO_ACTIVATION");
      return sendText(res, "ERROR");
    }

    if (reget.status === "STILL_ACTIVE") {
      return sendText(res, "NUMBER_STILL_ACTIVE");
    }

    const newOrderId = generateOrderId();
    const now = new Date();

    await db.collection("api_orders").insertOne({
      order_id: newOrderId,
      phone: numDoc.phone,
      api_key: hashKey(rawKey),
      status: "waiting",
      otp: null,
      wa_doc_id: numDoc.phone,
      created_at: now,
      updated_at: now,
    });

    await db.collection("wa_check_numbers").updateOne(
      { phone: numDoc.phone },
      {
        $set: {
          status: "pending_otp",
          active_order_id: reget.orderId,
          updated_at: now,
        },
      }
    );

    if (!keyDoc.unlimited) {
      await db.collection("api_keys").updateOne(
        { key: hashKey(rawKey) },
        { $inc: { balance: -NUMBER_PRICE }, $set: { updated_at: now } }
      );
    }

    const cleanPhone = numDoc.phone.replace("+", "");
    return sendText(res, `REGET_NUMBER_OK:${newOrderId}:${cleanPhone}`);
  }

  // ── getStatus ──────────────────────────────────────────────────────────────
  if (action === "getStatus") {
    const keyDoc = await resolveKey(rawKey);
    if (!keyDoc) return sendText(res, "BAD_KEY");

    const orderId = p.orderId;
    if (!orderId) return sendText(res, "NO_ACTIVATION");

    const db = await getDb();

    const order = await db.collection("api_orders").findOne({
      order_id: orderId,
      api_key: hashKey(rawKey),
    });
    if (!order) return sendText(res, "NO_ACTIVATION");

    if (order.status === "cancelled") return sendText(res, "STATUS_CANCEL");
    if (order.status === "ok" && order.otp) return sendText(res, `STATUS_OK:${order.otp}`);

    const numDoc = await db.collection("wa_check_numbers").findOne({ phone: order.phone });
    if (!numDoc) return sendText(res, "STATUS_WAIT_CODE");

    if (numDoc.status === "completed" && numDoc.otp) {
      await db.collection("api_orders").updateOne(
        { order_id: orderId },
        { $set: { status: "ok", otp: numDoc.otp, updated_at: new Date() } }
      );
      return sendText(res, `STATUS_OK:${numDoc.otp}`);
    }

    if (numDoc.active_order_id) {
      const resStatus = await checkFurySmsStatus(numDoc.active_order_id);
      if (resStatus.status === "OK" && resStatus.code) {
        const now = new Date();
        await db.collection("wa_check_numbers").updateOne(
          { phone: order.phone },
          { $set: { status: "completed", otp: resStatus.code, updated_at: now } }
        );
        await db.collection("api_orders").updateOne(
          { order_id: orderId },
          { $set: { status: "ok", otp: resStatus.code, updated_at: now } }
        );
        return sendText(res, `STATUS_OK:${resStatus.code}`);
      }
      if (resStatus.status === "CANCELLED") {
        await db.collection("api_orders").updateOne(
          { order_id: orderId },
          { $set: { status: "cancelled", updated_at: new Date() } }
        );
        return sendText(res, "STATUS_CANCEL");
      }
    }

    return sendText(res, "STATUS_WAIT_CODE");
  }

  // ── setStatus ──────────────────────────────────────────────────────────────
  if (action === "setStatus") {
    const keyDoc = await resolveKey(rawKey);
    if (!keyDoc) return sendText(res, "BAD_KEY");

    const orderId = p.orderId;
    const statusParam = p.statusParam;
    if (!orderId) return sendText(res, "NO_ACTIVATION");
    if (statusParam !== "8" && statusParam !== "3") return sendText(res, "BAD_STATUS");

    const db = await getDb();

    const order = await db.collection("api_orders").findOne({
      order_id: orderId,
      api_key: hashKey(rawKey),
    });
    if (!order) return sendText(res, "NO_ACTIVATION");
    if (order.status === "ok") return sendText(res, "ACCESS_ACTIVATION");

    if (statusParam === "8") {
      // 2-minute cancellation cooldown check
      const ageMs = Date.now() - new Date(order.created_at).getTime();
      if (ageMs < 2 * 60 * 1000) {
        const secondsLeft = Math.ceil((2 * 60 * 1000 - ageMs) / 1000);
        return sendText(res, `EARLY_CANCEL_DENIED:${secondsLeft}`);
      }

      const now = new Date();
      await db.collection("api_orders").updateOne(
        { order_id: orderId },
        { $set: { status: "cancelled", updated_at: now } }
      );

      await db.collection("wa_check_numbers").updateOne(
        { phone: order.phone },
        { $set: { status: "available", active_order_id: null, updated_at: now } }
      );

      if (!keyDoc.unlimited) {
        await db.collection("api_keys").updateOne(
          { key: hashKey(rawKey) },
          { $inc: { balance: NUMBER_PRICE }, $set: { updated_at: now } }
        );
      }

      return sendText(res, "STATUS_CANCEL");
    }

    if (statusParam === "3") {
      if (order.status !== "ok") return sendText(res, "BAD_ACTION");
      return sendText(res, "ACCESS_RETRY_GET");
    }

    return sendText(res, "BAD_STATUS");
  }

  // ── Compatibility Endpoints (for standard SMS bots) ────────────────────────
  if (action === "getCountries") {
    return sendJson(res, { "22": "India" });
  }

  if (action === "getServices") {
    return sendJson(res, {
      whatsapp: { name: "WhatsApp", price: String(NUMBER_PRICE), server: "india" },
    });
  }

  if (action === "getServers") {
    return sendJson(res, {
      india: { id: "india", name: "India", countryCode: "22" },
    });
  }

  return sendText(res, "WRONG_ACTION");
}

// ─── Server Startup ──────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  try {
    await handleRequest(req, res);
  } catch (err) {
    console.error("[API Server Error]:", err);
    if (!res.headersSent) {
      sendText(res, "ERROR_SQL", 500);
    }
  }
});

server.listen(PORT, async () => {
  console.log(`===================================================`);
  console.log(`🚀 Standalone SMS API Server running on port ${PORT}`);
  console.log(`📡 Base URLs:`);
  console.log(`   - http://localhost:${PORT}/api/v1`);
  console.log(`   - http://localhost:${PORT}/stubs/handler_api.php`);
  console.log(`   - http://localhost:${PORT}/health`);
  console.log(`===================================================`);

  try {
    await getDb();
  } catch (err) {
    console.error("Warning: Initial DB connection failed, will retry on request.");
  }
});

// ─── Graceful Shutdown ───────────────────────────────────────────────────────

async function shutdown(signal) {
  console.log(`\n[API Server] Received ${signal}, shutting down gracefully...`);
  server.close(async () => {
    await closeDb();
    console.log("[API Server] Stopped.");
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
