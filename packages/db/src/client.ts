import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

export function createPrisma(databaseUrl: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  return new PrismaClient({ adapter });
}

let cached: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  if (cached) return cached;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  cached = createPrisma(databaseUrl);
  return cached;
}

export type Db = PrismaClient;
