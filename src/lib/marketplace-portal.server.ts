import http from "http";
import type { IncomingMessage, ServerResponse } from "http";

declare global {
  // eslint-disable-next-line no-var
  var __marketplacePortalServer: http.Server | undefined;
}

const MAIN_PORT = Number(process.env["PORT"] || 8080);
const MARKETPLACE_PORT = Number(process.env["MARKETPLACE_PORT"] || 3000);

// Paths that belong exclusively to the main checker / admin app (port 8080)
const MAIN_APP_ONLY_PATHS = ["/checker", "/link", "/numbers/admin", "/register"];

export function startMarketplacePortal(
  port = MARKETPLACE_PORT,
  targetPort = MAIN_PORT
): http.Server | null {
  // Reuse existing instance across Vite HMR reloads
  if (global.__marketplacePortalServer) {
    return global.__marketplacePortalServer;
  }

  // Prevent binding if same port
  if (port === targetPort) {
    return null;
  }

  const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    try {
      const rawUrl = req.url || "/";
      const parsedUrl = new URL(rawUrl, `http://localhost:${port}`);
      const pathname = parsedUrl.pathname;

      // If user on port 3000 tries to access checker or link, redirect to main port 8080
      for (const blocked of MAIN_APP_ONLY_PATHS) {
        if (pathname === blocked || pathname.startsWith(`${blocked}/`)) {
          res.writeHead(302, {
            Location: `http://localhost:${targetPort}${rawUrl}`,
          });
          res.end();
          return;
        }
      }

      // Root of port 3000 should serve the Marketplace page (/numbers)
      let targetPath = rawUrl;
      if (pathname === "/" || pathname === "") {
        targetPath = `/numbers${parsedUrl.search}`;
      }

      // Prepare proxy request to main Vite server
      const options: http.RequestOptions = {
        hostname: "127.0.0.1",
        port: targetPort,
        path: targetPath,
        method: req.method,
        headers: {
          ...req.headers,
          host: `localhost:${targetPort}`,
          "x-forwarded-host": `localhost:${port}`,
          "x-forwarded-port": String(port),
          "x-forwarded-proto": "http",
          "x-portal-origin": `http://localhost:${port}`,
        },
      };

      const proxyReq = http.request(options, (proxyRes) => {
        const headers = { ...proxyRes.headers };

        // Rewrite redirects if target points back to 8080/numbers -> redirect to 3000
        if (headers.location) {
          headers.location = headers.location.replace(`:${targetPort}/numbers`, `:${port}/numbers`);
          headers.location = headers.location.replace(`:${targetPort}/api-docs`, `:${port}/api-docs`);
          headers.location = headers.location.replace(`:${targetPort}/api/v1`, `:${port}/api/v1`);
        }

        res.writeHead(proxyRes.statusCode || 200, headers);
        proxyRes.pipe(res);
      });

      proxyReq.on("error", (err) => {
        if (!res.headersSent) {
          res.writeHead(502, { "Content-Type": "text/plain" });
          res.end(`Bad Gateway: Unable to reach main application on port ${targetPort} (${err.message})`);
        }
      });

      req.pipe(proxyReq);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end(`Internal Server Error: ${msg}`);
      }
    }
  });

  // Handle WebSocket upgrades for Vite HMR (so live reload works on port 3000 too)
  server.on("upgrade", (req, socket, head) => {
    const proxyReq = http.request({
      hostname: "127.0.0.1",
      port: targetPort,
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        host: `localhost:${targetPort}`,
      },
    });

    proxyReq.on("upgrade", (proxyRes, proxySocket) => {
      socket.write(
        `HTTP/${proxyRes.httpVersion} ${proxyRes.statusCode} ${proxyRes.statusMessage}\r\n` +
          Object.entries(proxyRes.headers)
            .map(([k, v]) => `${k}: ${v}`)
            .join("\r\n") +
          "\r\n\r\n"
      );
      proxySocket.pipe(socket);
      socket.pipe(proxySocket);
    });

    proxyReq.on("error", () => {
      socket.destroy();
    });

    proxyReq.end();
  });

  server.listen(port, () => {
    console.log(`\n========================================================`);
    console.log(`🚀 [Marketplace & Docs Portal] Running on http://localhost:${port}`);
    console.log(`   - Marketplace: http://localhost:${port}/ (or /numbers)`);
    console.log(`   - API Docs:    http://localhost:${port}/api-docs`);
    console.log(`   - API v1:      http://localhost:${port}/api/v1`);
    console.log(`========================================================\n`);
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.warn(`[MarketplacePortal] Port ${port} is already in use. Skipping secondary listener.`);
    } else {
      console.error("[MarketplacePortal Error]:", err);
    }
  });

  global.__marketplacePortalServer = server;
  return server;
}
