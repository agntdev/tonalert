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
  selectedToken?: TokenInfo;
  pendingRule?: { token: TokenInfo; type: string };
  watchlist: AlertRule[];
  alertHistory: AlertEvent[];
}

type MyContext = Context & SessionFlavor<SessionData>;

const bot = new Bot<MyContext>(BOT_TOKEN);

bot.use(session({
  initial(): SessionData {
    return { watchlist: [], alertHistory: [] };
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

bot.command("start", async (ctx) => {
  const name = ctx.from?.first_name ?? "there";
  const menu = new InlineKeyboard()
    .text("🚀 Set Alert", "menu:set_alert").row()
    .text("📊 My Alerts", "menu:my_alerts").row()
    .text("ℹ️ Help", "menu:help");

  await ctx.reply(
    `Welcome to TonAlert, ${name}! 🎉\n\nI help you track Toncoin and TON jetton prices with custom alerts. Use the menu below to get started.`,
    { reply_markup: menu },
  );
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    "Available commands:\n" +
    "/start — Start the bot and see the welcome message\n" +
    "/add <symbol|address> — Search for a token to add to your watchlist\n" +
    "/list — View your watchlist and manage alert rules\n" +
    "/help — Show this help message"
  );
});

bot.command("list", async (ctx) => {
  const watchlist = ctx.session.watchlist;
  if (watchlist.length === 0) {
    await ctx.reply(
      "Your watchlist is empty. Use /add to search for tokens and configure alert rules.",
    );
    return;
  }

  const typeLabels: Record<string, string> = {
    price_below: "Price below",
    price_above: "Price above",
    percent_move: "Move ≥",
  };

  const lines = watchlist.map((rule, i) => {
    let detail: string;
    if (rule.type === "percent_move") {
      detail = `${typeLabels[rule.type]} ${rule.percentThreshold ?? 5}% in 1h`;
    } else {
      const threshold = rule.threshold ?? (rule.type === "price_below" ? 1 : 100);
      detail = `${typeLabels[rule.type]} $${threshold.toFixed(4)}`;
    }
    return `${i + 1}. <b>${rule.token.symbol}</b> — ${detail}`;
  });

  for (let i = 0; i < watchlist.length; i++) {
    const rule = watchlist[i];
    const keyboard = new InlineKeyboard()
      .text("💰 Price now", `price_now:${rule.token.symbol}`).row()
      .text("✏️ Edit rule", `edit:${rule.token.symbol}:${rule.type}`).row()
      .text("🗑 Remove", `remove:${rule.token.symbol}:${rule.type}`);

    await ctx.reply(lines[i], { reply_markup: keyboard, parse_mode: "HTML" });
  }
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

bot.callbackQuery(/^price_now:(.+)$/, async (ctx) => {
  const symbol = ctx.match[1];
  await ctx.answerCallbackQuery({ text: `Price for ${symbol} will be available soon.` });
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

bot.callbackQuery(/^remove:(.+):(.+)$/, async (ctx) => {
  const symbol = ctx.match[1];
  const ruleType = ctx.match[2];
  const chatId = ctx.chat?.id;
  if (chatId) {
    ctx.session.watchlist = ctx.session.watchlist.filter(
      (r) => !(r.token.symbol === symbol && r.type === ruleType),
    );
  }
  await ctx.answerCallbackQuery({ text: `Removed alert rule for ${symbol}.` });
  try {
    const remaining = ctx.session.watchlist.length;
    if (remaining === 0) {
      await ctx.editMessageText("Your watchlist is now empty. Use /add to configure new alerts.");
    } else {
      const typeLabels: Record<string, string> = {
        price_below: "Price below",
        price_above: "Price above",
        percent_move: "Move ≥",
      };
      const lines = ctx.session.watchlist.map((rule, i) => {
        let detail: string;
        if (rule.type === "percent_move") {
          detail = `${typeLabels[rule.type]} ${rule.percentThreshold ?? 5}% in 1h`;
        } else {
          const threshold = rule.threshold ?? (rule.type === "price_below" ? 1 : 100);
          detail = `${typeLabels[rule.type]} $${threshold.toFixed(4)}`;
        }
        return `${i + 1}. <b>${rule.token.symbol}</b> — ${detail}`;
      });
      await ctx.editMessageText(
        lines.join("\n"),
        { parse_mode: "HTML" },
      );
    }
  } catch {
    // message may not be editable
  }
});

bot.callbackQuery(/^edit:(.+):(.+)$/, async (ctx) => {
  const symbol = ctx.match[1];
  const ruleType = ctx.match[2];
  const token = MOCK_TOKENS.find((t) => t.symbol === symbol);
  if (!token) {
    await ctx.answerCallbackQuery({ text: "Token not found." });
    return;
  }

  const chatId = ctx.chat?.id;
  if (chatId) {
    ctx.session.watchlist = ctx.session.watchlist.filter(
      (r) => !(r.token.symbol === symbol && r.type === ruleType),
    );
  }

  ctx.session.pendingRule = { token, type: ruleType };

  const prompt = ruleType === "percent_move"
    ? `Enter the new percentage threshold for <b>${token.symbol}</b> (e.g., 5 for 5%):`
    : `Enter the new target price for <b>${token.symbol}</b> (in USD):`;

  await ctx.editMessageText(
    `${prompt}\n\n(Send /cancel to abort)`,
    { parse_mode: "HTML" },
  );
  await ctx.answerCallbackQuery();
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