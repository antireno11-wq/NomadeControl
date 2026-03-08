import { execFileSync } from "node:child_process";
import prismaPkg from "@prisma/client";

const { PrismaClient } = prismaPkg;
const prisma = new PrismaClient();

const BRAND_TOKENS = new Set([
  "ACUENTA",
  "AMBROSOLI",
  "AQUARIUS",
  "BONDUELLE",
  "CALO",
  "CAROZZI",
  "CENTELLA",
  "COLUN",
  "CRISTAL",
  "CRUFI",
  "CUISINE",
  "DONA",
  "DOS",
  "EN",
  "FRUNA",
  "GOURMET",
  "HELLMANNS",
  "IDEAL",
  "JUMBO",
  "LAIVE",
  "LIDER",
  "LUCCHETTI",
  "MAGGI",
  "MALLOA",
  "MCCAY",
  "MIRAFLORES",
  "PUYEHUE",
  "RELKON",
  "VIRUTEX",
  "IANSA",
  "ICB",
  "ARDO",
  "ALMIFRUT",
  "REGIMEL",
  "LOS",
  "SILOS",
  "DON",
  "JUAN",
  "ORO",
  "VERDE",
  "JB",
  "NESTLE",
  "ORIENTE",
  "PF",
  "REGIMEL",
  "SOPROLE",
  "TALLIANI",
  "TRITON",
  "TUCAPEL",
  "WATTS",
  "ZUKO"
]);

function decodeXml(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#10;/g, " ")
    .replace(/&#13;/g, " ")
    .replace(/&#xA;/g, " ")
    .replace(/&#xD;/g, " ");
}

function readZipText(xlsxPath, entryPath) {
  return execFileSync("unzip", ["-p", xlsxPath, entryPath], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 80
  });
}

function parseSharedStrings(xml) {
  const out = [];
  const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let siMatch = siRegex.exec(xml);
  while (siMatch) {
    const siBody = siMatch[1];
    const parts = [];
    const tRegex = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let tMatch = tRegex.exec(siBody);
    while (tMatch) {
      parts.push(decodeXml(tMatch[1]));
      tMatch = tRegex.exec(siBody);
    }
    out.push(parts.join("").trim());
    siMatch = siRegex.exec(xml);
  }
  return out;
}

function parseCellText(cellXml, sharedStrings) {
  const type = /<c\b[^>]*\bt="([^"]+)"/.exec(cellXml)?.[1] ?? "";
  if (type === "inlineStr") {
    const raw = /<is\b[^>]*>[\s\S]*?<t\b[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/.exec(cellXml)?.[1] ?? "";
    return decodeXml(raw).trim();
  }

  const rawValue = /<v>([\s\S]*?)<\/v>/.exec(cellXml)?.[1]?.trim() ?? "";
  if (!rawValue) return "";
  if (type === "s") {
    const idx = Number(rawValue);
    if (!Number.isFinite(idx) || idx < 0 || idx >= sharedStrings.length) return "";
    return (sharedStrings[idx] ?? "").trim();
  }
  return decodeXml(rawValue).trim();
}

function normalizeText(text) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function stripBrand(name) {
  const noParens = name.replace(/\([^)]*\)/g, " ");
  const noAfterComma = noParens.split(",")[0] ?? noParens;
  const tokens = normalizeText(noAfterComma).split(" ").filter(Boolean);
  const firstNumericIdx = tokens.findIndex((token) => /\d/.test(token));
  const filtered = tokens.filter((token) => !BRAND_TOKENS.has(token));

  if (firstNumericIdx > 2) {
    const before = filtered.slice(0, firstNumericIdx);
    const after = filtered.slice(firstNumericIdx);
    if (before.length >= 4) {
      return [...before.slice(0, before.length - 2), ...after].join(" ").trim();
    }
    if (before.length === 3 && before[0] !== "BOLSA") {
      return [...before.slice(0, 2), ...after].join(" ").trim();
    }
  }

  return filtered.join(" ").trim();
}

function humanize(normalized) {
  return normalized
    .toLowerCase()
    .split(" ")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

function parseInventoryRows(sheetXml, sharedStrings) {
  const rows = [];
  const rowRegex = /<row\b[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch = rowRegex.exec(sheetXml);

  while (rowMatch) {
    const rowNumber = Number(rowMatch[1]);
    const rowBody = rowMatch[2];
    if (rowNumber >= 3) {
      let productRaw = "";
      let unitRaw = "";
      const cellRegex = /<c\b[^>]*\br="([A-Z]+)\d+"[^>]*>[\s\S]*?<\/c>/g;
      let cellMatch = cellRegex.exec(rowBody);
      while (cellMatch) {
        const col = cellMatch[1];
        const cellXml = cellMatch[0];
        if (col === "B") productRaw = parseCellText(cellXml, sharedStrings);
        if (col === "C") unitRaw = parseCellText(cellXml, sharedStrings);
        cellMatch = cellRegex.exec(rowBody);
      }

      if (productRaw) {
        rows.push({
          rawProduct: productRaw,
          unit: unitRaw || "unidad"
        });
      }
    }
    rowMatch = rowRegex.exec(sheetXml);
  }

  return rows;
}

function normalizeUnit(unit) {
  const value = normalizeText(unit);
  if (!value) return "unidad";
  if (value === "KG" || value === "KILO" || value === "KILO" || value === "KILOGRAMO") return "kilogramo";
  if (value === "GR" || value === "G" || value === "GRAMO") return "gramo";
  if (value === "LT" || value === "LTS" || value === "LITRO" || value === "LITROS" || value === "L") return "litro";
  if (value === "UN" || value === "UND" || value === "UNIDAD" || value === "UNIDADES") return "unidad";
  if (value === "CAJA" || value === "CJ") return "caja";
  if (value === "BOLSA" || value === "BLS") return "bolsa";
  if (value === "BOTELLA" || value === "BOTELLAS") return "botella";
  return value.toLowerCase();
}

function inferCategory(normalizedName, unit) {
  const n = normalizedName;
  const has = (text) => n.includes(text);

  if (
    has("BOLSA BASURA") ||
    has("CLORO") ||
    has("DETERGENTE") ||
    has("LAVALOZA") ||
    has("DESINFECTANTE") ||
    has("JABON") ||
    has("PAPEL HIGIENICO") ||
    has("TOALLA PAPEL") ||
    has("ESCOB") ||
    has("GUANTE")
  ) {
    return "Aseo y Limpieza";
  }

  if (
    has("BEBIDA") ||
    has("JUGO") ||
    has("AGUA") ||
    has("CAFE") ||
    has("TE ") ||
    has("TE") ||
    has("MATE")
  ) {
    return "Bebidas";
  }

  if (
    has("CARNE") ||
    has("POLLO") ||
    has("VACUNO") ||
    has("CERDO") ||
    has("JAMON") ||
    has("LONGANIZA") ||
    has("SALCHICHA") ||
    has("PAVO") ||
    has("MORTADELA")
  ) {
    return "Carnes y Embutidos";
  }

  if (
    has("LECHE") ||
    has("QUESO") ||
    has("YOGURT") ||
    has("MANTEQUILLA") ||
    has("CREMA") ||
    has("MANJAR")
  ) {
    return "Lacteos";
  }

  if (
    has("PAN") ||
    has("AMASADO") ||
    has("MARQUESA") ||
    has("TORTILLA") ||
    has("CANASTO") ||
    has("BERLIN")
  ) {
    return "Panaderia y Reposteria";
  }

  if (
    has("LECHUGA") ||
    has("TOMATE") ||
    has("CEBOLLA") ||
    has("PAPA") ||
    has("ZANAHORIA") ||
    has("APIO") ||
    has("AJO") ||
    has("AJI") ||
    has("PIMIENTO") ||
    has("COLIFLOR") ||
    has("BROCOLI") ||
    has("BETARRAGA") ||
    has("FRUTA") ||
    has("MANZANA") ||
    has("NARANJA") ||
    has("PLATANO")
  ) {
    return "Frutas y Verduras";
  }

  if (
    has("ARROZ") ||
    has("FIDEO") ||
    has("PASTA") ||
    has("LENTEJA") ||
    has("GARBANZO") ||
    has("POROTO") ||
    has("AVENA") ||
    has("AZUCAR") ||
    has("SAL ") ||
    has("HARINA") ||
    has("ACEITE") ||
    has("PURE") ||
    has("ATUN") ||
    has("MAIZ")
  ) {
    return "Abarrotes";
  }

  if (
    has("MAYONESA") ||
    has("KETCHUP") ||
    has("MOSTAZA") ||
    has("VINAGRE") ||
    has("OREGANO") ||
    has("PIMIENTA") ||
    has("AJINOMOTO") ||
    has("CURRY")
  ) {
    return "Condimentos y Salsas";
  }

  if (unit === "caja" || unit === "bolsa") {
    return "Insumos y Empaques";
  }

  return "Otros";
}

async function main() {
  const xlsxPath = process.argv[2] || process.env.INVENTORY_XLSX_PATH;
  if (!xlsxPath) {
    throw new Error("Debes indicar la ruta del XLSX. Ej: npm run inventory:import -- \"/ruta/archivo.xlsx\"");
  }

  const sharedStringsXml = readZipText(xlsxPath, "xl/sharedStrings.xml");
  const sheetXml = readZipText(xlsxPath, "xl/worksheets/sheet1.xml");
  const sharedStrings = parseSharedStrings(sharedStringsXml);
  const inventoryRows = parseInventoryRows(sheetXml, sharedStrings);

  if (inventoryRows.length === 0) {
    throw new Error("No se encontraron filas de inventario en la hoja principal.");
  }

  const dedupMap = new Map();
  for (const row of inventoryRows) {
    const clean = stripBrand(row.rawProduct);
    const normalizedName = normalizeText(clean);
    if (!normalizedName) continue;
    const unit = normalizeUnit(row.unit);
    const key = `${normalizedName}::${unit}`;
    if (!dedupMap.has(key)) {
      dedupMap.set(key, {
        name: humanize(normalizedName),
        normalizedName,
        category: inferCategory(normalizedName, unit),
        unit
      });
    }
  }

  const items = Array.from(dedupMap.values());
  if (items.length === 0) {
    throw new Error("No quedaron items validos luego de limpiar marcas.");
  }

  await prisma.inventoryItem.deleteMany({ where: { campId: null } });
  await prisma.inventoryItem.createMany({
    data: items.map((item) => ({
      campId: null,
      name: item.name,
      normalizedName: item.normalizedName,
      category: item.category,
      unit: item.unit,
      isActive: true
    }))
  });

  console.log(`Inventario importado: ${items.length} items unicos.`);
  console.log("Catalogo global actualizado (sin marcas).");
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
