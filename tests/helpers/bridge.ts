// Put the in-process FakeServer behind a real HTTP listener on 127.0.0.1, so separate helper PROCESSES can talk to it
// with the real `fetch` (the five-parallel test runs five real helpers at once).
import { createServer } from "node:http";
import type { FakeServer } from "./fake.js";

export async function serveFake(fake: FakeServer): Promise<{ base: string; close(): Promise<void> }> {
  const srv = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const url = `http://127.0.0.1:${(srv.address() as { port: number }).port}${req.url ?? "/"}`;
      const headers: Record<string, string> = {};
      if (typeof req.headers["dpop"] === "string") headers["DPoP"] = req.headers["dpop"];
      if (typeof req.headers["authorization"] === "string") headers["Authorization"] = req.headers["authorization"];
      fake
        .fetch(url, { method: req.method ?? "GET", headers, body: Buffer.concat(chunks).toString("utf8"), redirect: "error", signal: AbortSignal.timeout(20_000) })
        .then(async (r) => {
          const h: Record<string, string> = { "Content-Type": "application/json" };
          for (const n of ["DPoP-Nonce", "Retry-After"]) {
            const v = r.headers.get(n);
            if (v) h[n] = v;
          }
          res.writeHead(r.status, h);
          res.end(await r.text());
        })
        .catch(() => res.destroy());
    });
  });
  await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));
  return { base: `http://127.0.0.1:${(srv.address() as { port: number }).port}`, close: () => new Promise<void>((resolve) => srv.close(() => resolve())) };
}
