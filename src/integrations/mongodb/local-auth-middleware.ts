import { createMiddleware } from "@tanstack/react-start";
import { getLocalSession } from "@/lib/local-auth.server";

export const requireLocalAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const session = await getLocalSession();
  if (!session) throw new Error("Unauthorized: Sign in required");

  return next({
    context: {
      userId: session.userId,
      email: session.email,
    },
  });
});
