import { createMiddleware } from "@tanstack/react-start";

export const requireAdminAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const { isRequestAdmin } = await import("./admin-auth.server");
  if (!isRequestAdmin()) {
    throw new Error("Forbidden: Administrator access required");
  }
  return next({
    context: {
      isAdmin: true,
    },
  });
});
