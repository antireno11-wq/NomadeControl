import pg from "pg";

const { Client } = pg;

const DB_URL = "postgresql://postgres:rOoybnoElITtxZUdjtkbecAGtdfVtzMt@switchback.proxy.rlwy.net:48957/railway";

function toTitleCase(str) {
  return str
    .toLowerCase()
    .split(" ")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
    .trim();
}

function parseDate(str) {
  if (!str || str === "NaN" || str === "nan") return null;
  // Format: DD/MM/YYYY
  const parts = str.toString().split("/");
  if (parts.length !== 3) return null;
  return new Date(`${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}T12:00:00Z`);
}

const personal = [
  { rut: "13.327.904-0", nombres: "MARIA ALEJANDRA", apPaterno: "PALLAUTA",    apMaterno: "PALLAUTA",  cargo: "CAMPAMENTERA",               contrato: "PlazoFijo",  inicio: "28/01/2026", termino: "27/04/2026" },
  { rut: "15.966.985-8", nombres: "CRISTIAN GALLARDO", apPaterno: "PARDO",      apMaterno: "GALLARDO",  cargo: "MAESTRO DE COCINA",           contrato: "PlazoFijo",  inicio: "05/02/2026", termino: "30/04/2026" },
  { rut: "12.647.280-3", nombres: "MARCELO ALEJANDRO", apPaterno: "ARRIAGADA",  apMaterno: "BUSTOS",    cargo: "CONDUCTOR-ABASTECEDOR",       contrato: "PlazoFijo",  inicio: "10/02/2026", termino: "10/05/2026" },
  { rut: "13.745.098-4", nombres: "JAQUELINE ANGELICA", apPaterno: "BORDONES",  apMaterno: "CAYO",      cargo: "CAMPAMENTERA",                contrato: "PlazoFijo",  inicio: "07/02/2026", termino: "07/05/2026" },
  { rut: "10.456.258-2", nombres: "REBECA ALICIA",      apPaterno: "MARIANJEL", apMaterno: "MEJIAS",    cargo: "CAMPAMENTERA",                contrato: "PlazoFijo",  inicio: "05/02/2026", termino: "05/05/2026" },
  { rut: "19.466.913-5", nombres: "GABRIELA DENISSE",   apPaterno: "ROJAS",     apMaterno: "MUÑOZ",     cargo: "AYUDANTE COCINA",             contrato: "PlazoFijo",  inicio: "04/02/2026", termino: "05/03/2026" },
  { rut: "14.300.720-0", nombres: "CARLA ELIANA",       apPaterno: "ZEGPI",     apMaterno: "BRIONES",   cargo: "MAESTRA DE COCINA",           contrato: "PlazoFijo",  inicio: "10/02/2026", termino: "10/05/2026" },
  { rut: "20.960.987-8", nombres: "SEBASTIAN ANTONIO",  apPaterno: "SALGADO",   apMaterno: "MILANEZ",   cargo: "AYUDANTE DE COCINA",          contrato: "PlazoFijo",  inicio: "15/02/2026", termino: "15/05/2026" },
  { rut: "16.771.587-7", nombres: "YERKO SEBASTIAN",    apPaterno: "HIDALGO",   apMaterno: "GAHONA",    cargo: "ADMINISTRADOR DE CAMPAMENTO", contrato: "Indefinido", inicio: "14/09/2020", termino: null },
  { rut: "11.882.696-5", nombres: "JOHNNY LUIS",        apPaterno: "MOLINA",    apMaterno: "LEIVA",     cargo: "CONDUCTOR - ABASTECEDOR",     contrato: "Indefinido", inicio: "26/08/2020", termino: null },
  { rut: "13.506.583-8", nombres: "FABIAN ALEJANDRO",   apPaterno: "ARAVENA",   apMaterno: "ARAVENA",   cargo: "ADMINISTRADOR DE CAMPAMENTO", contrato: "PlazoFijo",  inicio: "15/03/2026", termino: "17/03/2026" },
  { rut: "12.807.455-4", nombres: "LESLIE ANGELICA",    apPaterno: "JERALDO",   apMaterno: "ROJAS",     cargo: "CAMPAMENTERA",                contrato: "PlazoFijo",  inicio: "23/03/2026", termino: "21/04/2026" },
  { rut: "18.494.107-4", nombres: "KATERINE ALEJANDRA", apPaterno: "RAMOS",     apMaterno: "ROJO",      cargo: "AYUDANTE DE COCINA",          contrato: "PlazoFijo",  inicio: "20/03/2026", termino: "18/04/2026" },
  { rut: "19.322.019-3", nombres: "ANGELA",             apPaterno: "ADAROS",    apMaterno: "ROJAS",     cargo: "AYUDANTE DE COCINA",          contrato: "PlazoFijo",  inicio: "10/03/2026", termino: "08/04/2026" },
  { rut: "25.990.343-2", nombres: "JUAN CARLOS",        apPaterno: "CONDORI",   apMaterno: "TICONA",    cargo: "CAMPAMENTERO",                contrato: "PlazoFijo",  inicio: "25/03/2026", termino: "27/04/2026" },
  { rut: "20.166.822-0", nombres: "NICOLAS ALEJANDRO",  apPaterno: "VALENCIA",  apMaterno: "CASTILLO",  cargo: "AYUDANTE DE COCINA",          contrato: "PlazoFijo",  inicio: "10/03/2026", termino: "08/04/2026" },
  { rut: "20.240.264-K", nombres: "JORGE IGNACIO",      apPaterno: "PEÑAILILLO",apMaterno: "REYES",     cargo: "CAMPAMENTERO",                contrato: "PlazoFijo",  inicio: "03/03/2026", termino: "07/03/2026" },
  { rut: "16.017.916-3", nombres: "JUAN EDUARDO",       apPaterno: "LATORRE",   apMaterno: "VENEGAS",   cargo: "ADMINISTRADOR DE CAMPAMENTO", contrato: "PlazoFijo",  inicio: "04/03/2026", termino: "08/03/2026" },
];

async function main() {
  const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  // Get Filo Sur camp
  const campRes = await client.query(`SELECT id, name FROM "Camp" WHERE name ILIKE '%filo sur%' LIMIT 1`);
  if (campRes.rows.length === 0) {
    console.error("❌ Campamento 'Filo Sur' no encontrado");
    await client.end();
    process.exit(1);
  }
  const camp = campRes.rows[0];
  console.log(`✅ Campamento encontrado: ${camp.name} (${camp.id})`);

  // Get admin user as createdBy
  const userRes = await client.query(`SELECT id, name FROM "User" WHERE role IN ('ADMINISTRADOR','ADMIN') AND "isActive" = true ORDER BY "createdAt" LIMIT 1`);
  if (userRes.rows.length === 0) {
    console.error("❌ No se encontró usuario administrador");
    await client.end();
    process.exit(1);
  }
  const adminUser = userRes.rows[0];
  console.log(`✅ Creado por: ${adminUser.name} (${adminUser.id})`);

  // Check existing staff to avoid duplicates
  const existingRes = await client.query(`SELECT "nationalId", "fullName" FROM "StaffMember" WHERE "campId" = $1`, [camp.id]);
  const existingRuts = new Set(existingRes.rows.map(r => r.nationalId));
  const existingNames = new Set(existingRes.rows.map(r => r.fullName));

  let inserted = 0, skipped = 0;

  for (const p of personal) {
    const fullName = toTitleCase(`${p.nombres} ${p.apPaterno} ${p.apMaterno}`);
    const nationalId = p.rut;
    const shiftStartDate = parseDate(p.inicio);
    const contractEndDate = parseDate(p.termino);

    if (existingRuts.has(nationalId) || existingNames.has(fullName)) {
      console.log(`⚠️  Omitido (ya existe): ${fullName}`);
      skipped++;
      continue;
    }

    const id = `c${Math.random().toString(36).slice(2, 22)}`;
    const now = new Date().toISOString();

    await client.query(`
      INSERT INTO "StaffMember" (
        id, "campId", "createdById", "fullName", role, "employerCompany",
        "nationalId", "contractEndDate", "shiftPattern", "shiftWorkDays",
        "shiftOffDays", "shiftStartDate", "isActive", notes, "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16
      )
    `, [
      id,
      camp.id,
      adminUser.id,
      fullName,
      toTitleCase(p.cargo),
      "OP Filo Sur",
      nationalId,
      contractEndDate,
      "14x14",
      14,
      14,
      shiftStartDate,
      true,
      p.contrato === "Indefinido" ? "Contrato indefinido" : `Contrato plazo fijo`,
      now,
      now,
    ]);

    console.log(`✅ Insertado: ${fullName} — ${toTitleCase(p.cargo)}`);
    inserted++;
  }

  console.log(`\n📊 Resultado: ${inserted} insertados, ${skipped} omitidos`);
  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
