import { createMockAdapter } from "./mock.js";
import { createFeishuAdapter } from "./feishu.js";
import { createWecomAdapter } from "./wecom.js";
import { createDingtalkAdapter } from "./dingtalk.js";
import { createQqAdapter } from "./qq.js";
import { createSlackAdapter } from "./slack.js";
import { createDiscordAdapter } from "./discord.js";
import { createTelegramAdapter } from "./telegram.js";

/**
 * @returns {Array<{ name: string, start(): Promise<void>, stop(): void, state?: Function }>}
 */
export function createAdapters({ config, onMessage, logger }) {
  const out = [];
  const a = config.adapters;

  if (a.mock?.enabled) {
    out.push(createMockAdapter({ port: a.mock.port, onMessage, logger }));
  }
  if (a.feishu?.enabled && a.feishu.appId && a.feishu.appSecret) {
    out.push(
      createFeishuAdapter({
        appId: a.feishu.appId,
        appSecret: a.feishu.appSecret,
        onMessage,
        logger,
      }),
    );
  }
  if (a.wecom?.enabled && a.wecom.botId && a.wecom.secret) {
    out.push(
      createWecomAdapter({
        botId: a.wecom.botId,
        secret: a.wecom.secret,
        onMessage,
        logger,
      }),
    );
  }
  if (a.dingtalk?.enabled && a.dingtalk.clientId && a.dingtalk.clientSecret) {
    out.push(
      createDingtalkAdapter({
        clientId: a.dingtalk.clientId,
        clientSecret: a.dingtalk.clientSecret,
        onMessage,
        logger,
      }),
    );
  }
  if (a.qq?.enabled && a.qq.appId && a.qq.appSecret) {
    out.push(
      createQqAdapter({
        appId: a.qq.appId,
        appSecret: a.qq.appSecret,
        onMessage,
        logger,
      }),
    );
  }
  if (a.slack?.enabled && a.slack.botToken && a.slack.appToken) {
    out.push(
      createSlackAdapter({
        botToken: a.slack.botToken,
        appToken: a.slack.appToken,
        onMessage,
        logger,
      }),
    );
  }
  if (a.discord?.enabled && a.discord.botToken) {
    out.push(
      createDiscordAdapter({
        botToken: a.discord.botToken,
        applicationId: a.discord.applicationId,
        onMessage,
        logger,
      }),
    );
  }
  if (a.telegram?.enabled && a.telegram.botToken) {
    out.push(
      createTelegramAdapter({
        botToken: a.telegram.botToken,
        botUsername: a.telegram.botUsername,
        onMessage,
        logger,
      }),
    );
  }
  return out;
}
