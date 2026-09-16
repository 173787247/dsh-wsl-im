/**
 * WeCom 智能机器人 long connection.
 * Protocol reference: OryxOS WeComWsClient / WeComMessageSender
 *   wss://openws.work.weixin.qq.com
 *   cmd: aibot_subscribe → aibot_msg_callback → aibot_send_msg
 */

import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { proxyLabel, resolveWsProxyAgent } from "../proxy.js";

const WS_URL = "wss://openws.work.weixin.qq.com";

export function createWecomAdapter({ botId, secret, onMessage, logger }) {
  let ws;
  let heartbeat;
  let state = "down";
  let stopped = false;
  let reconnectTimer;

  const send = (frame) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error("wecom: not connected");
    ws.send(JSON.stringify(frame));
  };

  const connect = () =>
    new Promise((resolve, reject) => {
      const agent = resolveWsProxyAgent();
      if (!agent && (process.env.HTTPS_PROXY || process.env.HTTP_PROXY)) {
        logger?.warn?.(
          "wecom: HTTPS_PROXY set but https-proxy-agent missing; WS will try direct (often times out)",
        );
      }
      ws = new WebSocket(WS_URL, agent ? { agent } : undefined);
      let subscribed = false;

      const fail = (err) => {
        cleanup();
        reject(err);
      };

      const onOpen = () => {
        send({
          cmd: "aibot_subscribe",
          headers: { req_id: randomUUID() },
          body: { bot_id: botId, secret },
        });
      };

      const onMessageFrame = async (raw) => {
        let frame;
        try {
          frame = JSON.parse(String(raw));
        } catch {
          console.warn("[dsh-wsl-im/wecom] non-json frame", String(raw).slice(0, 120));
          return;
        }
        const cmd = frame.cmd || frame.body?.cmd;
        // Debug inbound (no secrets): help smoke-test when UI shows no reply
        if (cmd && cmd !== "pong") {
          const body = frame.body || {};
          console.info(
            `[dsh-wsl-im/wecom] frame cmd=${cmd} errcode=${frame.errcode ?? ""} msgtype=${body.msgtype || ""} chattype=${body.chattype || ""} textLen=${body.text?.content ? String(body.text.content).length : 0}`,
          );
        }
        if (cmd === "aibot_subscribe" || frame.errcode !== undefined) {
          if (frame.errcode === 0 || frame.body?.errcode === 0 || subscribed) {
            if (!subscribed && (frame.cmd === "aibot_subscribe" || frame.errcode === 0)) {
              subscribed = true;
              state = "up";
              startHeartbeat();
              resolve();
            }
          } else if (frame.errcode && frame.errcode !== 0) {
            fail(new Error(`wecom subscribe failed: ${frame.errcode} ${frame.errmsg || ""}`));
            return;
          }
        }
        if (cmd === "pong") return;
        if (cmd === "aibot_msg_callback" || frame.body?.msgtype) {
          const body = frame.body || frame;
          let text = extractWecomText(body);
          const images = [];
          const files = [];
          if (body.msgtype === "image" && body.image) {
            try {
              const { resolveWecomImage } = await import("../wecom-media.js");
              const img = await resolveWecomImage(body.image);
              images.push(img);
              console.info(
                `[dsh-wsl-im/wecom] image resolved type=${img.mediaType} bytes=${img.data.byteLength}`,
              );
            } catch (e) {
              console.warn(`[dsh-wsl-im/wecom] image resolve failed: ${e?.message || e}`);
              await replyQuick(
                body,
                `⚠️ 图片下载/解密失败: ${e instanceof Error ? e.message : String(e)}`,
              );
              return;
            }
            if (!text) text = "请查看这张图片并简要描述内容。";
          }
          if (body.msgtype === "file" && body.file) {
            try {
              const { resolveWecomFile } = await import("../wecom-media.js");
              const f = await resolveWecomFile(body.file);
              files.push(f);
              console.info(
                `[dsh-wsl-im/wecom] file resolved name=${f.name} bytes=${f.data.byteLength}`,
              );
            } catch (e) {
              console.warn(`[dsh-wsl-im/wecom] file resolve failed: ${e?.message || e}`);
              await replyQuick(
                body,
                `⚠️ 文件下载/解密失败: ${e instanceof Error ? e.message : String(e)}`,
              );
              return;
            }
            if (!text) {
              text = `请阅读附件「${files[0].name}」并总结要点。`;
            }
          }
          if (body.msgtype === "voice" && body.voice) {
            const asr = String(body.voice.content || "").trim();
            console.info(
              `[dsh-wsl-im/wecom] voice asrLen=${asr.length} hasUrl=${Boolean(body.voice.url)}`,
            );
            if (asr) {
              text = `[语音转写] ${asr}`;
            } else if (body.voice.url) {
              try {
                const { resolveWecomVoice } = await import("../wecom-media.js");
                const f = await resolveWecomVoice(body.voice);
                files.push(f);
                console.info(
                  `[dsh-wsl-im/wecom] voice saved name=${f.name} bytes=${f.data.byteLength}`,
                );
                text =
                  `用户发来语音，平台转写为空，音频已落到工作区「${f.name}」。` +
                  "本机没有 Whisper，无法再转写。请用户改发文字。";
              } catch (e) {
                console.warn(`[dsh-wsl-im/wecom] voice resolve failed: ${e?.message || e}`);
                await replyQuick(
                  body,
                  `⚠️ 语音下载/解密失败: ${e instanceof Error ? e.message : String(e)}`,
                );
                return;
              }
            } else {
              await replyQuick(body, "企微仅单聊提供 ASR；空转写请改发文字");
              return;
            }
          }
          if (body.msgtype === "video" && body.video) {
            try {
              const { resolveWecomVideo } = await import("../wecom-media.js");
              const f = await resolveWecomVideo(body.video);
              files.push(f);
              console.info(
                `[dsh-wsl-im/wecom] video resolved name=${f.name} bytes=${f.data.byteLength}`,
              );
            } catch (e) {
              console.warn(`[dsh-wsl-im/wecom] video resolve failed: ${e?.message || e}`);
              await replyQuick(
                body,
                `⚠️ 视频下载/解密失败: ${e instanceof Error ? e.message : String(e)}`,
              );
              return;
            }
            if (!text) {
              text =
                `用户发来视频附件「${files[0].name}」。` +
                "当前不会自动理解画面或抽音轨转写；请确认已落盘到工作区 inbox，并请用户补充文字说明或改发截图/文字。";
            }
          }
          if (!text && images.length === 0 && files.length === 0) {
            console.warn(
              `[dsh-wsl-im/wecom] callback without payload msgtype=${body.msgtype || "?"} keys=${Object.keys(body).join(",")}`,
            );
            return;
          }
          const chatType = body.chattype || body.chat_type;
          const userId = body.from?.userid || body.userid || "unknown";
          const chatId =
            chatType === "single" || chatType === 1 || chatType === "1"
              ? userId
              : body.chatid || body.chat_id || userId || body.msgid || "wecom";
          const msgId = body.msgid || body.msg_id || randomUUID();
          console.info(
            `[dsh-wsl-im/wecom] inbound user=${userId} chat=${chatId} textLen=${(text || "").length} images=${images.length} files=${files.length}`,
          );
          await onMessage({
            platform: "wecom",
            chatId: String(chatId),
            userId: String(userId),
            text: text || "",
            images,
            files,
            messageId: String(msgId),
            reply: makeReply(chatId, chatType),
          });
        }
      };

      const makeReply = (chatId, chatType) => async (replyText) => {
        const bodyOut = {
          chatid: String(chatId),
          msgtype: "markdown",
          markdown: { content: replyText },
        };
        if (chatType === "group" || chatType === 2 || chatType === "2") {
          bodyOut.chat_type = 2;
        } else if (chatType === "single" || chatType === 1 || chatType === "1") {
          bodyOut.chat_type = 1;
        }
        send({
          cmd: "aibot_send_msg",
          headers: { req_id: randomUUID() },
          body: bodyOut,
        });
        console.info(`[dsh-wsl-im/wecom] reply sent chat=${chatId} len=${replyText.length}`);
      };

      const replyQuick = async (body, text) => {
        const chatType = body.chattype || body.chat_type;
        const userId = body.from?.userid || body.userid || "unknown";
        const chatId =
          chatType === "single" || chatType === 1 || chatType === "1"
            ? userId
            : body.chatid || body.chat_id || userId || "wecom";
        await makeReply(chatId, chatType)(text);
      };

      ws.once("open", onOpen);
      ws.on("message", (data) => {
        onMessageFrame(data).catch((e) => logger?.warn?.(`wecom handler: ${e.message}`));
      });
      ws.once("error", fail);
      ws.on("close", (code, reason) => {
        state = "down";
        console.warn(`[dsh-wsl-im/wecom] ws close code=${code} reason=${String(reason || "")}`);
        stopHeartbeat();
        if (!stopped) scheduleReconnect();
      });

      // Subscribe ACK timeout
      setTimeout(() => {
        if (!subscribed) fail(new Error("wecom: subscribe timeout"));
      }, 20_000);
    });

  function startHeartbeat() {
    stopHeartbeat();
    heartbeat = setInterval(() => {
      try {
        send({ cmd: "ping", headers: { req_id: randomUUID() } });
      } catch {
        /* ignore */
      }
    }, 30_000);
    heartbeat.unref?.();
  }
  function stopHeartbeat() {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = undefined;
  }
  function cleanup() {
    stopHeartbeat();
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
  }
  function scheduleReconnect() {
    if (reconnectTimer || stopped) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      connect().catch((e) => logger?.warn?.(`wecom reconnect: ${e.message}`));
    }, 5_000);
  }

  return {
    name: "wecom",
    state: () => state,
    detail: () => `${WS_URL} (${proxyLabel()})`,
    async start() {
      stopped = false;
      await connect();
      logger?.info?.(
        `dsh-wsl-im wecom aibot WS subscribed (OryxOS-aligned, ${proxyLabel()})`,
      );
    },
    stop() {
      stopped = true;
      state = "down";
      if (reconnectTimer) clearTimeout(reconnectTimer);
      cleanup();
    },
  };
}

export function extractWecomText(body) {
  if (!body) return undefined;
  if (body.msgtype === "text" && body.text?.content) return String(body.text.content).trim();
  if (body.msgtype === "markdown" && body.markdown?.content)
    return String(body.markdown.content).trim();
  if (body.msgtype === "voice" && body.voice?.content) {
    const asr = String(body.voice.content).trim();
    if (asr) return `[语音转写] ${asr}`;
  }
  if (typeof body.content === "string") return body.content.trim();
  return undefined;
}

export { resolveWecomImage, resolveWecomFile, sniffImageMediaType, decryptWecomMedia } from "../wecom-media.js";

