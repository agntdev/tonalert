import { Bot, GrammyError, HttpError } from "grammy";

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN environment variable is required");
}

const bot = new Bot(BOT_TOKEN);

bot.command("start", async (ctx) => {
  await ctx.reply("Welcome to TonAlert! I help you track Toncoin and TON jetton prices with custom alerts.");
});

bot.on("message", async (ctx) => {
  await ctx.reply("I didn't understand that. Type /start to begin.");
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
});

bot.start({
  onStart: () => {
    console.log("Bot is running...");
  },
});