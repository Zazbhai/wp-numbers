import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const credentialsSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(10).max(128),
});

export const signUpLocal = createServerFn({ method: "POST" })
  .validator((data: unknown) => credentialsSchema.parse(data))
  .handler(async ({ data }) => {
    try {
      const { createLocalAccount } = await import("./local-auth.server");
      await createLocalAccount(data.email, data.password);
      return { ok: true as const };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === 11000) {
        return { ok: false as const, error: "An account with this email already exists." };
      }
      console.error("[signUpLocal error]:", error);
      return { ok: false as const, error: "Could not create your account. Try again." };
    }
  });

export const signInLocal = createServerFn({ method: "POST" })
  .validator((data: unknown) => credentialsSchema.parse(data))
  .handler(async ({ data }) => {
    try {
      const { signInLocalAccount } = await import("./local-auth.server");
      const ok = await signInLocalAccount(data.email, data.password);
      return ok
        ? { ok: true as const }
        : { ok: false as const, error: "Email or password is incorrect." };
    } catch (error) {
      console.error("[signInLocal error]:", error);
      return { ok: false as const, error: "Unable to sign in. Try again." };
    }
  });

export const signOutLocal = createServerFn({ method: "POST" }).handler(async () => {
  const { signOutLocalAccount } = await import("./local-auth.server");
  await signOutLocalAccount();
  return { ok: true as const };
});

export const getLocalAuthSession = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { getLocalSession } = await import("./local-auth.server");
    return await getLocalSession();
  } catch (error) {
    console.error("[getLocalAuthSession error]:", error);
    return null;
  }
});
