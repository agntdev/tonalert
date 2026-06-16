import { Bot, Context, GrammyError, HttpError, InlineKeyboard, session, SessionFlavor } from "grammy";
import { startWorker, AlertRule as WorkerAlertRule, AlertEvent as WorkerAlertEvent } from "./worker";
import { parseNumber } from "./parse";
import { connectRedis } from "./redis";

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN environment variable is required");
}

const OWNER_ID = process.env.OWNER_ID ? parseInt(process.env.OWNER_ID, 10) : undefined;
if (!OWNER_ID) {
  throw new Error("OWNER_ID environment variable is required");
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
  pendingQuietSetting?: "start" | "end";
  watchlist: AlertRule[];
  alertHistory: AlertEvent[];
  quietHoursStart: string;
  quietHoursEnd: string;
  quietHoursEnabled: boolean;
  quietHoursImmediate: boolean;
  accumulatedAlerts: AlertEvent[];
}

type MyContext = Context & SessionFlavor<SessionData>;

const bot = new Bot<MyContext>(BOT_TOKEN);

bot.use(session({
  initial(): SessionData {
    return { fiat: "USD", timezone: "UTC", morningSummary: true, watchlist: [], alertHistory: [], quietHoursStart: "23:00", quietHoursEnd: "07:00", quietHoursEnabled: true, quietHoursImmediate: false, accumulatedAlerts: [] };
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
    "/list — View your watchlist\n" +
    "/quiet — Configure quiet hours for alert suppression\n" +
    "/help — Show this help message"
  );
});

bot.command("stats", async (ctx) => {
  if (ctx.from?.id !== OWNER_ID) {
    await ctx.reply("This command is only available to the bot owner.");
    return;
  }

  const now = Date.now();
  const last24h = now - 24 * 60 * 60 * 1000;

  const totalUsers = userSessions.size;

  let activeWatchCount = 0;
  const tokenWatchCounts = new Map<string, number>();
  let alertsLast24h = 0;

  for (const [, session] of userSessions) {
    activeWatchCount += session.watchlist.length;

    const seenTokens = new Set<string>();
    for (const rule of session.watchlist) {
      if (!seenTokens.has(rule.token.symbol)) {
        seenTokens.add(rule.token.symbol);
        tokenWatchCounts.set(
          rule.token.symbol,
          (tokenWatchCounts.get(rule.token.symbol) || 0) + 1,
        );
      }
    }

    for (const event of session.alertHistory) {
      if (event.timestamp >= last24h) {
        alertsLast24h++;
      }
    }
  }

  const topTokens = [...tokenWatchCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  let message = `<b>Bot Statistics</b>\n\n`;
  message += `<b>Total users:</b> ${totalUsers}\n`;
  message += `<b>Active watch rules:</b> ${activeWatchCount}\n`;
  message += `<b>Alerts fired (last 24h):</b> ${alertsLast24h}\n`;

  if (topTokens.length > 0) {
    message += `\n<b>Top tokens by watches:</b>\n`;
    for (let i = 0; i < topTokens.length; i++) {
      const [symbol, count] = topTokens[i];
      message += `${i + 1}. ${symbol} — ${count} user${count !== 1 ? "s" : ""}\n`;
    }
  }

  await ctx.reply(message, { parse_mode: "HTML" });
});

bot.command("quiet", async (ctx) => {
  const s = ctx.session;
  const keyboard = new InlineKeyboard();

  if (s.quietHoursEnabled) {
    keyboard.text("🔕 Disable quiet hours", "quiet:toggle").row();
  } else {
    keyboard.text("🔔 Enable quiet hours", "quiet:toggle").row();
  }

  keyboard
    .text(`⏰ Start: ${s.quietHoursStart}`, "quiet:set_start").row()
    .text(`🌅 End: ${s.quietHoursEnd}`, "quiet:set_end").row();

  if (s.quietHoursImmediate) {
    keyboard.text("⚡ Immediate: ON (tap to disable)", "quiet:toggle_immediate");
  } else {
    keyboard.text("⚡ Immediate: OFF (tap to enable)", "quiet:toggle_immediate");
  }

  const status = s.quietHoursEnabled
    ? `ON — ${s.quietHoursStart} to ${s.quietHoursEnd}`
    : "OFF";

  await ctx.reply(
    `🌙 <b>Quiet Hours Settings</b>\n\nStatus: ${status}\nImmediate delivery: ${s.quietHoursImmediate ? "Yes" : "No"}\nAccumulated alerts: ${s.accumulatedAlerts.length}\n\nAlerts during quiet hours will be accumulated and delivered when quiet hours end, unless immediate delivery is enabled.\n\nUse the buttons below to configure:`,
    { reply_markup: keyboard, parse_mode: "HTML" },
  );
});

bot.callbackQuery("quiet:toggle", async (ctx) => {
  ctx.session.quietHoursEnabled = !ctx.session.quietHoursEnabled;
  const status = ctx.session.quietHoursEnabled ? "enabled" : "disabled";
  await ctx.answerCallbackQuery({ text: `Quiet hours ${status}.` });

  const s = ctx.session;
  const keyboard = new InlineKeyboard();

  if (s.quietHoursEnabled) {
    keyboard.text("🔕 Disable quiet hours", "quiet:toggle").row();
  } else {
    keyboard.text("🔔 Enable quiet hours", "quiet:toggle").row();
  }

  keyboard
    .text(`⏰ Start: ${s.quietHoursStart}`, "quiet:set_start").row()
    .text(`🌅 End: ${s.quietHoursEnd}`, "quiet:set_end").row();

  if (s.quietHoursImmediate) {
    keyboard.text("⚡ Immediate: ON (tap to disable)", "quiet:toggle_immediate");
  } else {
    keyboard.text("⚡ Immediate: OFF (tap to enable)", "quiet:toggle_immediate");
  }

  const statusText = s.quietHoursEnabled
    ? `ON — ${s.quietHoursStart} to ${s.quietHoursEnd}`
    : "OFF";

  await ctx.editMessageText(
    `🌙 <b>Quiet Hours Settings</b>\n\nStatus: ${statusText}\nImmediate delivery: ${s.quietHoursImmediate ? "Yes" : "No"}\nAccumulated alerts: ${s.accumulatedAlerts.length}\n\nAlerts during quiet hours will be accumulated and delivered when quiet hours end, unless immediate delivery is enabled.\n\nUse the buttons below to configure:`,
    { reply_markup: keyboard, parse_mode: "HTML" },
  );
});

bot.callbackQuery("quiet:toggle_immediate", async (ctx) => {
  ctx.session.quietHoursImmediate = !ctx.session.quietHoursImmediate;
  await ctx.answerCallbackQuery({
    text: `Immediate delivery ${ctx.session.quietHoursImmediate ? "enabled" : "disabled"}.`,
  });

  const s = ctx.session;
  const keyboard = new InlineKeyboard();

  if (s.quietHoursEnabled) {
    keyboard.text("🔕 Disable quiet hours", "quiet:toggle").row();
  } else {
    keyboard.text("🔔 Enable quiet hours", "quiet:toggle").row();
  }

  keyboard
    .text(`⏰ Start: ${s.quietHoursStart}`, "quiet:set_start").row()
    .text(`🌅 End: ${s.quietHoursEnd}`, "quiet:set_end").row();

  if (s.quietHoursImmediate) {
    keyboard.text("⚡ Immediate: ON (tap to disable)", "quiet:toggle_immediate");
  } else {
    keyboard.text("⚡ Immediate: OFF (tap to enable)", "quiet:toggle_immediate");
  }

  const statusText = s.quietHoursEnabled
    ? `ON — ${s.quietHoursStart} to ${s.quietHoursEnd}`
    : "OFF";

  await ctx.editMessageText(
    `🌙 <b>Quiet Hours Settings</b>\n\nStatus: ${statusText}\nImmediate delivery: ${s.quietHoursImmediate ? "Yes" : "No"}\nAccumulated alerts: ${s.accumulatedAlerts.length}\n\nAlerts during quiet hours will be accumulated and delivered when quiet hours end, unless immediate delivery is enabled.\n\nUse the buttons below to configure:`,
    { reply_markup: keyboard, parse_mode: "HTML" },
  );
});

bot.callbackQuery(/^quiet:set_(start|end)$/, async (ctx) => {
  const target = ctx.match[1] as "start" | "end";
  ctx.session.pendingQuietSetting = target;
  const label = target === "start" ? "start" : "end";
  await ctx.editMessageText(
    `Please enter the quiet hours ${label} time in HH:MM format (24-hour).\n\nExample: 23:00 for 11 PM\n\n(Send /cancel to abort)`,
  );
  await ctx.answerCallbackQuery();
});

bot.command("list", async (ctx) => {
  const watchlist = ctx.session.watchlist;
  if (watchlist.length === 0) {
    await ctx.reply(
      "Your watchlist is empty. Use /add to search for tokens and create alert rules.",
    );
    return;
  }

  const typeLabels: Record<string, string> = {
    price_below: "Price below",
    price_above: "Price above",
    percent_move: "Move ≥",
  };

  await ctx.reply("📊 <b>Your Watchlist</b>", { parse_mode: "HTML" });

  for (const rule of watchlist) {
    const valueLabel = rule.type === "percent_move"
      ? `${rule.percentThreshold}% in 1h`
      : `$${(rule.threshold ?? 0).toFixed(2)}`;

    const keyboard = new InlineKeyboard()
      .text("💵 Price now", `price_now:${rule.token.symbol}`).row()
      .text("✏️ Edit rule", `edit_rule:${rule.token.symbol}:${rule.type}`).row()
      .text("🗑 Remove", `remove:${rule.token.symbol}:${rule.type}`);

    await ctx.reply(
      `• <b>${rule.token.symbol}</b> — ${typeLabels[rule.type]} ${valueLabel}`,
      { reply_markup: keyboard, parse_mode: "HTML" },
    );
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

bot.callbackQuery(/^edit_rule:(.+):(.+)$/, async (ctx) => {
  const symbol = ctx.match[1];
  const ruleType = ctx.match[2];
  const rule = ctx.session.watchlist.find(
    (r) => r.token.symbol === symbol && r.type === ruleType,
  );
  if (!rule) {
    await ctx.answerCallbackQuery({ text: "Rule not found." });
    return;
  }

  ctx.session.selectedToken = rule.token;
  ctx.session.pendingRule = { token: rule.token, type: ruleType };

  const prompt = ruleType === "percent_move"
    ? `Enter the new minimum percentage move for <b>${rule.token.symbol}</b> (e.g., 5 for 5%):`
    : `Enter the new target price for <b>${rule.token.symbol}</b> (in USD):`;

  await ctx.reply(
    `${prompt}\n\n(Send /cancel to abort)`,
    { parse_mode: "HTML" },
  );
  await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^remove:(.+):(.+)$/, async (ctx) => {
  const symbol = ctx.match[1];
  const ruleType = ctx.match[2];
  const chatId = ctx.chat?.id;
  if (chatId) {
    const before = ctx.session.watchlist.length;
    ctx.session.watchlist = ctx.session.watchlist.filter(
      (r) => !(r.token.symbol === symbol && r.type === ruleType),
    );
    if (ctx.session.watchlist.length < before) {
      await ctx.answerCallbackQuery({ text: `Removed ${symbol} alert rule.` });
      return;
    }
  }
  await ctx.answerCallbackQuery({ text: "Rule not found." });
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
  const pendingQuiet = ctx.session.pendingQuietSetting;
  if (pendingQuiet) {
    const text = ctx.message.text.trim();

    if (text === "/cancel") {
      ctx.session.pendingQuietSetting = undefined;
      await ctx.reply("Quiet hours configuration cancelled. Use /quiet to see settings.");
      return;
    }

    const match = text.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) {
      await ctx.reply("❌ Invalid format. Please enter the time as HH:MM (e.g., 23:00).\n\n(Send /cancel to abort)");
      return;
    }

    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      await ctx.reply("❌ Invalid time. Hours must be 0-23 and minutes 0-59.\n\n(Send /cancel to abort)");
      return;
    }

    const formatted = `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;

    if (pendingQuiet === "start") {
      ctx.session.quietHoursStart = formatted;
    } else {
      ctx.session.quietHoursEnd = formatted;
    }
    ctx.session.pendingQuietSetting = undefined;

    const s = ctx.session;
    const statusText = s.quietHoursEnabled
      ? `ON — ${s.quietHoursStart} to ${s.quietHoursEnd}`
      : "OFF";

    const keyboard = new InlineKeyboard();
    if (s.quietHoursEnabled) {
      keyboard.text("🔕 Disable quiet hours", "quiet:toggle").row();
    } else {
      keyboard.text("🔔 Enable quiet hours", "quiet:toggle").row();
    }
    keyboard
      .text(`⏰ Start: ${s.quietHoursStart}`, "quiet:set_start").row()
      .text(`🌅 End: ${s.quietHoursEnd}`, "quiet:set_end").row();
    if (s.quietHoursImmediate) {
      keyboard.text("⚡ Immediate: ON (tap to disable)", "quiet:toggle_immediate");
    } else {
      keyboard.text("⚡ Immediate: OFF (tap to enable)", "quiet:toggle_immediate");
    }

    await ctx.reply(
      `🌙 <b>Quiet Hours Settings</b>\n\nStatus: ${statusText}\nImmediate delivery: ${s.quietHoursImmediate ? "Yes" : "No"}\nAccumulated alerts: ${s.accumulatedAlerts.length}\n\nAlerts during quiet hours will be accumulated and delivered when quiet hours end, unless immediate delivery is enabled.`,
      { reply_markup: keyboard, parse_mode: "HTML" },
    );
    return;
  }

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

  ctx.session.watchlist = ctx.session.watchlist.filter(
    (r) => !(r.token.symbol === pending.token.symbol && r.type === pending.type),
  );
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
  onStart: async () => {
    console.log("Bot is running...");

    await connectRedis();

    startWorker(
      bot,
      () => {
        const result: { chatId: number; rules: WorkerAlertRule[]; quietHours: { enabled: boolean; start: string; end: string; immediate: boolean; timezone: string } }[] = [];
        for (const [chatId, session] of userSessions) {
          const rules = buildWatchlistRulesFromSession(session);
          if (rules.length > 0) {
            result.push({
              chatId,
              rules,
              quietHours: {
                enabled: session.quietHoursEnabled,
                start: session.quietHoursStart,
                end: session.quietHoursEnd,
                immediate: session.quietHoursImmediate,
                timezone: session.timezone,
              },
            });
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
      { ownerId: OWNER_ID, getTotalUsers: () => userSessions.size },
    );
  },
});