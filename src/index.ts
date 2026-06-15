import { Bot, Context, GrammyError, HttpError, InlineKeyboard, SessionFlavor, session } from "grammy";

interface WatchEntry {
  token: string;
  symbol: string;
  rule: { type: string; value?: number };
}

interface SessionData {
  watchlist: WatchEntry[];
}

type MyContext = Context & SessionFlavor<SessionData>;

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN environment variable is required");
}

const bot = new Bot<MyContext>(BOT_TOKEN);

bot.use(
  session({
    initial: (): SessionData => ({ watchlist: [] }),
  }),
);

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
    "/help — Show this help message\n" +
    "/list — View your watchlist",
  );
});

bot.command("list", async (ctx) => {
  if (ctx.session.watchlist.length === 0) {
    await ctx.reply(
      "Your watchlist is empty. Use /add to start tracking tokens.",
    );
    return;
  }

  const lines = ctx.session.watchlist.map((entry, i) => {
    const ruleDesc = entry.rule.type === "above"
      ? `> $${entry.rule.value}`
      : entry.rule.type === "below"
        ? `< $${entry.rule.value}`
        : entry.rule.type === "move"
          ? `±${entry.rule.value}% in 1h`
          : "no rule";
    return `${i + 1}. ${entry.symbol} (${entry.token}) — ${ruleDesc}`;
  });

  const keyboard = new InlineKeyboard();
  ctx.session.watchlist.forEach((_, i) => {
    keyboard
      .text("Price now", `list:price:${i}`)
      .text("Edit rule", `list:edit:${i}`)
      .text("Remove", `list:remove:${i}`)
      .row();
  });

  await ctx.reply(
    "📊 Your Watchlist\n\n" + lines.join("\n"),
    { reply_markup: keyboard },
  );
});

bot.callbackQuery(/^list:price:/, async (ctx) => {
  await ctx.answerCallbackQuery({ text: "Price check coming soon." });
});

bot.callbackQuery(/^list:edit:/, async (ctx) => {
  await ctx.answerCallbackQuery({ text: "Rule editing coming soon." });
});

bot.callbackQuery(/^list:remove:/, async (ctx) => {
  const idx = Number(ctx.callbackQuery.data.split(":")[2]);
  if (idx >= 0 && idx < ctx.session.watchlist.length) {
    const removed = ctx.session.watchlist.splice(idx, 1)[0];
    await ctx.answerCallbackQuery({ text: `${removed.symbol} removed.` });
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    await ctx.editMessageText(
      ctx.callbackQuery.message?.text
        ? ctx.callbackQuery.message.text + `\n\nRemoved ${removed.symbol}.`
        : `${removed.symbol} removed.`,
    );
  } else {
    await ctx.answerCallbackQuery({ text: "Item not found." });
  }
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