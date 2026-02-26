import prismaPkg from "@prisma/client";
import bcrypt from "bcryptjs";

const { PrismaClient } = prismaPkg;
const prisma = new PrismaClient();

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@campamentos.local";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "Admin1234";

  const adminHash = await bcrypt.hash(adminPassword, 10);

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      name: "Administrador General",
      role: "ADMIN",
      passwordHash: adminHash
    },
    create: {
      name: "Administrador General",
      email: adminEmail,
      role: "ADMIN",
      passwordHash: adminHash
    }
  });

  const operatorHash = await bcrypt.hash("Operador1234", 10);

  await prisma.user.upsert({
    where: { email: "operador@campamentos.local" },
    update: {
      name: "Operador Base",
      role: "OPERADOR",
      passwordHash: operatorHash
    },
    create: {
      name: "Operador Base",
      email: "operador@campamentos.local",
      role: "OPERADOR",
      passwordHash: operatorHash
    }
  });

  const defaultCamps = [
    { name: "Campamento Norte", location: "Zona Norte" },
    { name: "Campamento Sur", location: "Zona Sur" }
  ];

  for (const camp of defaultCamps) {
    await prisma.camp.upsert({
      where: { id: `${camp.name.toLowerCase().replace(/\s+/g, "-")}` },
      update: {},
      create: {
        id: `${camp.name.toLowerCase().replace(/\s+/g, "-")}`,
        ...camp
      }
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
