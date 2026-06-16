import { InlineKeyboard } from "grammy";

interface BotLike {
  api: {
    sendMessage: (chatId: number | string, text: string, other?: Record<string, unknown>) => Promise<unknown>;
  };
}

export interface TokenInfo {
  symbol: string;
  name: string;
  address: string;
}

export interface AlertRule {
  token: TokenInfo;
  type: "price_below" | "price_above" | "percent_move";
  threshold?: number;
  percentThreshold?: number;
}

export interface AlertEvent {
  timestamp: number;
  token: TokenInfo;
  ruleType: string;
  triggerDescription: string;
  currentPrice: number;
  baselinePrice?: number;
  percentChange?: number;
  delivered: boolean;
}

interface QuietHoursConfig {
  enabled: boolean;
  start: string;
  end: string;
  immediate: boolean;
  timezone: string;
}

export interface DigestConfig {
  ownerId: number;
  scheduleHour?: number;
  getTotalUsers?: () => number;
  onAdminNotify?: (message: string) => void;
}

interface OutageEvent {
  timestamp: number;
  message: string;
}

const globalAlertTimestamps: number[] = [];
const globalOutageEvents: OutageEvent[] = [];
let lastDigestDate = "";

function recordAlertTimestamp(timestamp: number): void {
  globalAlertTimestamps.push(timestamp);
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  while (globalAlertTimestamps.length > 0 && globalAlertTimestamps[0] < cutoff) {
    globalAlertTimestamps.shift();
  }
}

export function recordOutage(message: string): void {
  globalOutageEvents.push({ timestamp: Date.now(), message });
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  while (globalOutageEvents.length > 0 && globalOutageEvents[0].timestamp < cutoff) {
    globalOutageEvents.shift();
  }
}

function detectAlertSpikes(): { spikeDetected: boolean; lastHourCount: number; avgHourly24h: number } {
  const now = Date.now();
  const lastHourCutoff = now - 60 * 60 * 1000;
  const last24hCutoff = now - 24 * 60 * 60 * 1000;

  const lastHourCount = globalAlertTimestamps.filter((t) => t >= lastHourCutoff).length;
  const last24hCount = globalAlertTimestamps.filter((t) => t >= last24hCutoff).length;
  const avgHourly24h = last24hCount / 24;

  const spikeDetected =
    lastHourCount > 0 && avgHourly24h > 0 && lastHourCount >= avgHourly24h * 3;

  return { spikeDetected, lastHourCount, avgHourly24h };
}

function shouldSendDigest(config: DigestConfig): boolean {
  const now = new Date();
  const scheduleHour = config.scheduleHour ?? 9;

  if (now.getUTCHours() < scheduleHour) return false;

  const today = now.toISOString().split("T")[0];
  if (lastDigestDate === today) return false;

  return true;
}

async function sendDailyDigest(
  bot: BotLike,
  config: DigestConfig,
  totalUsers: number,
): Promise<void> {
  const now = new Date();
  const dateStr = now.toISOString().split("T")[0];

  const { spikeDetected, lastHourCount, avgHourly24h } = detectAlertSpikes();

  const outages24h = globalOutageEvents.filter(
    (o) => o.timestamp >= Date.now() - 24 * 60 * 60 * 1000,
  );

  const totalAlerts24h = globalAlertTimestamps.filter(
    (t) => t >= Date.now() - 24 * 60 * 60 * 1000,
  ).length;

  let message = `<b>📊 Daily Digest</b> — ${dateStr}\n\n`;
  message += `<b>Total users:</b> ${totalUsers}\n`;
  message += `<b>Alerts (last 24h):</b> ${totalAlerts24h}\n`;

  if (spikeDetected) {
    message += `\n⚠️ <b>Alert spike detected!</b>\n`;
    message += `Last hour: ${lastHourCount} alerts (avg hourly: ${avgHourly24h.toFixed(1)})\n`;
  } else {
    message += `\nNo significant alert spikes.\n`;
  }

  if (outages24h.length > 0) {
    message += `\n🔴 <b>Data-source outages (last 24h):</b>\n`;
    for (const outage of outages24h) {
      message += `• ${outage.message}\n`;
    }
  } else {
    message += `\n✅ No data-source outages reported.\n`;
  }

  lastDigestDate = dateStr;

  bot.api
    .sendMessage(config.ownerId, message, { parse_mode: "HTML" })
    .catch(() => {
      console.error("Failed to send daily digest to owner");
    });
}

const COOLDOWN_MS = 3_600_000;
const RESET_MARGIN = 0.01;

interface CooldownEntry {
  lastTriggered: number;
  triggerPrice: number;
}

const cooldowns = new Map<string, CooldownEntry>();

const accumulatedAlerts = new Map<number, AlertEvent[]>();

function parseTimezoneOffsetMinutes(tz: string): number {
  if (tz === "UTC") return 0;
  const match = tz.match(/^UTC([+-])(\d+)$/);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  const hours = parseInt(match[2], 10);
  return sign * hours * 60;
}

function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function isInQuietHours(utcNow: Date, quietHours: QuietHoursConfig): boolean {
  if (!quietHours.enabled || quietHours.immediate) return false;

  const offsetMin = parseTimezoneOffsetMinutes(quietHours.timezone);
  const utcTotalMin = utcNow.getUTCHours() * 60 + utcNow.getUTCMinutes();
  let localTotalMin = (utcTotalMin + offsetMin) % (24 * 60);
  if (localTotalMin < 0) localTotalMin += 24 * 60;

  const startMin = parseTimeToMinutes(quietHours.start);
  const endMin = parseTimeToMinutes(quietHours.end);

  if (startMin <= endMin) {
    return localTotalMin >= startMin && localTotalMin < endMin;
  } else {
    return localTotalMin >= startMin || localTotalMin < endMin;
  }
}

function deliverAccumulatedAlerts(
  chatId: number,
  events: AlertEvent[],
  bot: BotLike,
  alertStore: AlertStore,
) {
  if (events.length === 0) return;

  const byToken = new Map<string, AlertEvent[]>();
  for (const event of events) {
    const key = event.token.symbol;
    if (!byToken.has(key)) byToken.set(key, []);
    byToken.get(key)!.push(event);
  }

  let message = "🌅 <b>Quiet hours ended — accumulated alerts</b>\n\n";
  for (const [symbol, tokenEvents] of byToken) {
    for (const e of tokenEvents) {
      message += `• <b>${symbol}</b> ${e.triggerDescription} — $${e.currentPrice.toFixed(4)}\n`;
    }
  }

  bot.api.sendMessage(chatId, message, { parse_mode: "HTML" }).catch(() => {
    console.error(`Failed to send accumulated alerts to chat ${chatId}`);
  });
}

function getCooldownKey(chatId: number, tokenSymbol: string, ruleType: string): string {
  return `${chatId}:${tokenSymbol}:${ruleType}`;
}

const priceCache = new Map<string, { price: number; previousPrice: number; timestamp: number }>();

function basePrice(token: TokenInfo): number {
  switch (token.symbol) {
    case "TON": return 2.50;
    case "USDT": return 1.00;
    case "GRAM": return 0.05;
    case "NOT": return 0.01;
    case "DOGS": return 0.0008;
    case "STON": return 0.15;
    default: return 1.0;
  }
}

function fetchMockPrice(token: TokenInfo): number {
  const key = token.symbol;
  const cached = priceCache.get(key);
  const now = Date.now();
  if (cached && now - cached.timestamp < 60_000) return cached.price;

  const prev = cached?.price ?? basePrice(token);
  const volatility = basePrice(token) * 0.03;
  const change = (Math.random() - 0.5) * 2 * volatility;
  const newPrice = Math.max(0.000001, +(prev + change).toFixed(6));

  priceCache.set(key, {
    price: newPrice,
    previousPrice: prev,
    timestamp: now,
  });

  return newPrice;
}

function getPreviousPrice(token: TokenInfo): number {
  const cached = priceCache.get(token.symbol);
  return cached?.previousPrice ?? basePrice(token);
}

function evaluateRule(rule: AlertRule, currentPrice: number): {
  triggered: boolean;
  description: string;
  percentChange: number;
  baselinePrice: number;
} | null {
  const previousPrice = getPreviousPrice(rule.token);
  const percentChange = ((currentPrice - previousPrice) / previousPrice) * 100;

  switch (rule.type) {
    case "price_below": {
      const threshold = rule.threshold ?? basePrice(rule.token) * 0.95;
      if (currentPrice <= threshold) {
        return {
          triggered: true,
          description: `dropped below $${threshold.toFixed(4)}`,
          percentChange,
          baselinePrice: threshold,
        };
      }
      return null;
    }
    case "price_above": {
      const threshold = rule.threshold ?? basePrice(rule.token) * 1.05;
      if (currentPrice >= threshold) {
        return {
          triggered: true,
          description: `rose above $${threshold.toFixed(4)}`,
          percentChange,
          baselinePrice: threshold,
        };
      }
      return null;
    }
    case "percent_move": {
      const pctThreshold = rule.percentThreshold ?? 5;
      if (Math.abs(percentChange) >= pctThreshold) {
        const direction = percentChange >= 0 ? "jumped" : "dropped";
        return {
          triggered: true,
          description: `${direction} ${Math.abs(percentChange).toFixed(1)}% in 1h`,
          percentChange,
          baselinePrice: previousPrice,
        };
      }
      return null;
    }
    default:
      return null;
  }
}

function shouldSuppressRule(
  key: string,
  rule: AlertRule,
  currentPrice: number,
  percentChange: number,
): boolean {
  const entry = cooldowns.get(key);
  if (!entry) return false;

  const now = Date.now();
  if (now - entry.lastTriggered > COOLDOWN_MS) {
    cooldowns.delete(key);
    return false;
  }

  switch (rule.type) {
    case "price_below": {
      const threshold = rule.threshold ?? basePrice(rule.token) * 0.95;
      const resetPrice = threshold * (1 - RESET_MARGIN);
      if (currentPrice <= resetPrice) {
        cooldowns.delete(key);
        return false;
      }
      break;
    }
    case "price_above": {
      const threshold = rule.threshold ?? basePrice(rule.token) * 1.05;
      const resetPrice = threshold * (1 + RESET_MARGIN);
      if (currentPrice >= resetPrice) {
        cooldowns.delete(key);
        return false;
      }
      break;
    }
    case "percent_move": {
      const pctThreshold = rule.percentThreshold ?? 5;
      const resetThreshold = pctThreshold + RESET_MARGIN * 100;
      if (Math.abs(percentChange) >= resetThreshold) {
        cooldowns.delete(key);
        return false;
      }
      break;
    }
  }

  return true;
}

interface UserRules {
  chatId: number;
  rules: AlertRule[];
  quietHours: QuietHoursConfig;
}

interface AlertStore {
  addEvent: (chatId: number, event: AlertEvent) => void;
}

export function startWorker(
  bot: BotLike,
  getUserRules: () => UserRules[],
  alertStore: AlertStore,
  digestConfig?: DigestConfig,
): NodeJS.Timeout {
  const evaluate = async () => {
    const users = getUserRules();

    if (digestConfig && shouldSendDigest(digestConfig)) {
      const totalUsers = digestConfig.getTotalUsers
        ? digestConfig.getTotalUsers()
        : users.length;
      sendDailyDigest(bot, digestConfig, totalUsers);
    }

    for (const user of users) {
      const acc = accumulatedAlerts.get(user.chatId);
      if (acc && acc.length > 0 && !isInQuietHours(new Date(), user.quietHours)) {
        deliverAccumulatedAlerts(user.chatId, [...acc], bot, alertStore);
        accumulatedAlerts.delete(user.chatId);
      }
    }

    if (users.length === 0) return;

    const evaluatedTokens = new Map<string, number>();
    const getPrice = (token: TokenInfo): number => {
      const key = token.symbol;
      if (!evaluatedTokens.has(key)) {
        evaluatedTokens.set(key, fetchMockPrice(token));
      }
      return evaluatedTokens.get(key)!;
    };

    for (const user of users) {
      for (const rule of user.rules) {
        const currentPrice = getPrice(rule.token);
        const result = evaluateRule(rule, currentPrice);
        if (!result) continue;

        const cooldownKey = getCooldownKey(user.chatId, rule.token.symbol, rule.type);
        if (shouldSuppressRule(cooldownKey, rule, currentPrice, result.percentChange)) continue;

        const previousPrice = getPreviousPrice(rule.token);
        const percentLabel = result.percentChange >= 0
          ? `+${result.percentChange.toFixed(1)}%`
          : `${result.percentChange.toFixed(1)}%`;

        let triggerLine: string;
        if (rule.type === "percent_move") {
          triggerLine = `Trigger: ≥${rule.percentThreshold ?? 5}% in 1h`;
        } else {
          const threshold = rule.threshold ?? (rule.type === "price_below"
            ? basePrice(rule.token) * 0.95
            : basePrice(rule.token) * 1.05);
          triggerLine = `Trigger: price ${rule.type === "price_below" ? "≤" : "≥"} $${threshold.toFixed(4)}`;
        }

        const message = [
          `${rule.token.symbol} ${result.description} — now $${currentPrice.toFixed(4)} (${percentLabel} since last check).`,
          triggerLine,
        ].join("\n");

        const keyboard = new InlineKeyboard()
          .text("Price now", `price_now:${rule.token.symbol}`).row()
          .text("Snooze 1h", `snooze:${rule.token.symbol}:${rule.type}`).row()
          .text("Disable rule", `disable:${rule.token.symbol}:${rule.type}`);

        const alertEvent: AlertEvent = {
          timestamp: Date.now(),
          token: rule.token,
          ruleType: rule.type,
          triggerDescription: result.description,
          currentPrice,
          baselinePrice: result.baselinePrice,
          percentChange: result.percentChange,
          delivered: true,
        };

        const isQuiet = isInQuietHours(new Date(), user.quietHours);

        if (isQuiet) {
          alertEvent.delivered = false;
          const acc = accumulatedAlerts.get(user.chatId) || [];
          acc.push(alertEvent);
          accumulatedAlerts.set(user.chatId, acc);
        } else {
          try {
            await bot.api.sendMessage(user.chatId, message, { reply_markup: keyboard });
          } catch {
            console.error(`Failed to send alert to chat ${user.chatId}`);
          }
        }

        cooldowns.set(cooldownKey, { lastTriggered: Date.now(), triggerPrice: currentPrice });

        alertStore.addEvent(user.chatId, alertEvent);
        recordAlertTimestamp(alertEvent.timestamp);
      }
    }
  };

  evaluate();
  const interval = setInterval(evaluate, 60_000);
  return interval;
}