/** Resolve outbound proxy agent for `ws` (Node fetch's NODE_USE_ENV_PROXY does not apply). */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export function resolveWsProxyAgent(env = process.env) {
  const proxy = String(
    env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || "",
  ).trim();
  if (!proxy) return undefined;
  try {
    const { HttpsProxyAgent } = require("https-proxy-agent");
    return new HttpsProxyAgent(proxy);
  } catch {
    return undefined;
  }
}

export function proxyLabel(env = process.env) {
  const proxy = String(
    env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || "",
  ).trim();
  return proxy ? "via-proxy" : "direct";
}
