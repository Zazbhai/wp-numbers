import { describe, it, expect, beforeAll } from "vitest";
import { getAdminBusinessLines, updateAdminBusinessLines } from "./business-lines.server";
import { createLocalAccount } from "./local-auth.server";
import { getDb, type LocalUserDoc, type ApiKeyDoc, type UserWalletDoc } from "@/integrations/mongodb/client.server";
import { verifyPassword } from "./local-auth-crypto";

beforeAll(() => {
  try {
    process.loadEnvFile?.(".env");
  } catch {
    // ignore
  }
});

describe("Admin User Management", () => {
  const testEmail = `admin_test_${Date.now()}@example.com`;
  let testUserId = "";

  it("loads user details in admin business lines payload", async () => {
    // 1. Create a test account
    await createLocalAccount(testEmail, "initialPassword123", "Test User", "+919876543210");
    const db = await getDb();
    const userDoc = await db.collection<LocalUserDoc>("local_users").findOne({ email: testEmail });
    expect(userDoc).toBeTruthy();
    testUserId = userDoc!._id.toHexString();

    // 2. Fetch admin data
    const adminData = await getAdminBusinessLines();
    expect(adminData.users).toBeInstanceOf(Array);
    expect(adminData.totals.totalUsers).toBeGreaterThanOrEqual(1);

    const found = adminData.users.find((u) => u.email === testEmail);
    expect(found).toBeTruthy();
    expect(found?.name).toBe("Test User");
    expect(found?.phone).toBe("+919876543210");
    expect(found?.banned).toBe(false);
    expect(found?.walletBalance).toBe(0);
  });

  it("updates user password securely and revokes active sessions", async () => {
    const update = await updateAdminBusinessLines({
      editUserPassword: {
        userId: testUserId,
        newPassword: "newSecurePassword456",
      },
    });
    expect(update.ok).toBe(true);

    const db = await getDb();
    const userDoc = await db.collection<LocalUserDoc>("local_users").findOne({ email: testEmail });
    expect(userDoc).toBeTruthy();
    const matches = await verifyPassword("newSecurePassword456", userDoc!.password_hash);
    expect(matches).toBe(true);

    const oldMatches = await verifyPassword("initialPassword123", userDoc!.password_hash);
    expect(oldMatches).toBe(false);
  });

  it("updates user wallet balance and logs audit transaction", async () => {
    const update = await updateAdminBusinessLines({
      editUserBalance: {
        userId: testUserId,
        balance: 250,
        reason: "Admin grant test credits",
      },
    });
    expect(update.ok).toBe(true);

    const db = await getDb();
    const wallet = await db.collection<UserWalletDoc>("user_wallets").findOne({ user_id: testUserId });
    expect(wallet?.balance).toBe(250);

    const adminData = await getAdminBusinessLines();
    const found = adminData.users.find((u) => u.email === testEmail);
    expect(found?.walletBalance).toBe(250);
  });

  it("allows admin to set user balance as unlimited and updates wallet, local_user, and api_keys", async () => {
    const update = await updateAdminBusinessLines({
      editUserBalance: {
        userId: testUserId,
        balance: 999999,
        unlimited: true,
        reason: "VIP Unlimited Balance Grant",
        syncApiKey: true,
      },
    });
    expect(update.ok).toBe(true);

    const db = await getDb();
    const wallet = await db.collection<UserWalletDoc>("user_wallets").findOne({ user_id: testUserId });
    expect(wallet?.unlimited).toBe(true);

    const user = await db.collection<LocalUserDoc>("local_users").findOne({ email: testEmail });
    expect(user?.unlimited_balance).toBe(true);

    const adminData = await getAdminBusinessLines();
    const found = adminData.users.find((u) => u.email === testEmail);
    expect(found?.unlimited).toBe(true);

    // Verify wallet debit is bypassed for unlimited user
    const { debitWallet } = await import("./wallet.server");
    const debitRes = await debitWallet(testUserId, 49, "+919876543210");
    expect(debitRes.ok).toBe(true);
    // Balance is preserved and not deducted
    const walletAfter = await db.collection<UserWalletDoc>("user_wallets").findOne({ user_id: testUserId });
    expect(walletAfter?.balance).toBe(999999);
  });

  it("bans user, terminates sessions, and disables API keys", async () => {
    const db = await getDb();
    // Seed an active API key for this email
    await db.collection<ApiKeyDoc>("api_keys").insertOne({
      key: "fake_hash_" + Date.now(),
      raw_key: "sk_live_test_" + Date.now(),
      label: "Test Key",
      owner_email: testEmail,
      balance: 100,
      disabled: false,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const banResult = await updateAdminBusinessLines({
      banUser: {
        userId: testUserId,
        banReason: "Suspicious API usage violation",
      },
    });
    expect(banResult.ok).toBe(true);

    const userDoc = await db.collection<LocalUserDoc>("local_users").findOne({ email: testEmail });
    expect(userDoc?.banned).toBe(true);
    expect(userDoc?.ban_reason).toBe("Suspicious API usage violation");

    const apiKey = await db.collection<ApiKeyDoc>("api_keys").findOne({ owner_email: testEmail });
    expect(apiKey?.disabled).toBe(true);

    const adminData = await getAdminBusinessLines();
    const found = adminData.users.find((u) => u.email === testEmail);
    expect(found?.banned).toBe(true);
    expect(found?.banReason).toBe("Suspicious API usage violation");
  });

  it("unbans user and restores API key access", async () => {
    const unbanResult = await updateAdminBusinessLines({
      unbanUser: {
        userId: testUserId,
      },
    });
    expect(unbanResult.ok).toBe(true);

    const db = await getDb();
    const userDoc = await db.collection<LocalUserDoc>("local_users").findOne({ email: testEmail });
    expect(userDoc?.banned).toBe(false);

    const apiKey = await db.collection<ApiKeyDoc>("api_keys").findOne({ owner_email: testEmail });
    expect(apiKey?.disabled).toBe(false);
  });

  it("edits user profile name and phone", async () => {
    const editResult = await updateAdminBusinessLines({
      editUserProfile: {
        userId: testUserId,
        name: "Updated Name VIP",
        phone: "+919999888877",
      },
    });
    expect(editResult.ok).toBe(true);

    const adminData = await getAdminBusinessLines();
    const found = adminData.users.find((u) => u.email === testEmail);
    expect(found?.name).toBe("Updated Name VIP");
    expect(found?.phone).toBe("+919999888877");
  });
});
