import { createServer } from "node:http";

/** Local HTTP mock for smoke tests without real IM credentials. */
export function createMockAdapter({ port = 18999, onMessage, logger }) {
  let server;
  let state = "down";

  return {
    name: "mock",
    state: () => state,
    detail: () => (server ? `http://127.0.0.1:${port}/mock` : undefined),
    async start() {
      server = createServer(async (req, res) => {
        if (req.method === "GET" && req.url?.startsWith("/health")) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        if (req.method === "POST" && req.url?.startsWith("/mock")) {
          const body = await readBody(req);
          let json = {};
          try {
            json = JSON.parse(body || "{}");
          } catch {
            res.writeHead(400);
            res.end("bad json");
            return;
          }
          const replies = [];
          await onMessage({
            platform: "mock",
            chatId: String(json.chatId || "mock-chat"),
            userId: String(json.userId || "mock-user"),
            text: String(json.text || ""),
            messageId: String(json.messageId || Date.now()),
            reply: async (text) => {
              replies.push(text);
            },
          });
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true, replies }));
          return;
        }
        res.writeHead(404);
        res.end("not found");
      });
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", resolve);
      });
      state = "up";
      logger?.info?.(`dsh-wsl-im mock listening on 127.0.0.1:${port}`);
    },
    stop() {
      state = "down";
      server?.close();
      server = undefined;
    },
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
