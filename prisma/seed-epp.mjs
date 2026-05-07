import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const tiposEPP = [
  { nombre: "Casco de seguridad", descripcion: "Protección craneal clase A/B", vigenciaDias: 1825 },
  { nombre: "Zapatos de seguridad", descripcion: "Punta de acero, suela antideslizante", vigenciaDias: 365 },
  { nombre: "Guantes de cuero", descripcion: "Protección de manos trabajos generales", vigenciaDias: 180 },
  { nombre: "Guantes de nitrilo", descripcion: "Protección química y líquidos", vigenciaDias: 90 },
  { nombre: "Lentes de seguridad", descripcion: "Protección ocular antiimpacto", vigenciaDias: 365 },
  { nombre: "Protector auditivo (tapones)", descripcion: "Reducción ruido > 85 dB", vigenciaDias: 30 },
  { nombre: "Protector auditivo (orejeras)", descripcion: "Reducción ruido > 85 dB", vigenciaDias: 730 },
  { nombre: "Chaleco reflectante", descripcion: "Alta visibilidad clase 2", vigenciaDias: 365 },
  { nombre: "Arnés de seguridad", descripcion: "Trabajo en altura cuerpo completo", vigenciaDias: 1825 },
  { nombre: "Respirador media cara", descripcion: "Filtros para polvo y gases", vigenciaDias: 365 },
  { nombre: "Mascarilla N95", descripcion: "Protección partículas finas", vigenciaDias: 30 },
  { nombre: "Traje Tyvek", descripcion: "Protección materiales peligrosos", vigenciaDias: 30 },
  { nombre: "Rodilleras", descripcion: "Trabajo en superficies duras", vigenciaDias: 365 },
  { nombre: "Faja lumbar", descripcion: "Soporte para levantamiento de cargas", vigenciaDias: 365 },
];

async function main() {
  let creados = 0;
  let omitidos = 0;

  for (const tipo of tiposEPP) {
    const existe = await db.tipoEPP.findFirst({ where: { nombre: tipo.nombre } });
    if (existe) { omitidos++; continue; }
    await db.tipoEPP.create({ data: tipo });
    creados++;
  }

  console.log(`✅ EPP seed: ${creados} tipos creados, ${omitidos} ya existían.`);
}

main().catch(console.error).finally(() => db.$disconnect());
