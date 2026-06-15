import { Bot, Context, GrammyError, HttpError, InlineKeyboard, session, SessionFlavor } from "grammy";
import { startWorker, AlertRule as WorkerAlertRule, AlertEvent as WorkerAlertEvent } from "./worker";
import { parseNumber } from "./parse";

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN environment variable is required");
}

interface TokenInfo {
  symbol: string;
  name: string;
  address: string;
}

interface AlertRule {
  token: TokenInfo;
  type: "price_below" | "price_above" | "percent_move";
  threshold?: number;
  percentThreshold?: number;
}

interface AlertEvent {
  timestamp: number;
  token: TokenInfo;
  ruleType: string;
  triggerDescription: string;
  currentPrice: number;
  baselinePrice?: number;
  percentChange?: number;
  delivered: boolean;
}

interface SessionData {
  fiat: string;
  timezone: string;
  morningSummary: boolean;
  selectedToken?: TokenInfo;
  pendingRule?: { token: TokenInfo; type: string };
  watchlist: AlertRule[];
  alertHistory: AlertEvent[];
}

type MyContext = Context & SessionFlavor<SessionData>;

const bot = new Bot<MyContext>(BOT_TOKEN);

bot.use(session({
  initial(): SessionData {
    return { fiat: "USD", timezone: "UTC", morningSummary: true, watchlist: [], alertHistory: [] };
  },
}));

const userSessions = new Map<number, SessionData>();

bot.use(async (ctx, next) => {
  const chatId = ctx.chat?.id;
  if (chatId) {
    userSessions.set(chatId, ctx.session);
  }
  await next();
});

function buildWatchlistRulesFromSession(session: SessionData): WorkerAlertRule[] {
  return session.watchlist.map((r) => ({
    token: r.token,
    type: r.type,
    threshold: r.threshold,
    percentThreshold: r.percentThreshold,
  }));
}

const MOCK_TOKENS: TokenInfo[] = [
  { symbol: "TON",  name: "Toncoin",          address: "native" },
  { symbol: "USDT", name: "Tether USD (TON)",  address: "EQCxE6mUtQJKFnGkRO08J8qFDBoGx1qPqFpJq1qPqFpJ" },
  { symbol: "GRAM", name: "Gram",              address: "EQA-X_3QxNQZJwZJwZJwZJwZJwZJwZJwZJwZJwZJwZJwZ" },
  { symbol: "NOT",  name: "Notcoin",           address: "EQAvlWFDxGF2lXm67y4fCzbERFHJbRERFHJbRERFHJbR" },
  { symbol: "DOGS", name: "DOGS",              address: "EQCvxJy4eG8hyHBFsZ7eeP54rBEEEFsZ7eeP54rBEEEF" },
  { symbol: "STON", name: "STON.fi",           address: "EQDEy4zE4xBjBjBjBjBjBjBjBjBjBjBjBjBjBjBjBjBjBj" },
];

function searchTokens(query: string): TokenInfo[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return MOCK_TOKENS.filter(
    (t) =>
      t.symbol.toLowerCase().includes(q) ||
      t.name.toLowerCase().includes(q) ||
      t.address.toLowerCase().includes(q),
  ).slice(0, 3);
}

function getTokenBasePrice(symbol: string): number {
  const prices: Record<string, number> = {
    TON: 2.50,
    USDT: 1.00,
    GRAM: 0.05,
    NOT: 0.01,
    DOGS: 0.0008,
    STON: 0.15,
  };
  return prices[symbol] ?? 1.0;
}

function formatPriceMessage(token: TokenInfo): string {
  const base = getTokenBasePrice(token.symbol);
  const volatility = base * 0.03;
  const price = +(base + (Math.random() - 0.5) * 2 * volatility).toFixed(6);
  const change1h = +((Math.random() - 0.5) * 5).toFixed(1);
  const change24h = +((Math.random() - 0.5) * 15).toFixed(1);
  const now = new Date();
  const ts = now.toISOString().replace("T", " ").substring(0, 19);

  const change1hStr = change1h >= 0 ? `+${change1h}%` : `${change1h}%`;
  const change24hStr = change24h >= 0 ? `+${change24h}%` : `${change24h}%`;

  return [
    `<b>${token.symbol}</b> — ${token.name}`,
    ``,
    `💵 Price: <b>$${price.toFixed(6)}</b>`,
    `📈 1h change: ${change1hStr}`,
    `📊 24h change: ${change24hStr}`,
    ``,
    `🕐 Last updated: ${ts} UTC`,
  ].join("\n");
}

const FIAT_OPTIONS = [
  { code: "USD", label: "USD ($)" },
  { code: "EUR", label: "EUR (€)" },
  { code: "GBP", label: "GBP (£)" },
  { code: "RUB", label: "RUB (₽)" },
];

const TIMEZONE_OPTIONS = [
  { value: "UTC-12", label: "UTC-12 (Baker Island)" },
  { value: "UTC-11", label: "UTC-11 (Pago Pago)" },
  { value: "UTC-10", label: "UTC-10 (Honolulu)" },
  { value: "UTC-9",  label: "UTC-9 (Anchorage)" },
  { value: "UTC-8",  label: "UTC-8 (Los Angeles)" },
  { value: "UTC-7",  label: "UTC-7 (Denver)" },
  { value: "UTC-6",  label: "UTC-6 (Chicago)" },
  { value: "UTC-5",  label: "UTC-5 (New York)" },
  { value: "UTC-4",  label: "UTC-4 (Santiago)" },
  { value: "UTC-3",  label: "UTC-3 (São Paulo)" },
  { value: "UTC",    label: "UTC (London)" },
  { value: "UTC+1",  label: "UTC+1 (Berlin)" },
  { value: "UTC+2",  label: "UTC+2 (Cairo)" },
  { value: "UTC+3",  label: "UTC+3 (Moscow)" },
  { value: "UTC+4",  label: "UTC+4 (Dubai)" },
  { value: "UTC+5",  label: "UTC+5 (Karachi)" },
  { value: "UTC+6",  label: "UTC+6 (Dhaka)" },
  { value: "UTC+7",  label: "UTC+7 (Bangkok)" },
  { value: "UTC+8",  label: "UTC+8 (Shanghai)" },
  { value: "UTC+9",  label: "UTC+9 (Tokyo)" },
  { value: "UTC+10", label: "UTC+10 (Sydney)" },
  { value: "UTC+12", label: "UTC+12 (Auckland)" },
];

bot.command("start", async (ctx) => {
  const name = ctx.from?.first_name ?? "there";
  const keyboard = new InlineKeyboard();
  for (const fiat of FIAT_OPTIONS) {
    keyboard.text(fiat.label, `fiat_select:${fiat.code}`);
  }

  await ctx.reply(
    `Welcome to TonAlert, ${name}! 🎉\n\nI help you track Toncoin and TON jetton prices with custom alerts.\n\nPlease select your preferred fiat currency (default: USD):`,
    { reply_markup: keyboard },
  );
});

bot.callbackQuery(/^fiat_select:(.+)$/, async (ctx) => {
  const fiatCode = ctx.match[1];
  const fiatOption = FIAT_OPTIONS.find((f) => f.code === fiatCode);
  if (!fiatOption) {
    await ctx.answerCallbackQuery({ text: "Unknown fiat currency." });
    return;
  }
  ctx.session.fiat = fiatCode;

  const keyboard = new InlineKeyboard()
    .text("🕐 Auto-detect (UTC)", "tz_select:UTC").row();

  const COL = 2;
  for (let i = 0; i < TIMEZONE_OPTIONS.length; i += COL) {
    const row = TIMEZONE_OPTIONS.slice(i, i + COL);
    for (const tz of row) {
      keyboard.text(tz.label, `tz_select:${tz.value}`);
    }
    keyboard.row();
  }

  await ctx.editMessageText(
    `Fiat currency set to ${fiatOption.label}. ✅\n\nNow, please select your timezone:\n(Default: UTC, used for quiet hours & morning summary scheduling)`,
    { reply_markup: keyboard },
  );
  await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^tz_select:(.+)$/, async (ctx) => {
  const tzValue = ctx.match[1];
  const tzOption = TIMEZONE_OPTIONS.find((t) => t.value === tzValue);
  if (!tzOption) {
    await ctx.answerCallbackQuery({ text: "Unknown timezone." });
    return;
  }
  ctx.session.timezone = tzValue;

  const keyboard = new InlineKeyboard()
    .text("✅ Yes", "morning_summary:yes").row()
    .text("❌ No", "morning_summary:no");

  await ctx.editMessageText(
    `Timezone set to ${tzOption.label}. ✅\n\nWould you like to receive a daily morning summary of your tracked tokens? (default: Yes)`,
    { reply_markup: keyboard },
  );
  await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^morning_summary:(yes|no)$/, async (ctx) => {
  const enabled = ctx.match[1] === "yes";
  ctx.session.morningSummary = enabled;

  const menu = new InlineKeyboard()
    .text("🚀 Set Alert", "menu:set_alert").row()
    .text("📊 My Alerts", "menu:my_alerts").row()
    .text("ℹ️ Help", "menu:help");

  await ctx.editMessageText(
    `Morning summary ${enabled ? "enabled" : "disabled"}. ✅\n\nUse the menu below to get started.`,
    { reply_markup: menu },
  );
  await ctx.answerCallbackQuery();
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    "Available commands:\n" +
    "/start — Start the bot and see the welcome message\n" +
    "/add <symbol|address> — Search for a token to add to your watchlist\n" +
    "/price <symbol> — Show current price, 1h change, and 24h change for a token\n" +
    "/help — Show this help message"
  );
});

bot.command("add", async (ctx) => {
  const query = ctx.match.trim();
  if (!query) {
    await ctx.reply(
      "Please provide a token symbol or contract address to search for.\n\nExample: /add TON",
    );
    return;
  }

  const results = searchTokens(query);
  if (results.length === 0) {
    await ctx.reply(`No tokens found matching "${query}". Try a different symbol or address.`);
    return;
  }

  const keyboard = new InlineKeyboard();
  for (const token of results) {
    keyboard.text(
      `➕ Add ${token.symbol}`,
      `add:${token.symbol}`,
    ).row();
  }

  const list = results
    .map((t) => `• <b>${t.symbol}</b> — ${t.name}\n  <code>${t.address}</code>`)
    .join("\n\n");

  await ctx.reply(
    `Search results for <b>"${query}"</b>:\n\n${list}`,
    { reply_markup: keyboard, parse_mode: "HTML" },
  );
});

bot.callbackQuery(/^add:(.+)$/, async (ctx) => {
  const symbol = ctx.match[1];
  const token = MOCK_TOKENS.find((t) => t.symbol === symbol);
  if (!token) {
    await ctx.answerCallbackQuery({ text: "Token not found." });
    return;
  }

  ctx.session.selectedToken = token;

  const keyboard = new InlineKeyboard()
    .text("📉 Price below", "rule:price_below").row()
    .text("📈 Price above", "rule:price_above").row()
    .text("📊 Move ≥ % in 1h", "rule:percent_move").row()
    .text("⏭️ Skip", "rule:skip");

  await ctx.editMessageText(
    `Configure alert for <b>${token.symbol}</b> — ${token.name}\n\nChoose an alert rule type:`,
    { reply_markup: keyboard, parse_mode: "HTML" },
  );

  await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^rule:(.+)$/, async (ctx) => {
  const ruleType = ctx.match[1];
  const token = ctx.session.selectedToken;

  if (!token) {
    await ctx.answerCallbackQuery({ text: "Please select a token first. Use /add to search." });
    return;
  }

  if (ruleType === "skip") {
    ctx.session.selectedToken = undefined;
    await ctx.editMessageText(
      `No alert configured for <b>${token.symbol}</b>.\n\nUse /add to configure an alert later.`,
      { parse_mode: "HTML" },
    );
    await ctx.answerCallbackQuery();
    return;
  }

  ctx.session.pendingRule = { token, type: ruleType };
  ctx.session.selectedToken = undefined;

  const prompt = ruleType === "percent_move"
    ? `Enter the minimum percentage move for <b>${token.symbol}</b> (e.g., 5 for 5%):`
    : `Enter the target price for <b>${token.symbol}</b> (in USD):`;

  await ctx.editMessageText(
    `${prompt}\n\n(Send /cancel to abort)`,
    { parse_mode: "HTML" },
  );
  await ctx.answerCallbackQuery();
});

bot.command("price", async (ctx) => {
  const query = ctx.match.trim().toUpperCase();
  if (!query) {
    await ctx.reply(
      "Please provide a token symbol.\n\nExample: /price TON",
    );
    return;
  }

  const token = MOCK_TOKENS.find(
    (t) => t.symbol.toUpperCase() === query,
  );
  if (!token) {
    await ctx.reply(
      `Token "${query}" not found. Available tokens: ${MOCK_TOKENS.map((t) => t.symbol).join(", ")}`,
    );
    return;
  }

  const priceInfo = formatPriceMessage(token);
  await ctx.reply(priceInfo, { parse_mode: "HTML" });
});

bot.callbackQuery(/^price_now:(.+)$/, async (ctx) => {
  const symbol = ctx.match[1];
  const token = MOCK_TOKENS.find(
    (t) => t.symbol.toUpperCase() === symbol.toUpperCase(),
  );

  await ctx.answerCallbackQuery();

  if (!token) {
    await ctx.reply(`Token "${symbol}" not found.`);
    return;
  }

  const priceInfo = formatPriceMessage(token);
  await ctx.reply(priceInfo, { parse_mode: "HTML" });
});

bot.callbackQuery(/^snooze:(.+):(.+)$/, async (ctx) => {
  const symbol = ctx.match[1];
  await ctx.answerCallbackQuery({ text: `Snoozed alerts for ${symbol} for 1 hour.` });
});

bot.callbackQuery(/^disable:(.+):(.+)$/, async (ctx) => {
  const symbol = ctx.match[1];
  const ruleType = ctx.match[2];
  const chatId = ctx.chat?.id;
  if (chatId) {
    ctx.session.watchlist = ctx.session.watchlist.filter(
      (r) => !(r.token.symbol === symbol && r.type === ruleType),
    );
  }
  await ctx.answerCallbackQuery({ text: `Alert rule for ${symbol} disabled.` });
});

bot.on("message:text", async (ctx, next) => {
  const pending = ctx.session.pendingRule;
  if (!pending) {
    await next();
    return;
  }

  const text = ctx.message.text.trim();

  if (text === "/cancel") {
    ctx.session.pendingRule = undefined;
    await ctx.reply("Alert configuration cancelled. Use /add to create a new alert.");
    return;
  }

  const parseContext = pending.type === "percent_move" ? "percent" as const : "price" as const;
  const result = parseNumber(text, parseContext);

  if ("error" in result) {
    const prefix = result.clarification ? "🤔" : "❌";
    await ctx.reply(`${prefix} ${result.error}\n\nPlease try again. (Send /cancel to abort)`);
    return;
  }

  const rule: AlertRule = {
    token: pending.token,
    type: pending.type as "price_below" | "price_above" | "percent_move",
    threshold: pending.type !== "percent_move" ? result.value : undefined,
    percentThreshold: pending.type === "percent_move" ? result.value : undefined,
  };

  ctx.session.watchlist.push(rule);
  ctx.session.pendingRule = undefined;

  const typeLabels: Record<string, string> = {
    price_below: "price drops below",
    price_above: "price rises above",
    percent_move: "price moves ≥",
  };

  const valueLabel = pending.type === "percent_move"
    ? `${result.value}% in 1h`
    : `$${result.value.toFixed(4)}`;

  await ctx.reply(
    `✅ Alert rule saved for <b>${pending.token.symbol}</b>: ${typeLabels[pending.type]} ${valueLabel}\n\nUse /list to view your watchlist.`,
    { parse_mode: "HTML" },
  );
});

bot.on("message", async (ctx) => {
  await ctx.reply("I didn't understand that. Type /help to see available commands.");
});

bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`Error while handling update ${ctx.update.update_id}:`);
  const e = err.error;
  if (e instanceof GrammyError) {
    console.error("Error in request:", e.description);
  } else if (e instanceof HttpError) {
    console.error("Could not contact Telegram:", e);
  } else {
    console.error("Unknown error:", e);
  }
  ctx.reply("Something went wrong. Please try again later.").catch(() => {});
});

bot.start({
  onStart: () => {
    console.log("Bot is running...");

    startWorker(
      bot,
      () => {
        const result: { chatId: number; rules: WorkerAlertRule[] }[] = [];
        for (const [chatId, session] of userSessions) {
          const rules = buildWatchlistRulesFromSession(session);
          if (rules.length > 0) {
            result.push({ chatId, rules });
          }
        }
        return result;
      },
      {
        addEvent(chatId: number, event: WorkerAlertEvent) {
          const session = userSessions.get(chatId);
          if (session) {
            session.alertHistory.push({
              timestamp: event.timestamp,
              token: event.token,
              ruleType: event.ruleType,
              triggerDescription: event.triggerDescription,
              currentPrice: event.currentPrice,
              baselinePrice: event.baselinePrice,
              percentChange: event.percentChange,
              delivered: event.delivered,
            });
          }
        },
      },
    );
  },
});