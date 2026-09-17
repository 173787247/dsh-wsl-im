/**
 * dsh-wsl-im — IM ↔ dsh agent bridge.
 *
 * Runtime: platforms talk to this plugin; replies come from `ctx.agents`
 * Independent rewrite of the vendor wire protocols. OryxOS is not called
 * and its code is not included. See docs/PROVENANCE.md.
 */

export const name = "dsh-wsl-im";
export const inject = [
  "agentDefaultModel",
  "agents",
  "sessions",
  "loader",
  "tools",
  "systemPrompt",
  "attachments",
  "agentPresets",
  "permissionPresets",
  "workspaceRegistry",
];

import { Bridge, ensureImWorkspaces } from "./lib/bridge.js";
import { resolveConfig } from "./lib/config.js";

export function apply(ctx, raw = {}) {
  const config = resolveConfig(raw, process.env);
  let bridge;

  ctx.systemPrompt.section({
    name: "tool:im_status",
    order: 126,
    text:
      "dsh-wsl-im bridges Feishu / WeCom (aibot WS) / DingTalk Stream / QQ Gateway " +
      "directly into dsh agents. Wire behavior follows vendor docs; this plugin does not include OryxOS code. " +
      "Use im_status to see which adapters are up. Never paste bot secrets into chat.",
  });

  ctx.tools.register({
    name: "im_status",
    description: "Show dsh-wsl-im adapter status (Feishu / WeCom / DingTalk / QQ / mock).",
    parameters: { type: "object", additionalProperties: false, properties: {} },
    output: {
      schema: { type: "object", additionalProperties: true },
      render: (_a, v) => [{ type: "text", text: formatStatus(v) }],
    },
    timeoutMs: 5_000,
    isConcurrencySafe: () => true,
    async execute() {
      return bridge ? bridge.status() : { ok: false, error: "bridge not started" };
    },
    presentCall: () => ({ card: "generic", title: "IM status" }),
    presentResult: (_a, r) => ({
      card: "generic",
      title: r.isError ? "IM status failed" : "IM status",
      content: r.content,
    }),
  });

  const start = async () => {
    if (bridge) {
      bridge.stop();
      bridge = undefined;
    }
    if (!config.enabled) {
      console.info("[dsh-wsl-im] disabled");
      ctx.logger?.info?.("dsh-wsl-im: disabled");
      return;
    }
    try {
      const rows = await ensureImWorkspaces(ctx.workspaceRegistry, {
        base: config.agent.cwd || undefined,
      });
      console.info(
        `[dsh-wsl-im] workspaces ${rows.map((w) => `${w.title}:${w.path}`).join(" | ")}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[dsh-wsl-im] workspace register failed: ${msg}`);
    }
    const flags = Object.entries(config.adapters)
      .filter(([, v]) => v?.enabled)
      .map(([k]) => k);
    console.info(`[dsh-wsl-im] starting adapters=[${flags.join(",") || "none"}]`);
    bridge = new Bridge(ctx, config);
    bridge.start().catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[dsh-wsl-im] start failed: ${msg}`);
      ctx.logger?.warn?.(`dsh-wsl-im: start failed: ${msg}`);
    });
  };

  ctx.on("dispose", () => {
    if (bridge) bridge.stop();
  });
  start();
}

function formatStatus(v) {
  if (!v?.ok) return `im_status FAIL: ${v?.error || "unknown"}`;
  const lines = (v.adapters || []).map(
    (a) => `- ${a.name}: ${a.state}${a.detail ? ` (${a.detail})` : ""}`,
  );
  return [`im_status OK — chats=${v.chats ?? 0}`, ...lines].join("\n");
}
