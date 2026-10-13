import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { OPERATION_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDisplayDate } from "@/lib/report-utils";
import { BotonImprimir } from "./imprimir";
import { HojaCliente } from "./hoja";

/**
 * Informe diario para el cliente, con el formato REG-OP-OPE-001.
 *
 * Sale del mismo registro que carga el supervisor en la plataforma: no hay
 * un Excel aparte que llenar. Hasta ahora se cargaba dos veces y los dos
 * registros no coincidían —el 08-10-2026 diferían en basura, horómetro,
 * agua potable, aguas negras y bidones—, así que el cliente recibía números
 * distintos de los que guardaba Nómade.
 *
 * Solo lleva lo que el cliente ve en su formato. Las comidas con su reparto
 * mandante/Nómade, el equipo incompleto, cloro, pH, medidor y las
 * observaciones son internos y no aparecen.
 */

type Fila = { empresa: string; habitaciones: number };

const sinTildes = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

async function cargar(id: string) {
  return db.dailyReport.findUnique({
    where: { id },
    include: { camp: true, createdBy: { select: { name: true } } },
  });
}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const r = await cargar(params.id);
  // El título es el nombre que propone el navegador al guardar el PDF.
  return { title: r ? `Informe diario ${r.camp.name} ${formatDisplayDate(r.date)}` : "Informe diario" };
}

function num(v: number | null | undefined): string {
  if (v == null) return "—";
  return Number.isInteger(v) ? String(v) : v.toLocaleString("es-CL", { maximumFractionDigits: 1 });
}

export default async function InformeClientePage({ params }: { params: { id: string } }) {
  const user = await requireRole(OPERATION_ROLES);
  const r = await cargar(params.id);
  if (!r) notFound();

  // Quien tiene campamento asignado ve solo el suyo; la oficina central, todos.
  if (user.campId && user.campId !== r.campId) redirect("/carga-diaria");

  // El mandante sale del proyecto que se llama como el campamento. Si no hay
  // uno, se deja en blanco antes que adivinarlo.
  const proyectos = await db.proyecto.findMany({
    where: { ambito: "mandante", activo: true },
    select: { nombre: true, faena: true, mandante: { select: { nombre: true } } },
  });
  const proyecto = proyectos.find(p =>
    sinTildes(p.nombre) === sinTildes(r.camp.name) || (p.faena && sinTildes(p.faena) === sinTildes(r.camp.name)));
  const mandante = proyecto?.mandante.nombre ?? "—";

  const capacidad = r.camp.capacityPeople ?? null;
  const disponibilidad = capacidad != null ? Math.max(0, capacidad - r.peopleCount) : null;
  const internet =
    r.internetStatus === "FUNCIONANDO" ? "Sí"
    : r.internetStatus === "NO_FUNCIONA" ? "No"
    : "Con interrupciones";

  const desglose = (r.ocupacionEmpresas as unknown as Fila[] | null) ?? [];
  const servicios = (r.serviciosPlanificados ?? "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  const filas: Array<[string, string]> = [
    ["Capacidad Total del Campamento (N° de camas) [ref.]:", num(capacidad)],
    ["Ocupación Total del Campamento (N° de camas):", num(r.peopleCount)],
    ["Disponibilidad de Camas:", num(disponibilidad)],
    ["Congelamiento en Redes (Sí/No):", r.congelamiento ? "Sí" : "No"],
    ["Nivel de Contenedor de Basura (%):", `${r.wasteFillPercent}%`],
    ["Nivel de Combustible Disponible (Litros):", num(r.fuelRemainingLiters)],
    ["Horómetro Generador N° 1 (h):", num(r.generator1Hours)],
    ["Horómetro Generador N° 2 (h):", num(r.generator2Hours)],
    ["Carga de Consumos BSALE:", num(r.consumosBsale)],
    ["Estatus Starlink / Internet (Operativo Sí/No):", internet],
    ["Bidones de Agua 20 Lts — Cantidad Utilizada en el Día (unidades):", num(r.bidonesUsados)],
    ["Bidones de Agua 20 Lts — Stock Disponible (unidades):", num(r.bidonesStock)],
    ["Agua potable M3", num(r.potableWaterTankLevelM3)],
    ["Acumulacion de aguas negras m3", num(r.blackWaterTankLevelM3)],
  ];

  // Lo que falta se avisa en pantalla —no en el PDF— para completarlo antes de
  // mandarlo. En el PDF va "—": un cero inventado es peor que un hueco.
  const faltantes = [
    desglose.length === 0 ? "ocupación por empresa" : null,
    r.consumosBsale == null ? "consumos BSALE" : null,
    r.bidonesUsados == null ? "bidones usados" : null,
    r.bidonesStock == null ? "stock de bidones" : null,
    servicios.length === 0 ? "servicios planificados" : null,
    capacidad == null ? "capacidad del campamento (se configura en Administración)" : null,
  ].filter(Boolean) as string[];

  return (
    <div className="hoja-cliente" style={{ background: "#fff", color: "#000", minHeight: "100vh" }}>
      <style>{`
        @page { size: A4; margin: 14mm; }
        @media print { .no-imprimir { display: none !important; } body { background: #fff !important; } }
        .hoja-cliente table { border-collapse: collapse; }
      `}</style>

      <div className="no-imprimir" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "12px 16px", borderBottom: "1px solid #e2e8f0", background: "#f8fafc" }}>
        <BotonImprimir />
        <Link href={`/informes/${r.id}`}><button type="button" className="secondary">Volver al informe</button></Link>
        {r.createdById === user.id && (
          <Link href={`/informes/${r.id}/editar`}><button type="button" className="secondary">Corregir datos</button></Link>
        )}
        <span style={{ color: "#475569", fontSize: 13 }}>
          En el diálogo de impresión elige «Guardar como PDF».
        </span>
        {faltantes.length > 0 && (
          <div style={{ width: "100%", marginTop: 6, padding: "8px 12px", background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 8, color: "#92400e", fontSize: 13 }}>
            Falta completar: <strong>{faltantes.join(", ")}</strong>. En el PDF esos datos salen como «—».
          </div>
        )}
      </div>

      <HojaCliente
        campamento={r.camp.name}
        mandante={mandante}
        fecha={formatDisplayDate(r.date).replace(/-/g, "/")}
        supervisor={r.createdBy.name}
        filas={filas}
        desglose={desglose}
        servicios={servicios}
      />
    </div>
  );
}
