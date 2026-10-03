import { getPrisma } from "../client";
import { seedDemo } from "../seed";

const db = getPrisma();
const result = await seedDemo(db);
console.log(JSON.stringify(result, null, 2));
await db.$disconnect();
