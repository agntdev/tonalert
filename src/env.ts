export interface EnvConfig {
  botToken: string;
  ownerId: number;
  redisUrl?: string;
  nodeEnv: string;
  isProduction: boolean;
  isDevelopment: boolean;
}

function validateEnv(): EnvConfig {
  const nodeEnv = process.env.NODE_ENV ?? "development";

  const botToken = process.env.BOT_TOKEN;
  if (!botToken) {
    throw new Error("BOT_TOKEN environment variable is required");
  }

  const ownerIdRaw = process.env.OWNER_ID;
  if (!ownerIdRaw) {
    throw new Error("OWNER_ID environment variable is required");
  }

  const ownerId = parseInt(ownerIdRaw, 10);
  if (isNaN(ownerId) || ownerId <= 0) {
    throw new Error("OWNER_ID must be a valid positive integer");
  }

  const redisUrl = process.env.REDIS_URL || undefined;

  return {
    botToken,
    ownerId,
    redisUrl,
    nodeEnv,
    isProduction: nodeEnv === "production",
    isDevelopment: nodeEnv !== "production",
  };
}

let _config: EnvConfig | null = null;

export function getConfig(): EnvConfig {
  if (!_config) {
    _config = validateEnv();
  }
  return _config;
}