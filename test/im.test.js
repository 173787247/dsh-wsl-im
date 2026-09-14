import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveOryxConfig,
  publicConfigStatus,
  unwrapData,
  invokeAgent,
  listChannels,
  ORYX_IM_TYPES,
} from "../lib/oryx.js";
import { formatInvoke, formatChannels, formatStatus } from "../lib/format.js";

describe("resolveOryxConfig", () => {
  it("defaults baseUrl and prefers config over env", () => {
    const cfg = resolveOryxConfig(
      { baseUrl: "http://127.0.0.1:9090/", apiKey: "k1", defaultAgent: "ops" },
      { ORYXOS_BASE_URL: "http://env", ORYXOS_API_KEY: "k2" },
    );
    assert.equal(cfg.baseUrl, "http://127.0.0.1:9090");
    assert.equal(cfg.apiKey, "k1");
    assert.equal(cfg.defaultAgent, "ops");
    assert.equal(publicConfigStatus(cfg).apiKeySet, true);
  });

  it("lists known IM types", () => {
    assert.ok(ORYX_IM_TYPES.includes("feishu"));
    assert.ok(ORYX_IM_TYPES.includes("douyin"));
    assert.ok(!ORYX_IM_TYPES.includes("taobao"));
  });
});

describe("unwrap + invoke", () => {
  it("unwraps ApiResponse envelope", () => {
    assert.deepEqual(unwrapData({ code: 0, data: { a: 1 } }), { a: 1 });
  });

  it("invokeAgent posts content and reads reply", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ code: 0, data: { content: "hi", traceId: "t1" } }),
      };
    };
    const cfg = resolveOryxConfig({ baseUrl: "http://127.0.0.1:8080", defaultAgent: "ops" });
    const r = await invokeAgent(cfg, { content: "ping" }, { fetchImpl });
    assert.equal(r.ok, true);
    assert.equal(r.reply, "hi");
    assert.equal(r.traceId, "t1");
    assert.match(calls[0].url, /\/api\/v1\/agents\/ops\/invoke$/);
    assert.equal(JSON.parse(calls[0].init.body).content, "ping");
  });

  it("listChannels maps fields", async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          code: 0,
          data: [{ name: "ops-feishu", type: "feishu", agent: "ops-agent", enabled: true }],
        }),
    });
    const cfg = resolveOryxConfig({});
    const r = await listChannels(cfg, { fetchImpl });
    assert.equal(r.ok, true);
    assert.equal(r.data[0].type, "feishu");
    assert.match(formatChannels(r), /ops-feishu/);
  });
});

describe("format", () => {
  it("formats invoke failure", () => {
    assert.match(formatInvoke({ ok: false, error: "down" }), /FAIL: down/);
  });
  it("formats status", () => {
    assert.match(
      formatStatus({
        ok: true,
        data: [{ name: "ops-telegram", state: "CONNECTED", type: "telegram" }],
      }),
      /CONNECTED/,
    );
  });
});
