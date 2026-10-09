import { randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { loadDotEnv } from "@snapsocial/config";
import { getPrisma, seedDemo } from "@snapsocial/db";

loadDotEnv(process.cwd());

const email = process.argv.find((arg) => arg.startsWith("--email="))?.slice("--email=".length) ?? process.env.BOOTSTRAP_OWNER_EMAIL;
if (!email) {
  console.error("Pass --email=owner@example.com");
  process.exit(1);
}
const db = getPrisma();
const existing = await db.user.findFirst({ where: { platformRole: "SUPER_ADMIN" } });
if (existing) {
  console.error("A platform owner already exists.");
  process.exit(1);
}
const seeded = await seedDemo(db);
const password = randomBytes(18).toString("base64url");
const userId = randomUUID();
await db.user.create({
  data: {
    id: userId,
    name: "Platform owner",
    email: email.toLowerCase(),
    emailVerified: true,
    platformRole: "SUPER_ADMIN",
  },
});
await db.account.create({
  data: {
    id: randomUUID(),
    accountId: userId,
    providerId: "credential",
    userId,
    password: await hashPassword(password),
  },
});
await db.membership.create({ data: { workspaceId: seeded.workspaceId, userId, role: "ADMIN" } });
// The web start script runs this on every start, so a password printed there would land in hosted logs.
if (process.stdout.isTTY) {
  console.log(JSON.stringify({ email: email.toLowerCase(), password, simulationWorkspaceId: seeded.workspaceId, integrationWorkspaceId: seeded.ownWorkspaceId }, null, 2));
} else {
  console.log(JSON.stringify({ email: email.toLowerCase(), simulationWorkspaceId: seeded.workspaceId, integrationWorkspaceId: seeded.ownWorkspaceId, note: "Platform owner created. The password was not printed because output is not a terminal." }, null, 2));
}
await db.$disconnect();
