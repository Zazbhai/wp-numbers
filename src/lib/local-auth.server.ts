import { createHash, randomBytes } from "node:crypto";
import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";
import { ObjectId } from "mongodb";
import {
  getDb,
  type LocalSessionDoc,
  type LocalUserDoc,
} from "@/integrations/mongodb/client.server";
import { hashPassword, verifyPassword } from "./local-auth-crypto";

const SESSION_COOKIE = "wa_local_session";
const SESSION_SECONDS = 60 * 60 * 24 * 14;

export interface LocalAuthSession {
  userId: string;
  email: string;
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env["NODE_ENV"] === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_SECONDS,
  };
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createLocalAccount(
  email: string,
  password: string,
  name?: string,
  phone?: string,
) {
  const db = await getDb();
  const now = new Date();
  const userId = new ObjectId();
  const passwordHash = await hashPassword(password);

  const newDoc: LocalUserDoc = {
    _id: userId,
    email: email.trim().toLowerCase(),
    password_hash: passwordHash,
    banned: false,
    created_at: now,
    updated_at: now,
  };
  if (name?.trim()) newDoc.name = name.trim();
  if (phone?.trim()) newDoc.phone = phone.trim();

  await db.collection<LocalUserDoc>("local_users").insertOne(newDoc);

  await createLocalSession(userId.toHexString());
}

export async function signInLocalAccount(email: string, password: string) {
  const db = await getDb();
  const user = await db.collection<LocalUserDoc>("local_users").findOne({
    email: email.trim().toLowerCase(),
  });
  if (!user || !(await verifyPassword(password, user.password_hash))) return false;
  if (user.banned) {
    throw new Error(
      `This account is banned: ${user.ban_reason || "Contact administrator for assistance."}`,
    );
  }

  await createLocalSession(user._id.toHexString());
  return true;
}

async function createLocalSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  await (await getDb()).collection<LocalSessionDoc>("local_sessions").insertOne({
    user_id: userId,
    token_hash: hashToken(token),
    created_at: now,
    expires_at: new Date(now.getTime() + SESSION_SECONDS * 1000),
  });
  try {
    setCookie(SESSION_COOKIE, token, cookieOptions());
  } catch {
    // ignore outside http request context
  }
}

export async function getLocalSession(): Promise<LocalAuthSession | null> {
  const token = getCookie(SESSION_COOKIE);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;

  const db = await getDb();
  const session = await db.collection<LocalSessionDoc>("local_sessions").findOne({
    token_hash: hashToken(token),
    expires_at: { $gt: new Date() },
  });
  if (!session) return null;

  let userId: ObjectId;
  try {
    userId = new ObjectId(session.user_id);
  } catch {
    return null;
  }
  const user = await db
    .collection<LocalUserDoc>("local_users")
    .findOne({ _id: userId }, { projection: { email: 1, banned: 1 } });
  if (!user || user.banned) return null;
  return { userId: user._id.toHexString(), email: user.email };
}

export async function signOutLocalAccount() {
  const token = getCookie(SESSION_COOKIE);
  try {
    if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) {
      await (await getDb()).collection<LocalSessionDoc>("local_sessions").deleteOne({
        token_hash: hashToken(token),
      });
    }
  } finally {
    deleteCookie(SESSION_COOKIE, { path: "/" });
  }
}
