/**
 * One-shot cleanup: convert empty-string user fields to NULL so that the
 * unique constraint on `studentId` no longer collides for non-student users
 * that were registered before the controller fix. Safe to re-run.
 */
const prisma = require("../src/config/db");

async function run() {
  const result = await prisma.$executeRawUnsafe(`
    UPDATE users
       SET "studentId" = NULL
     WHERE "studentId" = ''
        OR (role <> 'STUDENT' AND "studentId" IS NOT NULL AND "studentId" = '')
  `);
  const r2 = await prisma.$executeRawUnsafe(`UPDATE users SET program = NULL WHERE program = ''`);
  const r3 = await prisma.$executeRawUnsafe(`UPDATE users SET gender = NULL WHERE gender = ''`);
  const r4 = await prisma.$executeRawUnsafe(`UPDATE users SET "institutionId" = NULL WHERE "institutionId" = ''`);

  console.log("Cleared blank studentId rows:", result);
  console.log("Cleared blank program rows :", r2);
  console.log("Cleared blank gender rows  :", r3);
  console.log("Cleared blank institutionId:", r4);
}

run()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
