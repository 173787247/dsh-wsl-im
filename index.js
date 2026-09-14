import {
  resolveOryxConfig,
  publicConfigStatus,
  ORYX_IM_TYPES,
  health,
  listChannels,
  channelStatus,
  listNotifyChannels,
  invokeAgent,
} from "./lib/oryx.js";
import {
  formatHealth,
  formatChannels,
  formatStatus,
  formatNotify,
  formatInvoke,
} from "./lib/format.js";

export const name = "dsh-wsl-im";
export const inject = ["tools", "systemPrompt"];

export function apply(ctx, config = {}) {
  const cfg = resolveOryxConfig(config);
  const pub = publicConfigStatus(cfg);

  ctx.systemPrompt.section({
    name: "tool:oryx_im",
    order: 125,
    text: [
      "OryxOS is the IM gateway for this suite — do NOT call Feishu/Telegram/etc. SDKs directly.",
      "Use oryx_im_status / oryx_im_list to see inbound channels (types: " +
        ORYX_IM_TYPES.join(", ") +
        ").",
      "Use oryx_invoke to talk to a local OryxOS agent bound in channels.yaml.",
      "Use oryx_notify_list for outbound notify channel defs (proactive push is via agent notify tools inside OryxOS).",
      `Configured baseUrl=${pub.baseUrl}; apiKeySet=${pub.apiKeySet}; defaultAgent=${pub.defaultAgent || "(none)"}.`,
      "Never paste ORYXOS_API_KEY or channel secrets into chat.",
    ].join(" "),
  });

  register(ctx, {
    name: "oryx_health",
    description: "Check local OryxOS HTTP reachability (GET /api/v1/health).",
    parameters: { type: "object", additionalProperties: false, properties: {} },
    timeoutMs: cfg.timeoutMs,
    execute: async () => health(cfg),
    format: formatHealth,
    title: "OryxOS health",
  });

  register(ctx, {
    name: "oryx_im_list",
    description:
      "List OryxOS inbound IM channel defs (GET /api/v1/channels). Covers platforms already wired in OryxOS (feishu, wecom, telegram, …).",
    parameters: { type: "object", additionalProperties: false, properties: {} },
    timeoutMs: cfg.timeoutMs,
    execute: async () => listChannels(cfg),
    format: formatChannels,
    title: "OryxOS IM list",
  });

  register(ctx, {
    name: "oryx_im_status",
    description:
      "Live status of OryxOS inbound IM channels (GET /api/v1/channels/status) — CONNECTED / DISCONNECTED etc.",
    parameters: { type: "object", additionalProperties: false, properties: {} },
    timeoutMs: cfg.timeoutMs,
    execute: async () => channelStatus(cfg),
    format: formatStatus,
    title: "OryxOS IM status",
  });

  register(ctx, {
    name: "oryx_notify_list",
    description:
      "List OryxOS outbound notify channel resources (GET /api/v1/notify-channels). Sending is done by OryxOS agent tools, not this plugin.",
    parameters: { type: "object", additionalProperties: false, properties: {} },
    timeoutMs: cfg.timeoutMs,
    execute: async () => listNotifyChannels(cfg),
    format: formatNotify,
    title: "OryxOS notify list",
  });

  register(ctx, {
    name: "oryx_invoke",
    description:
      "Invoke a local OryxOS agent (POST /api/v1/agents/{name}/invoke). Prefer agents bound in .oryxos/channels.yaml so IM and console share the same brain.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        agent: {
          type: "string",
          description: "Agent name; defaults to config.defaultAgent / ORYXOS_DEFAULT_AGENT.",
        },
        content: { type: "string", description: "User message to the agent." },
      },
      required: ["content"],
    },
    timeoutMs: cfg.timeoutMs,
    execute: async (args) => invokeAgent(cfg, args),
    format: formatInvoke,
    title: "OryxOS invoke",
  });
}

function register(ctx, { name: toolName, description, parameters, timeoutMs, execute, format, title }) {
  ctx.tools.register({
    name: toolName,
    description,
    parameters,
    output: {
      schema: {
        type: "object",
        additionalProperties: true,
        properties: {
          ok: { type: "boolean" },
          error: { type: "string" },
        },
      },
      render: (_args, value) => [{ type: "text", text: format(value) }],
    },
    timeoutMs,
    isConcurrencySafe: () => true,
    execute,
    presentCall: () => ({ card: "generic", title }),
    presentResult: (_args, result) => ({
      card: "generic",
      title: result.isError ? `${title} failed` : title,
      content: result.content,
    }),
  });
}
