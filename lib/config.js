/** Merge cordis config + env (env fills empty strings). Never log secrets. */

export function resolveConfig(raw = {}, env = process.env) {
  const a = raw.adapters || {};
  return {
    enabled: raw.enabled !== false,
    /** When true, refuse to start non-mock adapters with empty allowedUserIds. */
    requireAllowlist: bool(raw.requireAllowlist, env.DSH_IM_REQUIRE_ALLOWLIST),
    voiceAsr: {
      enabled: raw.voiceAsr?.enabled !== false && env.DSH_IM_VOICE_ASR !== "0",
      timeoutMs: num(raw.voiceAsr?.timeoutMs ?? env.DSH_IM_VOICE_ASR_TIMEOUT_MS, 300_000),
      language: str(raw.voiceAsr?.language || env.DSH_IM_VOICE_ASR_LANG),
    },
    adapters: {
      mock: {
        enabled: bool(a.mock?.enabled, env.DSH_IM_MOCK),
        port: num(a.mock?.port ?? env.DSH_IM_MOCK_PORT, 18999),
      },
      feishu: {
        enabled: bool(a.feishu?.enabled, env.DSH_IM_FEISHU),
        appId: str(a.feishu?.appId || env.FEISHU_APP_ID || env.DSH_IM_FEISHU_APP_ID),
        appSecret: str(a.feishu?.appSecret || env.FEISHU_APP_SECRET || env.DSH_IM_FEISHU_APP_SECRET),
        allowedUserIds: idList(a.feishu?.allowedUserIds, env.DSH_IM_FEISHU_ALLOWED_USER_IDS),
      },
      wecom: {
        enabled: bool(a.wecom?.enabled, env.DSH_IM_WECOM),
        // Vendor names: BotID / 长连接 Secret.
        botId: str(a.wecom?.botId || env.WECOM_BOT_ID || env.DSH_IM_WECOM_BOT_ID),
        secret: str(a.wecom?.secret || env.WECOM_BOT_SECRET || env.DSH_IM_WECOM_SECRET),
        allowedUserIds: idList(a.wecom?.allowedUserIds, env.DSH_IM_WECOM_ALLOWED_USER_IDS),
      },
      dingtalk: {
        enabled: bool(a.dingtalk?.enabled, env.DSH_IM_DINGTALK),
        clientId: str(a.dingtalk?.clientId || env.DINGTALK_CLIENT_ID || env.DSH_IM_DINGTALK_CLIENT_ID),
        clientSecret: str(
          a.dingtalk?.clientSecret || env.DINGTALK_CLIENT_SECRET || env.DSH_IM_DINGTALK_CLIENT_SECRET,
        ),
        allowedUserIds: idList(a.dingtalk?.allowedUserIds, env.DSH_IM_DINGTALK_ALLOWED_USER_IDS),
      },
      qq: {
        enabled: bool(a.qq?.enabled, env.DSH_IM_QQ),
        appId: str(a.qq?.appId || env.QQ_APP_ID || env.DSH_IM_QQ_APP_ID),
        appSecret: str(a.qq?.appSecret || env.QQ_APP_SECRET || env.DSH_IM_QQ_APP_SECRET),
        allowedUserIds: idList(a.qq?.allowedUserIds, env.DSH_IM_QQ_ALLOWED_USER_IDS),
      },
      slack: {
        enabled: bool(a.slack?.enabled, env.DSH_IM_SLACK),
        botToken: str(a.slack?.botToken || env.SLACK_BOT_TOKEN || env.DSH_IM_SLACK_BOT_TOKEN),
        appToken: str(a.slack?.appToken || env.SLACK_APP_TOKEN || env.DSH_IM_SLACK_APP_TOKEN),
        allowedUserIds: idList(a.slack?.allowedUserIds, env.DSH_IM_SLACK_ALLOWED_USER_IDS),
      },
      discord: {
        enabled: bool(a.discord?.enabled, env.DSH_IM_DISCORD),
        botToken: str(a.discord?.botToken || env.DISCORD_BOT_TOKEN || env.DSH_IM_DISCORD_BOT_TOKEN),
        applicationId: str(
          a.discord?.applicationId || env.DISCORD_APPLICATION_ID || env.DSH_IM_DISCORD_APPLICATION_ID,
        ),
        allowedUserIds: idList(a.discord?.allowedUserIds, env.DSH_IM_DISCORD_ALLOWED_USER_IDS),
      },
      telegram: {
        enabled: bool(a.telegram?.enabled, env.DSH_IM_TELEGRAM),
        botToken: str(a.telegram?.botToken || env.TELEGRAM_BOT_TOKEN || env.DSH_IM_TELEGRAM_BOT_TOKEN),
        botUsername: str(
          a.telegram?.botUsername || env.TELEGRAM_BOT_USERNAME || env.DSH_IM_TELEGRAM_BOT_USERNAME,
        ),
        allowedUserIds: idList(a.telegram?.allowedUserIds, env.DSH_IM_TELEGRAM_ALLOWED_USER_IDS),
      },
      mattermost: {
        enabled: bool(a.mattermost?.enabled, env.DSH_IM_MATTERMOST),
        baseUrl: str(a.mattermost?.baseUrl || env.MATTERMOST_URL || env.DSH_IM_MATTERMOST_URL),
        botToken: str(a.mattermost?.botToken || env.MATTERMOST_TOKEN || env.DSH_IM_MATTERMOST_TOKEN),
        webhookPath: str(
          a.mattermost?.webhookPath || env.MATTERMOST_WEBHOOK_PATH || env.DSH_IM_MATTERMOST_WEBHOOK_PATH || "/mattermost",
        ),
        port: num(a.mattermost?.port ?? env.MATTERMOST_WEBHOOK_PORT ?? env.DSH_IM_MATTERMOST_PORT, 19000),
        webhookToken: str(
          a.mattermost?.webhookToken || env.MATTERMOST_WEBHOOK_TOKEN || env.DSH_IM_MATTERMOST_WEBHOOK_TOKEN,
        ),
        allowedUserIds: idList(a.mattermost?.allowedUserIds, env.DSH_IM_MATTERMOST_ALLOWED_USER_IDS),
      },
    },
    agent: {
      cwd: str(raw.agent?.cwd || env.DSH_IM_AGENT_CWD),
      provider: str(raw.agent?.provider || env.DSH_IM_PROVIDER),
      model: str(raw.agent?.model || env.DSH_IM_MODEL),
      /** Agent preset id (tools/prompt). Default `standard` so bash/read exist. */
      preset: str(raw.agent?.preset || env.DSH_IM_PRESET || "standard") || "standard",
      /** Permission preset: workspace-write | danger-full-access | … */
      permissionPreset: str(
        raw.agent?.permissionPreset || env.DSH_IM_PERMISSION_PRESET || "danger-full-access",
      ),
      maxMessageLength: num(raw.agent?.maxMessageLength, 4000),
      idleTimeoutMs: num(raw.agent?.idleTimeoutMs, 30 * 60 * 1000),
      instructionPrefix: str(raw.agent?.instructionPrefix || ""),
      /**
       * When true, after a successful IM reply try `vecmem_add` with workspace=`im:{platform}`
       * (first 500 chars). Requires dsh-wsl-vecmem and a tools.invoke / get API; otherwise logs and skips.
       */
      vecmemOnReply: bool(raw.agent?.vecmemOnReply, env.DSH_IM_VECMEM_ON_REPLY),
    },
  };
}

function str(v) {
  return String(v ?? "").trim();
}
function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
function bool(cfg, envFlag) {
  const e = String(envFlag || "").toLowerCase();
  if (e === "1" || e === "true" || e === "yes") return true;
  if (e === "0" || e === "false" || e === "no") return false;
  return cfg === true;
}
function arr(v) {
  return Array.isArray(v) ? v.map(String) : [];
}

/** Prefer non-empty cordis list; else parse comma/space-separated env. */
function idList(cfgArr, envCsv) {
  const fromCfg = arr(cfgArr).map((x) => String(x).trim()).filter(Boolean);
  if (fromCfg.length) return fromCfg;
  const raw = String(envCsv || "").trim();
  if (!raw) return [];
  return raw
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}
