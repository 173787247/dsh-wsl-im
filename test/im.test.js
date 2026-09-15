import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveConfig } from "../lib/config.js";
import { splitText } from "../lib/bridge.js";
import { extractText } from "../lib/adapters/feishu.js";
import { extractWecomText } from "../lib/adapters/wecom.js";
import { extractDingText } from "../lib/adapters/dingtalk.js";

describe("resolveConfig", () => {
  it("maps OryxOS-style env names", () => {
    const cfg = resolveConfig(
      { adapters: { feishu: { enabled: false } } },
      {
        DSH_IM_FEISHU: "1",
        FEISHU_APP_ID: "cli_x",
        FEISHU_APP_SECRET: "sec",
        DSH_IM_WECOM: "true",
        WECOM_BOT_ID: "bot",
        WECOM_BOT_SECRET: "s",
      },
    );
    assert.equal(cfg.adapters.feishu.enabled, true);
    assert.equal(cfg.adapters.feishu.appId, "cli_x");
    assert.equal(cfg.adapters.wecom.botId, "bot");
  });
});

describe("splitText", () => {
  it("chunks long replies", () => {
    const parts = splitText("aa\nbb\ncc", 3);
    assert.ok(parts.length >= 2);
  });
});

describe("extractors", () => {
  it("feishu text", () => {
    assert.equal(
      extractText({
        event: {
          message: { message_type: "text", content: JSON.stringify({ text: "hi" }) },
        },
      }),
      "hi",
    );
  });
  it("wecom text", () => {
    assert.equal(extractWecomText({ msgtype: "text", text: { content: "yo" } }), "yo");
  });
  it("wecom media sniff jpeg", async () => {
    const { sniffImageMediaType } = await import("../lib/wecom-media.js");
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    assert.equal(sniffImageMediaType(jpeg), "image/jpeg");
  });
  it("dingtalk text", () => {
    assert.equal(extractDingText({ text: { content: "ding" } }), "ding");
  });
});
