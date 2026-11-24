import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createLocalAccount, sessionCookieHeader } from "@/lib/local-auth.server";

const credentialsSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(10).max(128),
});

export const Route = createFileRoute("/api/auth/signup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = credentialsSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ ok: false, error: "Email and password are invalid." }, { status: 400 });

        try {
          const token = await createLocalAccount(parsed.data.email, parsed.data.password);
          return Response.json(
            { ok: true },
            { headers: { "Set-Cookie": sessionCookieHeader(token), "Cache-Control": "no-store" } },
          );
        } catch (error) {
          if (error && typeof error === "object" && "code" in error && error.code === 11000) {
            return Response.json({ ok: false, error: "An account with this email already exists." }, { status: 409 });
          }
          console.error("[auth/signup error]:", error);
          return Response.json({ ok: false, error: "Could not create your account. Try again." }, { status: 500 });
        }
      },
    },
  },
});
