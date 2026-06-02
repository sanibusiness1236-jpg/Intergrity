const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const email = "blayerzoameke@gmail.com";
  const password = "erzoameke123";

  const passwordHash = await bcrypt.hash(password, 12);

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    await prisma.user.update({
      where: { email },
      data: { isSuperAdmin: true, role: "ADMIN", isActive: true },
    });
    console.log("✓ Super admin account updated:", email);
  } else {
    await prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName: "Super",
        lastName: "Admin",
        role: "ADMIN",
        isSuperAdmin: true,
        isActive: true,
      },
    });
    console.log("✓ Super admin account created:", email);
  }
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
