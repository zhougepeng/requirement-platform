import "server-only";

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { requirementPlatformPrisma?: PrismaClient };

export const prisma = globalForPrisma.requirementPlatformPrisma ?? new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
});

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.requirementPlatformPrisma = prisma;
}
