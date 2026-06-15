import { Bot, GrammyError, HttpError, InlineKeyboard } from "grammy";

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN environment variable is required");
}

const bot = new Bot(BOT_TOKEN);

bot.command("start", async (ctx) => {
  const name = ctx.from?.first_name ?? "there";
  const fiatMenu = new InlineKeyboard()
    .text("🇺🇸 USD", "onboard:fiat:USD").row()
    .text("🇪🇺 EUR", "onboard:fiat:EUR").row()
    .text("🇬🇧 GBP", "onboard:fiat:GBP").row()
    .text("🇯🇵 JPY", "onboard:fiat:JPY");

  await ctx.reply(
    `Welcome to TonAlert, ${name}! 🎉\n\nI help you track Toncoin and TON jetton prices with custom alerts. First, please select your preferred fiat currency (default: USD):`,
    { reply_markup: fiatMenu },
  );
});

bot.callbackQuery(/^onboard:fiat:(.+)$/, async (ctx) => {
  const fiat = ctx.match[1];
  await ctx.editMessageReplyMarkup(undefined);
  await ctx.reply(
    `Got it! Your preferred fiat is set to ${fiat}.`,
  );
  await ctx.answerCallbackQuery();
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