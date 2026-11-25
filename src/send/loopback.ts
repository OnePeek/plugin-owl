// The OAuth loopback listener (RFC 8252): one request on 127.0.0.1 at a random port, state checked, then closed.
import { execFile } from "node:child_process";
import { createServer } from "node:http";

export interface Callback {
  code?: string;
  error?: string;
}

export function openBrowser(url: string): void {
  const [cmd, args]: [string, string[]] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]] : ["xdg-open", [url]];
  execFile(cmd, args, { timeout: 10_000 }, () => undefined);
}

export function waitForCallback(port: number, state: string, timeoutMs = 300_000): Promise<Callback> {
  return new Promise((resolve) => {
    const srv = createServer((req, res) => {
      const u = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      if (req.method !== "GET" || u.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const ok = u.searchParams.get("state") === state;
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }).end(ok ? "OnePeek is connected. You can close this tab." : "Sign-in did not match. You can close this tab.");
      finish(ok ? { ...(u.searchParams.get("code") ? { code: u.searchParams.get("code") as string } : {}), ...(u.searchParams.get("error") ? { error: u.searchParams.get("error") as string } : {}) } : { error: "state_mismatch" });
    });
    const timer = setTimeout(() => finish({ error: "timeout" }), timeoutMs);
    function finish(c: Callback): void {
      clearTimeout(timer);
      srv.close();
      resolve(c);
    }
    srv.on("error", () => finish({ error: "listen_failed" }));
    srv.listen(port, "127.0.0.1");
  });
}
