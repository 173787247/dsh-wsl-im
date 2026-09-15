/**
 * Bridge: inbound IM → ctx.agents → reply.
 * Pattern adapted from community dsh-im-hub (MIT); simplified for WSL kit.
 */

import { randomUUID } from "node:crypto";
import { createAdapters } from "./adapters/index.js";

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
        this.ctx.logger?.info?.(`dsh-wsl-im: ${adapter.name} started`);
      } catch (err) {
        this.ctx.logger?.warn?.(
          `dsh-wsl-im: ${adapter.name} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
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
    const { platform, chatId, userId, text } = input;
    if (typeof text !== "string" || !text.trim()) return;
    if (!this.isAllowed(platform, userId)) {
      await input.reply("⛔ 无权限使用此助手。");
      return;
    }
    if (text.startsWith("/")) {
      await this.handleCommand(`${platform}:${chatId}`, text, input);
      return;
    }
    const key = `${platform}:${chatId}`;
    const chat = await this.getOrCreateChat(key);
    const run = chat.busy.then(() => this.runTurn(chat, input));
    chat.busy = run.catch(() => {});
    await run;
  }

  isAllowed(platform, userId) {
    const list = this.config.adapters[platform]?.allowedUserIds || [];
    return list.length === 0 || list.includes(String(userId));
  }

  async handleCommand(key, text, input) {
    const [cmd] = text.split(/\s+/);
    if (cmd === "/help") {
      await input.reply("命令: /help /reset /status\n直接发消息即可与 dsh 对话。");
      return;
    }
    if (cmd === "/reset") {
      const chat = this.chats.get(key);
      if (chat) {
        this.chats.delete(key);
        await chat.dispose();
        await input.reply("🔄 已清空上下文。");
      } else await input.reply("当前没有活跃会话。");
      return;
    }
    if (cmd === "/status") {
      const s = this.status();
      await input.reply(
        `活跃会话 ${s.chats}\n适配器: ${s.adapters.map((a) => `${a.name}=${a.state}`).join(", ") || "无"}`,
      );
      return;
    }
    await input.reply(`未知命令 ${cmd}（/help）`);
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
    const cwd = this.config.agent.cwd || process.cwd();

    // Dynamic import — available inside dsh profile node_modules
    const { SessionId } = await import("@deepseek-ai/dsh-session");
    const { installModelSelection } = await import("@deepseek-ai/dsh-agent");

    const sessionId = SessionId(`wsl-im-${randomUUID()}`);
    const handle = await ctx.agents.create({
      sessionId,
      meta: { cwd },
      agentOptions: { provider, model },
      setup: (agentCtx) => {
        installModelSelection(agentCtx, {
          current: { provider, model },
          assembled: undefined,
        });
      },
    });
    await handle.agent.whenIdle();
    return {
      key,
      agent: handle.agent,
      dispose: handle.dispose,
      busy: Promise.resolve(),
      lastUsed: Date.now(),
    };
  }

  async runTurn(chat, input) {
    const { createUserMessage } = await import("@deepseek-ai/dsh-llm");
    const sessionId = chat.agent.session.id;
    const collector = { parts: [], reason: undefined };
    this.pending.set(sessionId, collector);
    try {
      const prefix = this.config.agent.instructionPrefix;
      const content = prefix ? `${prefix}\n\n${input.text}` : input.text;
      chat.agent.followup(
        createUserMessage({
          content: [{ type: "text", text: content }],
          source: { kind: "plugin", plugin: "dsh-wsl-im", form: "relay" },
        }),
      );
      await chat.agent.whenIdle();
      await this.ctx.sessions.flush(chat.agent.session);
      const answer = collector.parts.join("\n\n").trim();
      if (collector.reason?.kind === "error") {
        const err = collector.reason.error;
        await input.reply(`⚠️ ${err?.code || "error"}: ${err?.message || "unknown"}`);
        return;
      }
      if (!answer) {
        await input.reply("(无文本回复)");
        return;
      }
      for (const chunk of splitText(answer, this.config.agent.maxMessageLength)) {
        await input.reply(chunk);
      }
    } catch (err) {
      try {
        await input.reply(`❌ ${err instanceof Error ? err.message : String(err)}`);
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
