export interface BotConfig {
  botToken: string;
  ownerId: number;
  env: string;
  isProduction: boolean;
}

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN environment variable is required");
}

const OWNER_ID_RAW = process.env.OWNER_ID;
if (!OWNER_ID_RAW) {
  throw new Error("OWNER_ID environment variable is required");
}

const OWNER_ID = parseInt(OWNER_ID_RAW, 10);
if (isNaN(OWNER_ID)) {
  throw new Error("OWNER_ID must be a valid integer");
}

const NODE_ENV = process.env.NODE_ENV ?? "development";

export const config: BotConfig = {
  botToken: BOT_TOKEN,
  ownerId: OWNER_ID,
  env: NODE_ENV,
  isProduction: NODE_ENV === "production",
};

Object.freeze(config);
