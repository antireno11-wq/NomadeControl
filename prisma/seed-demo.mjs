import prismaPkg from "@prisma/client";

const { PrismaClient } = prismaPkg;
const prisma = new PrismaClient();

function toUtcDateOnly(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function seedNoise(dayOffset, campFactor) {
  const value = Math.sin((dayOffset + 1) * 1.73 + campFactor * 0.91);
  return Math.round(value * 10);
}

async function main() {
  const operator =
    (await prisma.user.findUnique({ where: { email: "operador@campamentos.local" } })) ||
    (await prisma.user.findFirst({ where: { role: "ADMIN" } }));

  if (!operator) {
    throw new Error("No hay usuarios. Ejecuta primero: npm run prisma:seed");
  }

  const camps = await prisma.camp.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
  if (camps.length === 0) {
    throw new Error("No hay campamentos activos. Ejecuta primero: npm run prisma:seed");
  }

  const days = 45;
  const now = new Date();
  const created = [];

  for (let dayOffset = days - 1; dayOffset >= 0; dayOffset -= 1) {
    const date = new Date(now);
    date.setDate(now.getDate() - dayOffset);
    const reportDate = toUtcDateOnly(date);

    for (let i = 0; i < camps.length; i += 1) {
      const camp = camps[i];
      const noise = seedNoise(dayOffset, i + 1);

      const basePeople = 95 + i * 22 + Math.round((days - dayOffset) * 0.35);
      const peopleCount = Math.max(35, basePeople + noise);

      const breakfastCount = Math.max(0, Math.round(peopleCount * (0.92 + (noise % 4) * 0.01)));
      const lunchCount = Math.max(0, Math.round(peopleCount * (0.95 + ((noise + 2) % 5) * 0.01)));
      const dinnerCount = Math.max(0, Math.round(peopleCount * (0.9 + ((noise + 1) % 6) * 0.01)));
      const snackSimpleCount = Math.max(0, Math.round(peopleCount * (0.45 + (i % 2) * 0.05)));
      const snackReplacementCount = Math.max(0, Math.round(peopleCount * (0.06 + ((noise + 1) % 3) * 0.01)));
      const lodgingCount = Math.max(0, Math.round(peopleCount * (0.78 + (i % 3) * 0.04)));
      const waterLiters = Math.max(0, Math.round(peopleCount * (13 + (i % 3)) + noise * 3));
      const fuelLiters = Math.max(0, Math.round(peopleCount * (1.4 + i * 0.12) + noise));

      await prisma.dailyReport.upsert({
        where: {
          campId_date: {
            campId: camp.id,
            date: reportDate
          }
        },
        update: {
          createdById: operator.id,
          peopleCount,
          breakfastCount,
          lunchCount,
          dinnerCount,
          snackSimpleCount,
          snackReplacementCount,
          lodgingCount,
          waterLiters,
          fuelLiters,
          extras: JSON.stringify({
            gasKg: Math.max(1, Math.round(peopleCount * 0.16 + i)),
            hygieneKits: Math.max(0, Math.round(peopleCount * 0.04))
          }),
          notes: `Demo dia ${dayOffset + 1}: operacion estable en ${camp.name}`
        },
        create: {
          date: reportDate,
          campId: camp.id,
          createdById: operator.id,
          peopleCount,
          breakfastCount,
          lunchCount,
          dinnerCount,
          snackSimpleCount,
          snackReplacementCount,
          lodgingCount,
          waterLiters,
          fuelLiters,
          extras: JSON.stringify({
            gasKg: Math.max(1, Math.round(peopleCount * 0.16 + i)),
            hygieneKits: Math.max(0, Math.round(peopleCount * 0.04))
          }),
          notes: `Demo dia ${dayOffset + 1}: operacion estable en ${camp.name}`
        }
      });

      created.push({ camp: camp.name, date: reportDate.toISOString().slice(0, 10) });
    }
  }

  console.log(`Reportes demo cargados/actualizados: ${created.length}`);
  console.log(`Campamentos: ${camps.length}, Dias: ${days}`);
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
