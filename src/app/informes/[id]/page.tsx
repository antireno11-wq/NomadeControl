import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isAdminRole, OPERATION_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { toInputDateValue } from "@/lib/report-utils";
import { AppShell } from "@/components/app-shell";

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

  if (!canSeeAdminSections && user.campId !== report.campId) {
    redirect("/dashboard");
  }

  return (
    <AppShell
      title="Detalle informe"
      user={user}
      activeNav={canSeeAdminSections ? "dashboard" : "carga"}
      showAdminSections={canSeeAdminSections}
      rightSlot={
        <Link href="/dashboard">
          <button type="button" className="secondary">Volver</button>
        </Link>
      }
    >
      <div className="page-stack">
        <div className="dashboard-panel">
          <div className="dashboard-panel-header">
            <h2>{report.camp.name}</h2>
            <span className="dashboard-chip">{toInputDateValue(report.date)}</span>
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
              <div className="label">Alojamientos</div>
              <div className="value">{report.lodgingCount}</div>
            </div>
          </div>
        </div>

        <div className="grid two">
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Alimentación</h2>
            <table>
              <tbody>
                <tr><th>Desayunos</th><td>{report.breakfastCount}</td></tr>
                <tr><th>Almuerzos</th><td>{report.lunchCount}</td></tr>
                <tr><th>Cenas</th><td>{report.dinnerCount}</td></tr>
                <tr><th>Colación simple</th><td>{report.snackSimpleCount}</td></tr>
                <tr><th>Colación reemplazo</th><td>{report.snackReplacementCount}</td></tr>
              </tbody>
            </table>
          </div>

          <div className="card">
            <h2 style={{ marginTop: 0 }}>Operación</h2>
            <table>
              <tbody>
                <tr><th>Lectura medidor</th><td>{report.meterReading.toFixed(2)}</td></tr>
                <tr><th>Agua gastada (calculada)</th><td>{report.waterLiters} L</td></tr>
                <tr><th>Combustible</th><td>{report.fuelLiters} L</td></tr>
                <tr><th>Internet</th><td>{report.internetStatus.replaceAll("_", " ")}</td></tr>
                <tr><th>Retiro aguas negras</th><td>{report.blackWaterRemoved ? "Si" : "No"}</td></tr>
                <tr><th>Aguas negras retiradas</th><td>{report.blackWaterRemovedM3.toFixed(2)} m3</td></tr>
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
