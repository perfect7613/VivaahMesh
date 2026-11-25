import { seedRehearsalWedding } from "../src/lib/server/rehearsal-wedding";

async function main() {
  const [owner, ...extra] = process.argv.slice(2);
  if (!/^\d+$/.test(owner ?? "") || extra.length) throw new Error("Usage: npm run seed:wedding -- <organizer-telegram-id>");
  const result = await seedRehearsalWedding(Number(owner), process.env.TELEGRAM_BOT_USERNAME ?? "");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Could not create rehearsal wedding");
  process.exitCode = 1;
});
