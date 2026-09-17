import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveConfig } from "../lib/config.js";
import { splitText } from "../lib/bridge.js";
import { extractText, parseFeishuMessage, feishuGroupMentioned } from "../lib/adapters/feishu.js";
import { extractWecomText } from "../lib/adapters/wecom.js";
import { extractDingText, parseDingMessage } from "../lib/adapters/dingtalk.js";
import { parseQqDispatch } from "../lib/adapters/qq.js";

describe("resolveConfig", () => {
  it("maps vendor env names", () => {
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
  it("wecom voice asr", () => {
    assert.equal(
      extractWecomText({ msgtype: "voice", voice: { content: "明天开会吗" } }),
      "[语音转写] 明天开会吗",
    );
  });
  it("wecom media sniff jpeg", async () => {
    const { sniffImageMediaType } = await import("../lib/wecom-media.js");
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    assert.equal(sniffImageMediaType(jpeg), "image/jpeg");
  });
  it("filename sniff mp4 ftyp", async () => {
    const { sniffFileExtension } = await import("../lib/filename.js");
    const mp4 = Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    assert.equal(sniffFileExtension(mp4), ".mp4");
  });
  it("dingtalk text", () => {
    assert.equal(extractDingText({ text: { content: "ding" } }), "ding");
  });
  it("feishu image/file/audio/media keys", () => {
    assert.equal(
      parseFeishuMessage({
        message_type: "image",
        content: JSON.stringify({ image_key: "img_1" }),
      }).resource.key,
      "img_1",
    );
    assert.equal(
      parseFeishuMessage({
        message_type: "file",
        content: JSON.stringify({ file_key: "file_1", file_name: "a.pdf" }),
      }).resource.kind,
      "file",
    );
    assert.equal(
      parseFeishuMessage({
        message_type: "audio",
        content: JSON.stringify({ file_key: "file_a" }),
      }).resource.resourceType,
      "file",
    );
    assert.equal(
      parseFeishuMessage({
        message_type: "media",
        content: JSON.stringify({ file_key: "file_v", file_name: "clip.mp4" }),
      }).resource.kind,
      "video",
    );
    assert.equal(feishuGroupMentioned({ chat_type: "group", mentions: [] }), false);
    assert.equal(feishuGroupMentioned({ chat_type: "p2p" }), true);
  });
  it("dingtalk picture downloadCode and group @", () => {
    const pic = parseDingMessage({
      msgtype: "picture",
      conversationType: "1",
      content: { downloadCode: "dc1" },
    });
    assert.equal(pic.media.kind, "image");
    assert.equal(pic.media.downloadCode, "dc1");
    assert.equal(
      parseDingMessage({
        msgtype: "text",
        conversationType: "2",
        isInAtList: false,
        text: { content: "@bot hi" },
      }).skip,
      "group-not-at",
    );
    const file = parseDingMessage({
      msgtype: "file",
      content: { fileName: "report.pdf", downloadCode: "dc2" },
    });
    assert.equal(file.media.name, "report.pdf");
  });
  it("qq attachments: image, pdf, voice asr, video", () => {
    const img = parseQqDispatch("C2C_MESSAGE_CREATE", {
      content: "",
      attachments: [
        {
          url: "https://multimedia.nt.qq.com.cn/download?x=1",
          filename: "photo.jpg",
          content_type: "image/jpeg",
          width: 800,
          height: 600,
        },
      ],
    });
    assert.equal(img.items[0].kind, "image");
    const pdf = parseQqDispatch("C2C_MESSAGE_CREATE", {
      content: "看看文档",
      attachments: [
        {
          url: "https://multimedia.nt.qq.com.cn/download?f=pdf",
          filename: "report.pdf",
          content_type: "application/pdf",
        },
      ],
    });
    assert.equal(pdf.text, "看看文档");
    assert.equal(pdf.items[0].kind, "file");
    const voice = parseQqDispatch("C2C_MESSAGE_CREATE", {
      content: "",
      attachments: [
        {
          url: "https://multimedia.nt.qq.com.cn/silk",
          voice_wav_url: "https://qqbot.ugcimg.cn/download?wav=1",
          asr_refer_text: "今天天气不错",
          content_type: "voice",
        },
      ],
    });
    assert.equal(voice.asr, "今天天气不错");
    assert.equal(voice.items[0].url, "https://qqbot.ugcimg.cn/download?wav=1");
    assert.equal(voice.items[0].kind, "audio");
    assert.equal(voice.items[0].name, "voice.wav");
    const video = parseQqDispatch("GROUP_AT_MESSAGE_CREATE", {
      content: "<@!123> ",
      attachments: [
        {
          url: "https://multimedia.nt.qq.com.cn/v.mp4",
          filename: "clip.mp4",
          content_type: "video/mp4",
        },
      ],
    });
    assert.equal(video.text, "");
    assert.equal(video.items[0].kind, "video");
    assert.equal(parseQqDispatch("READY", { content: "x" }).skip, "event");
  });
});
