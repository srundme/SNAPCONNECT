import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { loadConfig, loadDotEnv } from "@snapsocial/config";
import { getPrisma } from "@snapsocial/db";

loadDotEnv(process.cwd());
const config = loadConfig();

export const auth = betterAuth({
  appName: config.PRODUCT_NAME,
  baseURL: config.BETTER_AUTH_URL,
  secret: config.BETTER_AUTH_SECRET,
  database: prismaAdapter(getPrisma(), { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
  },
  user: {
    additionalFields: {
      platformRole: {
        type: "string",
        required: false,
        defaultValue: "STAFF",
        input: false,
      },
    },
  },
  trustedOrigins: [config.APP_BASE_URL],
  plugins: [nextCookies()],
  rateLimit: {
    window: 60,
    max: 30,
  },
});

export const productName = config.PRODUCT_NAME;
