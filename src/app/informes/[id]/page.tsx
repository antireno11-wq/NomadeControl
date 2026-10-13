import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isAdminRole, OPERATION_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDisplayDate } from "@/lib/report-utils";
import { AppShell } from "@/components/app-shell";
import { proyeccionesInternas } from "@/lib/informe-cliente";

export default async function InformeDetallePage({ params }: { params: { id: string } }) {
  const user = await requireRole(OPERATION_ROLES);
  const canSeeAdminSections = isAdminRole(user.role);

  const report = await db.dailyReport.findUnique({
    where: { id: params.id },
    include: { camp: true, createdBy: true }
  });

  if (!report) {
    notFound();
  }

  // Quien tiene campamento asignado ve solo el suyo; la oficina central
  // —operativos sin campamento—, todos. Antes se rebotaba a cualquier
  // operativo sin campamento, y encima al dashboard, que está desactivado.
  if (!canSeeAdminSections && user.campId && user.campId !== report.campId) {
    redirect("/carga-diaria");
  }

  const canEditOwnReport = !canSeeAdminSections && report.createdById === user.id;

  // Proyecciones de autonomía con los informes hasta este día. Son de uso
  // interno: el informe del cliente no las lleva.
  const historia = await db.dailyReport.findMany({
    where: { campId: report.campId, date: { lte: report.date } },
    orderBy: { date: "desc" },
    take: 8,
    select: {
      date: true, peopleCount: true, fuelLiters: true, fuelRemainingLiters: true,
      generator1Hours: true, generator2Hours: true, potableWaterTankLevelM3: true,
      blackWaterTankLevelM3: true, blackWaterRemovedM3: true, potableWaterDeliveredM3: true,
      waterLiters: true, wasteFillPercent: true,
    },
  });
  const proyecciones = proyeccionesInternas(historia, { aguaNegrasM3: report.camp.blackWaterTankCapacityM3 });

  return (
    <AppShell
      title="Detalle informe"
      user={user}
      activeNav={canSeeAdminSections ? "dashboard" : "carga"}
      showAdminSections={canSeeAdminSections}
      rightSlot={
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href={`/informes/${report.id}/cliente`}>
            <button type="button">Informe para el cliente</button>
          </Link>
          {canEditOwnReport ? (
            <Link href={`/informes/${report.id}/editar`}>
              <button type="button" className="secondary">Editar</button>
            </Link>
          ) : null}
          <Link href={canSeeAdminSections ? "/dashboard" : "/carga-diaria"}>
            <button type="button" className="secondary">Volver</button>
          </Link>
        </div>
      }
    >
      <div className="page-stack">
        <div className="dashboard-panel">
          <div className="dashboard-panel-header">
            <h2>{report.camp.name}</h2>
            <span className="dashboard-chip">{formatDisplayDate(report.date)}</span>
          </div>
          <div className="summary-grid">
            <div className="metric">
              <div className="label">Personas</div>
              <div className="value">{report.peopleCount}</div>
            </div>
            <div className="metric">
              <div className="label">Comidas</div>
              <div className="value">{report.breakfastCount + report.lunchCount + report.dinnerCount}</div>
            </div>
            <div className="metric">
              <div className="label">Botellas agua</div>
              <div className="value">{report.waterBottleCount}</div>
            </div>
            <div className="metric">
              <div className="label">Equipo de servicio</div>
              <div className="value" style={{ color: report.equipoCompleto ? "#146c3d" : "#9e2f23", fontSize: "1rem" }}>
                {report.equipoCompleto ? "Completo" : `Falta: ${report.cargoFaltante ?? "sin especificar"}`}
              </div>
            </div>
          </div>
        </div>

        <div className="card" style={{ borderLeft: "4px solid #64748b" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
            <h2 style={{ margin: 0 }}>Proyecciones</h2>
            <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", background: "#f1f5f9", borderRadius: 999, padding: "2px 10px" }}>
              Uso interno · no salen en el informe del cliente
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10, marginTop: 12 }}>
            {proyecciones.map(p => {
              const critico = p.dias != null && p.dias < 3;
              return (
                <div key={p.nombre} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px" }}>
                  <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>{p.nombre}</div>
                  <div style={{ fontSize: "1.4rem", fontWeight: 700, marginTop: 2 }}>
                    {p.dias == null ? "—" : `${p.dias.toLocaleString("es-CL", { maximumFractionDigits: 1 })} días`}
                  </div>
                  {critico && (
                    <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#b91c1c", marginTop: 2 }}>⚠ Menos de 3 días</div>
                  )}
                  <div style={{ fontSize: "0.72rem", color: "var(--muted)", marginTop: 4, lineHeight: 1.35 }}>{p.base}</div>
                </div>
              );
            })}
          </div>
          <div className="section-caption" style={{ marginTop: 8 }}>
            Con la mediana de los últimos informes, para que un dato mal cargado no arrastre la estimación. Con menos de tres datos no se proyecta.
          </div>
        </div>

        <div className="grid two">
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Alimentación</h2>
            <table>
              <thead>
                <tr><th></th><th>Mandante</th><th>Nómade</th><th>Total</th></tr>
              </thead>
              <tbody>
                <tr><th>Desayunos</th><td>{report.breakfastMandante}</td><td>{report.breakfastNomade}</td><td><strong>{report.breakfastCount}</strong></td></tr>
                <tr><th>Almuerzos</th><td>{report.lunchMandante}</td><td>{report.lunchNomade}</td><td><strong>{report.lunchCount}</strong></td></tr>
                <tr><th>Cenas</th><td>{report.dinnerMandante}</td><td>{report.dinnerNomade}</td><td><strong>{report.dinnerCount}</strong></td></tr>
                <tr><th>Colación simple</th><td>{report.snackSimpleMandante}</td><td>{report.snackSimpleNomade}</td><td><strong>{report.snackSimpleCount}</strong></td></tr>
                <tr><th>Colación reemplazo</th><td>{report.snackReplacementMandante}</td><td>{report.snackReplacementNomade}</td><td><strong>{report.snackReplacementCount}</strong></td></tr>
              </tbody>
            </table>
            <div className="section-caption" style={{ marginTop: 6 }}>Se factura la columna Mandante.</div>
          </div>

          <div className="card">
            <h2 style={{ marginTop: 0 }}>Operación</h2>
            <table>
              <tbody>
                <tr><th>Lectura medidor</th><td>{report.meterReading.toFixed(2)}</td></tr>
                <tr><th>Agua gastada (calculada)</th><td>{report.waterLiters} L</td></tr>
                <tr><th>Combustible</th><td>{report.fuelLiters} L</td></tr>
                <tr><th>Internet</th><td>{report.internetStatus.replaceAll("_", " ")}</td></tr>
                <tr><th>Nivel estanque aguas negras</th><td>{report.blackWaterTankLevelM3 != null ? `${report.blackWaterTankLevelM3} m³` : "—"}{report.blackWaterTankLevelPercent ? ` (${report.blackWaterTankLevelPercent}%)` : ""}</td></tr>
                <tr><th>Retiro aguas negras</th><td>{report.blackWaterRemoved ? "Si" : "No"}</td></tr>
                <tr><th>Aguas negras retiradas</th><td>{report.blackWaterRemovedM3.toFixed(2)} m3</td></tr>
                <tr><th>Nivel estanque agua potable</th><td>{report.potableWaterTankLevelM3 != null ? `${report.potableWaterTankLevelM3} m³` : "—"}{report.potableWaterTankLevelPercent ? ` (${report.potableWaterTankLevelPercent}%)` : ""}</td></tr>
                <tr><th>Congelamiento</th><td style={{ color: report.congelamiento ? "#0369a1" : undefined, fontWeight: report.congelamiento ? 700 : undefined }}>{report.congelamiento ? `Sí — ${report.congelamientoDetalle}` : "No"}</td></tr>
                <tr><th>Ingreso agua potable</th><td>{report.potableWaterDelivered ? "Si" : "No"}</td></tr>
                <tr><th>Agua potable ingresada</th><td>{report.potableWaterDeliveredM3.toFixed(2)} m3</td></tr>
                <tr><th>Basura</th><td>{report.wasteFillPercent}%</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid two">
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Generadores</h2>
            <table>
              <tbody>
                <tr><th>Horómetro G1</th><td>{report.generator1Hours.toFixed(2)} h</td></tr>
                <tr><th>Horómetro G2</th><td>{report.generator2Hours.toFixed(2)} h</td></tr>
              </tbody>
            </table>
          </div>

          <div className="card">
            <h2 style={{ marginTop: 0 }}>Agua sanitaria</h2>
            <table>
              <tbody>
                <tr><th>Cloro</th><td>{report.chlorineLevel.toFixed(2)}</td></tr>
                <tr><th>pH</th><td>{report.phLevel.toFixed(2)}</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Registro</h2>
          <div className="section-caption">
            Cargado por {report.createdBy.name}
          </div>
          <div style={{ marginTop: 12 }}>
            <label>Observaciones</label>
            <div className="report-section">{report.notes?.trim() ? report.notes : "Sin observaciones."}</div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
