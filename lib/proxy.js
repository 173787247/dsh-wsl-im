/**
 * Outbound proxy helpers for IM adapters.
 * Node's global `fetch` does not reliably honor HTTPS_PROXY on all Node lines,
 * and `ws` never does — so WS + HTTP both go through https-proxy-agent when set.
 */

import http from "node:http";
import https from "node:https";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export function resolveProxyUrl(env = process.env) {
  return String(
    env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || "",
  ).trim();
}

export function resolveWsProxyAgent(env = process.env) {
  const proxy = resolveProxyUrl(env);
  if (!proxy) return undefined;
  try {
    const { HttpsProxyAgent } = require("https-proxy-agent");
    return new HttpsProxyAgent(proxy);
  } catch {
    return undefined;
  }
}

export function proxyLabel(env = process.env) {
  return resolveProxyUrl(env) ? "via-proxy" : "direct";
}

/**
 * Same surface as global `fetch`, but tunnels via HTTPS_PROXY when configured.
 * Without a proxy (or if the agent package is missing), falls back to global fetch.
 *
 * @param {string | URL} input
 * @param {RequestInit} [init]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<Response>}
 */
export async function proxiedFetch(input, init = {}, env = process.env) {
  const agent = resolveWsProxyAgent(env);
  if (!agent) return fetch(input, init);

  const url = String(input);
  const method = String(init.method || "GET").toUpperCase();
  const headers = flatHeaders(init.headers);
  const body =
    init.body === undefined || init.body === null
      ? undefined
      : Buffer.isBuffer(init.body)
        ? init.body
        : typeof init.body === "string"
          ? Buffer.from(init.body)
          : Buffer.from(String(init.body));

  if (body && !headers["content-length"] && !headers["Content-Length"]) {
    headers["Content-Length"] = String(body.length);
  }

  const signal = init.signal;
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error("aborted");
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    const ok = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    let target;
    try {
      target = new URL(url);
    } catch (e) {
      fail(e);
      return;
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      fail(new Error(`proxiedFetch: unsupported protocol ${target.protocol}`));
      return;
    }

    const lib = target.protocol === "http:" ? http : https;
    const req = lib.request(
      url,
      {
        method,
        headers,
        agent,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          ok(
            new Response(buf, {
              status: res.statusCode || 0,
              statusText: res.statusMessage || "",
              headers: res.headers,
            }),
          );
        });
        res.on("error", fail);
      },
    );

    const onAbort = () => {
      req.destroy();
      fail(signal?.reason instanceof Error ? signal.reason : new Error("aborted"));
    };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });

    req.on("error", fail);
    req.on("timeout", () => {
      req.destroy();
      fail(new Error("proxiedFetch: timeout"));
    });
    if (body) req.write(body);
    req.end();
  });
}

function flatHeaders(headers) {
  const out = {};
  if (!headers) return out;
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    headers.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (Array.isArray(headers)) {
    for (const [key, value] of headers) out[String(key)] = String(value);
    return out;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined || value === null) continue;
    out[key] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  return out;
}
