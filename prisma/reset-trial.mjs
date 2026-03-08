import prismaPkg from "@prisma/client";
import bcrypt from "bcryptjs";

const { PrismaClient } = prismaPkg;
const prisma = new PrismaClient();

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "administrador@campamentos.local";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "Admin1234";
  const supervisorEmail = process.env.SEED_SUPERVISOR_EMAIL ?? "supervisor@campamentos.local";
  const supervisorPassword = process.env.SEED_SUPERVISOR_PASSWORD ?? "Supervisor1234";

  const adminHash = await bcrypt.hash(adminPassword, 10);
  const supervisorHash = await bcrypt.hash(supervisorPassword, 10);

  await prisma.session.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.inventoryItem.deleteMany();
  await prisma.dailyReport.deleteMany();
  await prisma.dailyTaskControl.deleteMany();
  await prisma.user.deleteMany();
  await prisma.camp.deleteMany();

  const camp = await prisma.camp.create({
    data: {
      id: "campamento-filo-sur",
      name: "Campamento Filo Sur",
      location: "Filo Sur",
      isActive: true
    }
  });

  await prisma.user.create({
    data: {
      name: "Administrador Plataforma",
      email: adminEmail,
      role: "ADMINISTRADOR",
      isActive: true,
      campId: null,
      passwordHash: adminHash
    }
  });

  await prisma.user.create({
    data: {
      name: "Supervisor Filo Sur",
      email: supervisorEmail,
      role: "SUPERVISOR",
      isActive: true,
      campId: camp.id,
      passwordHash: supervisorHash
    }
  });

  console.log("Reset de prueba aplicado.");
  console.log(`Campamento creado: ${camp.name}`);
  console.log(`Admin: ${adminEmail}`);
  console.log(`Supervisor: ${supervisorEmail}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
