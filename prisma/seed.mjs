import prismaPkg from "@prisma/client";
import bcrypt from "bcryptjs";

const { PrismaClient } = prismaPkg;
const prisma = new PrismaClient();

async function main() {
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

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "administrador@campamentos.local";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "Admin1234";
  const supervisorEmail = process.env.SEED_SUPERVISOR_EMAIL ?? "supervisor@campamentos.local";
  const supervisorPassword = process.env.SEED_SUPERVISOR_PASSWORD ?? "Supervisor1234";
  const supervisorCampId = process.env.SEED_SUPERVISOR_CAMP_ID ?? "campamento-norte";

  const adminHash = await bcrypt.hash(adminPassword, 10);
  const supervisorHash = await bcrypt.hash(supervisorPassword, 10);

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      name: "Administrador Plataforma",
      role: "ADMINISTRADOR",
      passwordHash: adminHash,
      isActive: true,
      campId: null
    },
    create: {
      name: "Administrador Plataforma",
      email: adminEmail,
      role: "ADMINISTRADOR",
      passwordHash: adminHash,
      isActive: true,
      campId: null
    }
  });

  await prisma.user.upsert({
    where: { email: supervisorEmail },
    update: {
      name: "Supervisor Campamento",
      role: "SUPERVISOR",
      passwordHash: supervisorHash,
      isActive: true,
      campId: supervisorCampId
    },
    create: {
      name: "Supervisor Campamento",
      email: supervisorEmail,
      role: "SUPERVISOR",
      passwordHash: supervisorHash,
      isActive: true,
      campId: supervisorCampId
    }
  });

  await prisma.user.upsert({
    where: { email: "admin@campamentos.local" },
    update: {
      name: "Administrador Legacy",
      role: "ADMINISTRADOR",
      passwordHash: adminHash,
      isActive: true,
      campId: null
    },
    create: {
      name: "Administrador Legacy",
      email: "admin@campamentos.local",
      role: "ADMINISTRADOR",
      passwordHash: adminHash,
      isActive: true,
      campId: null
    }
  });

  await prisma.user.upsert({
    where: { email: "operador@campamentos.local" },
    update: {
      name: "Supervisor Legacy",
      role: "SUPERVISOR",
      passwordHash: supervisorHash,
      isActive: true,
      campId: supervisorCampId
    },
    create: {
      name: "Supervisor Legacy",
      email: "operador@campamentos.local",
      role: "SUPERVISOR",
      passwordHash: supervisorHash,
      isActive: true,
      campId: supervisorCampId
    }
  });
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
