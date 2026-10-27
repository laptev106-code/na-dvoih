export const ENV = {
  appId: process.env.MANUS_PROJECT_ID ?? process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.MANUS_JWT_SECRET ?? process.env.JWT_SECRET ?? "",
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "8779627317:AAFaz64bHzJmq_iRoM1q6WHSxocU0xlgUMI",
  adminChatId: process.env.ADMIN_CHAT_ID ?? process.env.FEEDBACK_CHANNEL_ID ?? "136681806",
  adminUsername: process.env.ADMIN_USERNAME ?? "Lomayderevo",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.MANUS_OAUTH_API_URL ?? process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
};
