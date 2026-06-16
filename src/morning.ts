interface BotLike {
  api: {
    sendMessage: (chatId: number | string, text: string, other?: Record<string, unknown>) => Promise<unknown>;
  };
}

export interface MorningTokenInfo {
  symbol: string;
  name: string;
  address: string;
}

export interface MorningAlertEvent {
  timestamp: number;
  token: MorningTokenInfo;
  triggerDescription: string;
  delivered: boolean;
}

export interface MorningSession {
  fiat: string;
  timezone: string;
  morningSummary: boolean;
  morningSummaryTime: string;
  lastMorningSummary: number;
  watchlist: { token: MorningTokenInfo; type: string; threshold?: number; percentThreshold?: number }[];
  alertHistory: MorningAlertEvent[];
}

const basePrices: Record<string, number> = {
  TON: 2.50,
  USDT: 1.00,
  GRAM: 0.05,
  NOT: 0.01,
  DOGS: 0.0008,
  STON: 0.15,
};

const priceCache = new Map<string, { price: number; previousPrice: number; timestamp: number }>();

function fetchMockPrice(token: MorningTokenInfo): number {
  const key = token.symbol;
  const cached = priceCache.get(key);
  const now = Date.now();
  if (cached && now - cached.timestamp < 60_000) return cached.price;

  const base = basePrices[token.symbol] ?? 1.0;
  const prev = cached?.price ?? base;
  const volatility = base * 0.03;
  const change = (Math.random() - 0.5) * 2 * volatility;
  const newPrice = Math.max(0.000001, +(prev + change).toFixed(6));

  priceCache.set(key, { price: newPrice, previousPrice: prev, timestamp: now });
  return newPrice;
}

function getTimezoneOffset(timezone: string): number {
  if (timezone === "UTC") return 0;
  const match = timezone.match(/^UTC([+-]\d{1,2})$/);
  if (!match) return 0;
  return parseInt(match[1], 10);
}

function isMorningTime(timezoneStr: string, morningTime: string): boolean {
  const now = new Date();
  const offset = getTimezoneOffset(timezoneStr);
  const totalMinutes = now.getUTCMinutes() + offset * 60;
  const adjusted = new Date(now.getTime() + totalMinutes * 60_000);
  const localHours = adjusted.getUTCHours();
  const localMinutes = adjusted.getUTCMinutes();

  const [hourStr, minuteStr] = morningTime.split(":");
  const targetHour = parseInt(hourStr, 10);
  const targetMinute = parseInt(minuteStr, 10);

  return localHours === targetHour && localMinutes === targetMinute;
}

function formatMorningSummary(session: MorningSession): string {
  const now = Date.now();

  const uniqueTokens = new Map<string, MorningTokenInfo>();
  for (const rule of session.watchlist) {
    uniqueTokens.set(rule.token.symbol, rule.token);
  }

  let message = "🌅 Good morning! Here's your daily summary:\n\n";

  for (const [symbol, token] of uniqueTokens) {
    const price = fetchMockPrice(token);
    const change24h = (Math.random() - 0.5) * 10;
    const arrow = change24h >= 0 ? "↗" : "↘";
    message += `• <b>${symbol}</b>: $${price.toFixed(4)} (${arrow} ${change24h >= 0 ? "+" : ""}${change24h.toFixed(2)}% 24h)\n`;
  }

  const overnightStart = now - 12 * 3600_000;
  const recentAlerts = session.alertHistory.filter((e) => e.timestamp >= overnightStart);

  if (recentAlerts.length > 0) {
    message += "\n🔔 <b>Alerts triggered overnight:</b>\n";
    for (const alert of recentAlerts) {
      const timeStr = new Date(alert.timestamp).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      message += `• <b>${alert.token.symbol}</b> — ${alert.triggerDescription} at ${timeStr}\n`;
    }
  } else {
    message += "\n✅ No alerts were triggered overnight.";
  }

  return message;
}

export function startMorningScheduler(
  bot: BotLike,
  getUserSessions: () => Map<number, MorningSession>,
): NodeJS.Timeout {
  const check = async () => {
    const sessions = getUserSessions();
    if (sessions.size === 0) return;

    const now = Date.now();

    for (const [chatId, session] of sessions.entries()) {
      if (!session.morningSummary) continue;
      if (session.watchlist.length === 0) continue;
      if (now - session.lastMorningSummary < 120_000) continue;
      if (!isMorningTime(session.timezone, session.morningSummaryTime)) continue;

      const message = formatMorningSummary(session);
      session.lastMorningSummary = now;

      try {
        await bot.api.sendMessage(chatId, message, { parse_mode: "HTML" });
      } catch {
        console.error(`Failed to send morning summary to chat ${chatId}`);
      }
    }
  };

  const interval = setInterval(check, 60_000);
  return interval;
}
