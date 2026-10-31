import { extname, normalize, resolve } from "node:path";
import server from "../dist/server/server.js";

const clientRoot = resolve(import.meta.dir, "../dist/client");
const mimeTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function staticPath(request: Request): string | null {
  if (request.method !== "GET" && request.method !== "HEAD") return null;

  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(request.url).pathname);
  } catch {
    return null;
  }

  const relative = normalize(pathname).replace(/^[/\\]+/, "");
  const candidate = resolve(clientRoot, relative);
  return candidate.startsWith(`${clientRoot}/`) || candidate === clientRoot ? candidate : null;
}

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const context = {
  waitUntil(promise: Promise<unknown>) {
    void promise.catch((error) => console.error("Background task failed", error));
  },
};

Bun.serve({
  hostname: process.env.HOST ?? "127.0.0.1",
  port,
  async fetch(request) {
    const path = staticPath(request);
    if (path) {
      const file = Bun.file(path);
      if (await file.exists()) {
        return new Response(request.method === "HEAD" ? null : file, {
          headers: {
            "content-type": mimeTypes[extname(path).toLowerCase()] ?? "application/octet-stream",
            "cache-control": path.includes("/assets/")
              ? "public, max-age=31536000, immutable"
              : "public, max-age=300",
            "x-content-type-options": "nosniff",
          },
        });
      }
    }

    return server.fetch(request, process.env, context);
  },
});

console.info(`KALLISTIS Genesis listening on ${process.env.HOST ?? "127.0.0.1"}:${port}`);
