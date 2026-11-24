import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { sessionCookieHeader, signInLocalAccount } from "@/lib/local-auth.server";

const credentialsSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(10).max(128),
});

export const Route = createFileRoute("/api/auth/login")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = credentialsSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ ok: false, error: "Invalid email or password." }, { status: 400 });

        try {
          const token = await signInLocalAccount(parsed.data.email, parsed.data.password);
          if (!token) return Response.json({ ok: false, error: "Email or password is incorrect." }, { status: 401 });
          return Response.json(
            { ok: true },
            { headers: { "Set-Cookie": sessionCookieHeader(token), "Cache-Control": "no-store" } },
          );
        } catch (error) {
          console.error("[auth/login error]:", error);
          const message = error instanceof Error && error.message.startsWith("This account is banned:")
            ? error.message
            : "Unable to sign in. Try again.";
          return Response.json({ ok: false, error: message }, { status: 500 });
        }
      },
    },
  },
});
