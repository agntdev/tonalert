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

interface UserRules {
  chatId: number;
  rules: AlertRule[];
}

interface AlertStore {
  addEvent: (chatId: number, event: AlertEvent) => void;
}

export function startWorker(
  bot: BotLike,
  getUserRules: () => UserRules[],
  alertStore: AlertStore,
): NodeJS.Timeout {
  const evaluate = async () => {
    const users = getUserRules();
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

        try {
          await bot.api.sendMessage(user.chatId, message, { reply_markup: keyboard });
        } catch {
          console.error(`Failed to send alert to chat ${user.chatId}`);
        }

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

        alertStore.addEvent(user.chatId, alertEvent);
      }
    }
  };

  evaluate();
  const interval = setInterval(evaluate, 60_000);
  return interval;
}