/**
 * Bridge: inbound IM → ctx.agents → reply.
 * Pattern adapted from community dsh-im-hub (MIT); simplified for WSL kit.
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createAdapters } from "./adapters/index.js";
import { formatImOutbound } from "./im-plain.js";

export function splitText(text, maxLen) {
  const t = String(text || "");
  if (t.length <= maxLen) return [t];
  const chunks = [];
  let rest = t;
  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf("\n", maxLen);
    if (cut < maxLen / 2) cut = rest.lastIndexOf(" ", maxLen);
    if (cut < maxLen / 2) cut = maxLen;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

/** One dsh workspace per IM so the sidebar groups chats under each platform. */
export const IM_WORKSPACE_PRESETS = [
  ["feishu", "飞书"],
  ["wecom", "企微"],
  ["dingtalk", "钉钉"],
  ["qq", "QQ"],
  ["slack", "Slack"],
  ["discord", "Discord"],
  ["telegram", "Telegram"],
];

export function resolveImWorkspace(platform, { home = homedir(), base } = {}) {
  const root = base || join(home, ".dsh", "im-workspace");
  const slug = String(platform || "im")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "");
  const dir = join(root, slug || "im");
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }
  return dir;
}

/** Register IM directories so the desktop sidebar lists them without a manual add. */
export async function ensureImWorkspaces(registry, options = {}) {
  const out = [];
  for (const [platform, title] of IM_WORKSPACE_PRESETS) {
    const dir = resolveImWorkspace(platform, options);
    if (!registry?.create) {
      out.push({ platform, title, path: dir });
      continue;
    }
    const ws = await registry.create(dir, title);
    out.push({ platform, title, path: ws?.path || dir, id: ws?.id });
  }
  return out;
}

function assistantText(message) {
  if (!message?.content) return "";
  return message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
}

export class Bridge {
  constructor(ctx, config) {
    this.ctx = ctx;
    this.config = config;
    this.chats = new Map();
    this.pending = new Map();
    this.adapters = [];
    this.disposeListener = undefined;
    this.stopped = false;
    this.idleTimer = undefined;
  }

  async start() {
    this.disposeListener = this.ctx.on("session/event", (session, event) => {
      const collector = this.pending.get(session.id);
      if (!collector) return;
      if (event.type === "assistant/message") {
        const text = assistantText(event.data?.message);
        if (text) collector.parts.push(text);
      } else if (event.type === "turn/end") {
        collector.reason = event.data?.reason;
      }
    });

    const adapters = createAdapters({
      config: this.config,
      onMessage: (input) => this.handleMessage(input),
      logger: this.ctx.logger,
    });

    for (const adapter of adapters) {
      try {
        await adapter.start();
        this.adapters.push(adapter);
        console.info(`[dsh-wsl-im] ${adapter.name} started (${adapter.detail?.() || ""})`);
        this.ctx.logger?.info?.(`dsh-wsl-im: ${adapter.name} started`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[dsh-wsl-im] ${adapter.name} failed: ${msg}`);
        this.ctx.logger?.warn?.(`dsh-wsl-im: ${adapter.name} failed: ${msg}`);
      }
    }

    if (this.config.agent.idleTimeoutMs > 0) {
      this.idleTimer = setInterval(
        () => this.reapIdle(),
        Math.min(this.config.agent.idleTimeoutMs, 60_000),
      );
      this.idleTimer.unref?.();
    }
  }

  stop() {
    this.stopped = true;
    if (this.disposeListener) this.disposeListener();
    if (this.idleTimer) clearInterval(this.idleTimer);
    for (const a of this.adapters) {
      try {
        a.stop();
      } catch {
        /* ignore */
      }
    }
    this.adapters = [];
    for (const chat of this.chats.values()) chat.dispose().catch(() => {});
    this.chats.clear();
  }

  status() {
    return {
      ok: true,
      chats: this.chats.size,
      adapters: this.adapters.map((a) => ({
        name: a.name,
        state: typeof a.state === "function" ? a.state() : "up",
        detail: typeof a.detail === "function" ? a.detail() : undefined,
      })),
    };
  }

  async handleMessage(input) {
    const { platform, chatId, userId, text, images, files } = input;
    const imgCount = Array.isArray(images) ? images.length : 0;
    const fileCount = Array.isArray(files) ? files.length : 0;
    console.info(
      `[dsh-wsl-im] handleMessage ${platform} user=${userId} chat=${chatId} text=${String(text || "").slice(0, 40)} images=${imgCount} files=${fileCount}`,
    );
    if ((typeof text !== "string" || !text.trim()) && imgCount === 0 && fileCount === 0) return;
    if (!this.isAllowed(platform, userId)) {
      await input.reply("⛔ 无权限使用此助手。");
      return;
    }
    if (text?.startsWith("/") && imgCount === 0 && fileCount === 0) {
      await this.handleCommand(`${platform}:${chatId}`, text, input);
      return;
    }
    const key = `${platform}:${chatId}`;
    try {
      const chat = await this.getOrCreateChat(key);
      const run = chat.busy.then(() => this.runTurn(chat, input));
      chat.busy = run.catch((e) => {
        console.warn(`[dsh-wsl-im] turn error: ${e?.message || e}`);
      });
      await run;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[dsh-wsl-im] handleMessage failed: ${msg}`);
      try {
        await input.reply(`⚠️ dsh 处理失败: ${msg}`);
      } catch {
        /* ignore */
      }
    }
  }

  isAllowed(platform, userId) {
    const list = this.config.adapters[platform]?.allowedUserIds || [];
    return list.length === 0 || list.includes(String(userId));
  }

  async handleCommand(key, text, input) {
    const reply = (msg) => input.reply(formatImOutbound(msg, { platform: input.platform }));
    const [cmd] = text.split(/\s+/);
    if (cmd === "/help") {
      await reply("命令: /help /reset /status\n直接发消息即可与 dsh 对话。");
      return;
    }
    if (cmd === "/reset") {
      const chat = this.chats.get(key);
      if (chat) {
        this.chats.delete(key);
        await chat.dispose();
        await reply("🔄 已清空上下文。");
      } else await reply("当前没有活跃会话。");
      return;
    }
    if (cmd === "/status") {
      const s = this.status();
      await reply(
        `活跃会话 ${s.chats}\n适配器: ${s.adapters.map((a) => `${a.name}=${a.state}`).join(", ") || "无"}`,
      );
      return;
    }
    await reply(`未知命令 ${cmd}（/help）`);
  }

  async getOrCreateChat(key) {
    let chat = this.chats.get(key);
    if (!chat) {
      chat = await this.createChat(key);
      this.chats.set(key, chat);
    }
    chat.lastUsed = Date.now();
    return chat;
  }

  async createChat(key) {
    const ctx = this.ctx;
    const selection = ctx.get("agentDefaultModel")?.currentSelection?.();
    if (!selection) throw new Error("agentDefaultModel unavailable");
    const provider = this.config.agent.provider || selection.provider;
    const model = this.config.agent.model || selection.model;
    const cwd = this.resolveAgentCwd(key.split(":")[0]);
    const presetId = this.config.agent.preset || "standard";
    const permissionPreset = this.config.agent.permissionPreset || "danger-full-access";

    const { importDsh } = await import("./dsh-import.js");
    const { SessionId } = await importDsh("@deepseek-ai/dsh-session");
    const { installModelSelection } = await importDsh("@deepseek-ai/dsh-agent");

    // Match dsh-webhook / api-session: join a full agent preset (bash/read/fs).
    const presets = ctx.agentPresets;
    if (!presets?.mount) {
      throw new Error("agentPresets.mount unavailable — cannot compose standard tools for IM");
    }
    const resolvedPreset = await presets.resolve(presetId);
    if (presets.standingKeyFor) {
      await presets.standingKeyFor(resolvedPreset.id);
    }
    if (ctx.permissionPresets?.resolve && permissionPreset) {
      try {
        ctx.permissionPresets.resolve(permissionPreset);
      } catch (e) {
        console.warn(
          `[dsh-wsl-im] permissionPresets.resolve(${permissionPreset}) failed: ${e?.message || e}`,
        );
      }
    }

    const sessionId = SessionId(`wsl-im-${randomUUID()}`);
    console.info(
      `[dsh-wsl-im] createChat key=${key} preset=${resolvedPreset.id} cwd=${cwd} model=${provider}/${model}`,
    );
    const handle = await ctx.agents.create({
      sessionId,
      meta: { cwd, agentPreset: resolvedPreset.id },
      agentOptions: { provider, model },
      setup: async (agentCtx) => {
        installModelSelection(agentCtx, {
          current: { provider, model },
          assembled: undefined,
        });
        await presets.mount(agentCtx, resolvedPreset.id);
      },
    });
    if (ctx.permissionPresets?.set && permissionPreset) {
      try {
        ctx.permissionPresets.set(handle.agent.session, permissionPreset);
      } catch (e) {
        console.warn(
          `[dsh-wsl-im] permissionPresets.set(${permissionPreset}) failed: ${e?.message || e}`,
        );
      }
    }
    await handle.agent.whenIdle();
    return {
      key,
      agent: handle.agent,
      dispose: handle.dispose,
      busy: Promise.resolve(),
      lastUsed: Date.now(),
      cwd,
    };
  }

  resolveAgentCwd(platform) {
    return resolveImWorkspace(platform, { base: this.config.agent.cwd || undefined });
  }

  async runTurn(chat, input) {
    const { importDsh } = await import("./dsh-import.js");
    const { createUserMessage } = await importDsh("@deepseek-ai/dsh-llm");
    const sessionId = chat.agent.session.id;
    const collector = { parts: [], reason: undefined };
    this.pending.set(sessionId, collector);
    try {
      const prefix =
        this.config.agent.instructionPrefix ||
        "你是 IM 助手。对附件：优先用 bash/read 打开工作区或附件路径；PDF 可用 pdftotext。不要只说读不到就结束——先尝试工具。不要为读文件去 spawn Agent Team。";
      let textBody =
        input.text ||
        (input.images?.length
          ? "请查看图片。"
          : input.files?.length
            ? "请阅读附件。"
            : "");

      // Pre-extract PDF text when pdftotext is available (avoids tool-less dead ends).
      const files = Array.isArray(input.files) ? input.files : [];
      const extracted = [];
      for (const f of files) {
        try {
          const { extractLocalText } = await import("./extract-text.js");
          const t = extractLocalText(f.data, f.name);
          if (t) extracted.push({ name: f.name, text: t });
        } catch (e) {
          console.warn(`[dsh-wsl-im] extract skip: ${e?.message || e}`);
        }
      }
      if (extracted.length) {
        const blocks = extracted
          .map((e) => `----- 附件 ${e.name} 正文提取 -----\n${e.text}`)
          .join("\n\n");
        textBody = `${textBody}\n\n以下是本机从附件提取的文本，请据此总结要点：\n\n${blocks}`;
      }

      const content = prefix ? `${prefix}\n\n${textBody}` : textBody;
      const parts = [{ type: "text", text: content }];

      const store = this.ctx.attachments;
      const images = Array.isArray(input.images) ? input.images : [];
      if (images.length) {
        if (!store?.saveImages) {
          throw new Error("ctx.attachments.saveImages unavailable (need dsh-attachment-local)");
        }
        const refs = await store.saveImages(
          images.map((img, i) => ({
            data: img.data,
            mediaType: img.mediaType,
            name: img.name || `wecom-${i + 1}`,
          })),
        );
        for (const ref of refs) {
          parts.push({ type: "image", attachment: ref });
        }
        console.info(`[dsh-wsl-im] attached ${refs.length} image(s) to user message`);
      }

      if (files.length) {
        if (!store?.saveFile) {
          throw new Error("ctx.attachments.saveFile unavailable (need dsh-attachment-local)");
        }
        const inbox = join(chat.cwd || this.resolveAgentCwd("im"), "inbox");
        try {
          mkdirSync(inbox, { recursive: true });
        } catch {
          /* ignore */
        }
        for (const [i, f] of files.entries()) {
          const ref = await store.saveFile({
            data: f.data,
            name: f.name || `wecom-file-${i + 1}`,
          });
          parts.push({ type: "file", attachment: ref });
          // Also drop a copy in agent cwd so workspace-write sandbox can read it.
          try {
            const dest = join(inbox, f.name || `wecom-file-${i + 1}`);
            writeFileSync(dest, Buffer.from(f.data));
            console.info(`[dsh-wsl-im] copied attachment to ${dest}`);
          } catch (e) {
            console.warn(`[dsh-wsl-im] inbox copy failed: ${e?.message || e}`);
          }
        }
        console.info(`[dsh-wsl-im] attached ${files.length} file(s) to user message`);
      }

      chat.agent.followup(
        createUserMessage({
          content: parts,
          // dsh ≥0.1.7 session format v4 rejects retired kind:"plugin";
          // use producer-owned kind (see dsh-session-format-v3-to-v4 rewritePluginSource).
          source: { kind: "plugin:dsh-wsl-im", form: "relay" },
        }),
      );
      await chat.agent.whenIdle();
      await this.ctx.sessions.flush(chat.agent.session);
      const answer = formatImOutbound(collector.parts.join("\n\n").trim(), {
        platform: input.platform,
      });
      if (collector.reason?.kind === "error") {
        const err = collector.reason.error;
        await input.reply(
          formatImOutbound(`⚠️ ${err?.code || "error"}: ${err?.message || "unknown"}`, {
            platform: input.platform,
          }),
        );
        return;
      }
      if (!answer) {
        await input.reply(formatImOutbound("(无文本回复)", { platform: input.platform }));
        return;
      }
      for (const chunk of splitText(answer, this.config.agent.maxMessageLength)) {
        await input.reply(chunk);
      }
    } catch (err) {
      try {
        await input.reply(
          formatImOutbound(`❌ ${err instanceof Error ? err.message : String(err)}`, {
            platform: input.platform,
          }),
        );
      } catch {
        /* ignore */
      }
    } finally {
      this.pending.delete(sessionId);
    }
  }

  reapIdle() {
    const now = Date.now();
    const timeout = this.config.agent.idleTimeoutMs;
    for (const [key, chat] of this.chats) {
      if (now - chat.lastUsed > timeout) {
        this.chats.delete(key);
        chat.dispose().catch(() => {});
      }
    }
  }
}
