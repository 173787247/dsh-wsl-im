/** Merge cordis config + env (env fills empty strings). Never log secrets. */

export function resolveConfig(raw = {}, env = process.env) {
  const a = raw.adapters || {};
  return {
    enabled: raw.enabled !== false,
    adapters: {
      mock: {
        enabled: bool(a.mock?.enabled, env.DSH_IM_MOCK),
        port: num(a.mock?.port ?? env.DSH_IM_MOCK_PORT, 18999),
      },
      feishu: {
        enabled: bool(a.feishu?.enabled, env.DSH_IM_FEISHU),
        appId: str(a.feishu?.appId || env.FEISHU_APP_ID || env.DSH_IM_FEISHU_APP_ID),
        appSecret: str(a.feishu?.appSecret || env.FEISHU_APP_SECRET || env.DSH_IM_FEISHU_APP_SECRET),
        allowedUserIds: arr(a.feishu?.allowedUserIds),
      },
      wecom: {
        enabled: bool(a.wecom?.enabled, env.DSH_IM_WECOM),
        // OryxOS mapping: app_id=BotID, app_secret=长连接 Secret
        botId: str(a.wecom?.botId || env.WECOM_BOT_ID || env.DSH_IM_WECOM_BOT_ID),
        secret: str(a.wecom?.secret || env.WECOM_BOT_SECRET || env.DSH_IM_WECOM_SECRET),
        allowedUserIds: arr(a.wecom?.allowedUserIds),
      },
      dingtalk: {
        enabled: bool(a.dingtalk?.enabled, env.DSH_IM_DINGTALK),
        clientId: str(a.dingtalk?.clientId || env.DINGTALK_CLIENT_ID || env.DSH_IM_DINGTALK_CLIENT_ID),
        clientSecret: str(
          a.dingtalk?.clientSecret || env.DINGTALK_CLIENT_SECRET || env.DSH_IM_DINGTALK_CLIENT_SECRET,
        ),
        allowedUserIds: arr(a.dingtalk?.allowedUserIds),
      },
      qq: {
        enabled: bool(a.qq?.enabled, env.DSH_IM_QQ),
        appId: str(a.qq?.appId || env.QQ_APP_ID || env.DSH_IM_QQ_APP_ID),
        appSecret: str(a.qq?.appSecret || env.QQ_APP_SECRET || env.DSH_IM_QQ_APP_SECRET),
        allowedUserIds: arr(a.qq?.allowedUserIds),
      },
    },
    agent: {
      cwd: str(raw.agent?.cwd || env.DSH_IM_AGENT_CWD),
      provider: str(raw.agent?.provider || env.DSH_IM_PROVIDER),
      model: str(raw.agent?.model || env.DSH_IM_MODEL),
      maxMessageLength: num(raw.agent?.maxMessageLength, 4000),
      idleTimeoutMs: num(raw.agent?.idleTimeoutMs, 30 * 60 * 1000),
      instructionPrefix: str(raw.agent?.instructionPrefix || ""),
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
