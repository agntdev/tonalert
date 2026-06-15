import { Bot, GrammyError, HttpError, InlineKeyboard } from "grammy";

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN environment variable is required");
}

const bot = new Bot(BOT_TOKEN);

interface TokenInfo {
  symbol: string;
  name: string;
  address: string;
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

interface PriceInfo {
  symbol: string;
  price: number;
  change1h: number;
  change24h: number;
  timestamp: string;
}

function getMockPrice(symbol: string): PriceInfo | null {
  const token = MOCK_TOKENS.find(
    (t) => t.symbol.toLowerCase() === symbol.toLowerCase(),
  );
  if (!token) return null;
  const seed = token.symbol.charCodeAt(0) + token.symbol.charCodeAt(token.symbol.length - 1);
  const price = (seed / 10 + 0.5);
  return {
    symbol: token.symbol,
    price: Math.round(price * 10000) / 10000,
    change1h: Math.round(((seed % 10) - 5 + Math.random() * 2) * 100) / 100,
    change24h: Math.round(((seed % 20) - 10 + Math.random() * 4) * 100) / 100,
    timestamp: new Date().toISOString().replace("T", " ").slice(0, 19),
  };
}

bot.command("start", async (ctx) => {
  const name = ctx.from?.first_name ?? "there";
  const menu = new InlineKeyboard()
    .text("🚀 Set Alert", "menu:set_alert").row()
    .text("📊 My Alerts", "menu:my_alerts").row()
    .text("💰 Price Now", "menu:price").row()
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
    "/price <symbol> — Check the current price of a token\n" +
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
    ).text(
      `💲 Price`,
      `price:${token.symbol}`,
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

bot.command("price", async (ctx) => {
  const query = ctx.match.trim();
  if (!query) {
    const keyboard = new InlineKeyboard();
    for (const token of MOCK_TOKENS) {
      keyboard.text(`💲 ${token.symbol}`, `price:${token.symbol}`).row();
    }
    await ctx.reply(
      "Select a token to check its price:",
      { reply_markup: keyboard },
    );
    return;
  }

  const info = getMockPrice(query);
  if (!info) {
    await ctx.reply(`Token "${query}" not found. Try /price with a known symbol like TON.`);
    return;
  }

  const trend1h = info.change1h >= 0 ? "🟢" : "🔴";
  const trend24h = info.change24h >= 0 ? "🟢" : "🔴";
  await ctx.reply(
    `<b>${info.symbol}</b> Price\n\n` +
    `💰 <b>$${info.price}</b>\n\n` +
    `${trend1h} 1h: ${info.change1h >= 0 ? "+" : ""}${info.change1h}%\n` +
    `${trend24h} 24h: ${info.change24h >= 0 ? "+" : ""}${info.change24h}%\n\n` +
    `🕒 Last update: ${info.timestamp} UTC`,
    { parse_mode: "HTML" },
  );
});

bot.callbackQuery("menu:price", async (ctx) => {
  const keyboard = new InlineKeyboard();
  for (const token of MOCK_TOKENS) {
    keyboard.text(`💲 ${token.symbol}`, `price:${token.symbol}`).row();
  }
  await ctx.editMessageText(
    "Select a token to check its price:",
    { reply_markup: keyboard },
  );
  await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^price:(.+)$/, async (ctx) => {
  const symbol = ctx.match[1];
  const info = getMockPrice(symbol);
  if (!info) {
    await ctx.answerCallbackQuery({ text: `Token "${symbol}" not found.`, show_alert: true });
    return;
  }
  const trend1h = info.change1h >= 0 ? "🟢" : "🔴";
  const trend24h = info.change24h >= 0 ? "🟢" : "🔴";
  await ctx.reply(
    `<b>${info.symbol}</b> Price\n\n` +
    `💰 <b>$${info.price}</b>\n\n` +
    `${trend1h} 1h: ${info.change1h >= 0 ? "+" : ""}${info.change1h}%\n` +
    `${trend24h} 24h: ${info.change24h >= 0 ? "+" : ""}${info.change24h}%\n\n` +
    `🕒 Last update: ${info.timestamp} UTC`,
    { parse_mode: "HTML" },
  );
  await ctx.answerCallbackQuery();
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
  },
});