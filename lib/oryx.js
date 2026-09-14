/**
 * Resolve OryxOS HTTP client config (config wins, then env).
 * Never log or return apiKey.
 */
export function resolveOryxConfig(config = {}, env = process.env) {
  const baseUrl = String(
    config.baseUrl || env.ORYXOS_BASE_URL || "http://127.0.0.1:8080",
  )
    .trim()
    .replace(/\/+$/, "");
  const apiKey = String(config.apiKey || env.ORYXOS_API_KEY || "").trim();
  const defaultAgent = String(
    config.defaultAgent || env.ORYXOS_DEFAULT_AGENT || "",
  ).trim();
  const timeoutMs = positive(config.timeoutMs ?? env.ORYXOS_TIMEOUT_MS, 60_000);
  return { baseUrl, apiKey, defaultAgent, timeoutMs };
}

export function publicConfigStatus(cfg) {
  return {
    baseUrl: cfg.baseUrl,
    apiKeySet: Boolean(cfg.apiKey),
    defaultAgent: cfg.defaultAgent || null,
    timeoutMs: cfg.timeoutMs,
  };
}

function positive(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Supported inbound channel types (OryxOS factories as of 2026-09).
 * Taobao / PDD are specs-only — not listed.
 */
export const ORYX_IM_TYPES = Object.freeze([
  "feishu",
  "wecom",
  "dingtalk",
  "slack",
  "discord",
  "telegram",
  "whatsapp",
  "teams",
  "gchat",
  "mattermost",
  "matrix",
  "qq",
  "douyin",
  "weixin",
  "weixin_kf",
  "weixin_mp",
  "weixin_mini",
  "alipay",
]);

export async function oryxFetch(cfg, path, { method = "GET", body, fetchImpl = fetch } = {}) {
  const url = `${cfg.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cfg.apiKey) {
    headers.Authorization = `Bearer ${cfg.apiKey}`;
    headers["X-API-Key"] = cfg.apiKey;
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), cfg.timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ac.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return {
      ok: res.ok,
      status: res.status,
      json,
      text: text.slice(0, 4000),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Unwrap OryxOS ApiResponse envelope `{ code, data, message }` when present. */
export function unwrapData(json) {
  if (json && typeof json === "object" && "data" in json) return json.data;
  return json;
}

export async function health(cfg, opts) {
  const r = await oryxFetch(cfg, "/api/v1/health", opts);
  if (!r.ok && r.status === 404) {
    const alt = await oryxFetch(cfg, "/actuator/health", opts);
    return summarize(alt, "health");
  }
  return summarize(r, "health");
}

export async function listChannels(cfg, opts) {
  const r = await oryxFetch(cfg, "/api/v1/channels", opts);
  return summarize(r, "channels", (data) =>
    Array.isArray(data)
      ? data.map((c) => ({
          name: c?.name,
          type: c?.type,
          agent: c?.agent,
          enabled: c?.enabled,
        }))
      : data,
  );
}

export async function channelStatus(cfg, opts) {
  const r = await oryxFetch(cfg, "/api/v1/channels/status", opts);
  return summarize(r, "status", (data) =>
    Array.isArray(data)
      ? data.map((s) => ({
          name: s?.name,
          type: s?.type,
          state: s?.state ?? s?.status,
          agent: s?.agent,
          detail: s?.detail ?? s?.message ?? null,
        }))
      : data,
  );
}

export async function listNotifyChannels(cfg, opts) {
  const r = await oryxFetch(cfg, "/api/v1/notify-channels", opts);
  return summarize(r, "notify-channels", (data) =>
    Array.isArray(data)
      ? data.map((c) => ({
          name: c?.name,
          type: c?.type,
          description: c?.description ?? null,
        }))
      : data,
  );
}

export async function invokeAgent(cfg, { agent, content }, opts) {
  const name = String(agent || cfg.defaultAgent || "").trim();
  if (!name) {
    return {
      ok: false,
      error: "agent required (pass agent= or set defaultAgent / ORYXOS_DEFAULT_AGENT)",
    };
  }
  const text = String(content ?? "").trim();
  if (!text) return { ok: false, error: "content required" };

  const r = await oryxFetch(cfg, `/api/v1/agents/${encodeURIComponent(name)}/invoke`, {
    ...opts,
    method: "POST",
    body: { content: text },
  });
  const data = unwrapData(r.json);
  if (!r.ok) {
    return {
      ok: false,
      agent: name,
      status: r.status,
      error: pickError(r, data),
    };
  }
  const reply =
    typeof data === "string"
      ? data
      : data?.content ?? data?.reply ?? data?.message ?? JSON.stringify(data);
  return {
    ok: true,
    agent: name,
    reply: String(reply ?? ""),
    traceId: data?.traceId ?? data?.trace_id ?? null,
  };
}

function summarize(r, label, mapData) {
  if (!r.ok) {
    return { ok: false, label, status: r.status, error: pickError(r, unwrapData(r.json)) };
  }
  const data = unwrapData(r.json);
  return {
    ok: true,
    label,
    status: r.status,
    data: typeof mapData === "function" ? mapData(data) : data,
  };
}

function pickError(r, data) {
  if (data && typeof data === "object") {
    const m = data.message || data.error || data.msg;
    if (m) return String(m);
  }
  if (r.text) return r.text.slice(0, 500);
  return `HTTP ${r.status}`;
}
