import Link from "next/link";
import { isAdminRole, OPERATION_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { toInputDateValue } from "@/lib/report-utils";
import { ReportForm } from "@/app/dashboard/report-form";
import { NotificationBell } from "@/components/notification-bell";
import { AppShell } from "@/components/app-shell";

export default async function CargaDiariaPage() {
  const user = await requireRole(OPERATION_ROLES);
  const canSeeAdminSections = isAdminRole(user.role);
  const canEdit = !canSeeAdminSections;
  const campFilter = !canSeeAdminSections ? user.campId ?? "__none__" : undefined;

  const today = new Date();
  const todayDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  const [camps, recentReports, reportsToday] = await Promise.all([
    db.camp.findMany({
      where: {
        isActive: true,
        ...(campFilter ? { id: campFilter } : {})
      },
      orderBy: { name: "asc" }
    }),
    db.dailyReport.findMany({
      where: campFilter ? { campId: campFilter } : undefined,
      take: 15,
      orderBy: [{ date: "desc" }, { camp: { name: "asc" } }],
      include: { camp: true, createdBy: true }
    }),
    db.dailyReport.findMany({
      where: {
        ...(campFilter ? { campId: campFilter } : {}),
        date: todayDate
      },
      include: { camp: true }
    })
  ]);

  const reportedCampIdsToday = new Set(reportsToday.map((report) => report.campId));
  const missingCampsToday = camps.filter((camp) => !reportedCampIdsToday.has(camp.id));
  const notificationItems = [
    ...recentReports
      .filter((report) => Math.abs(report.generator1Hours - report.generator2Hours) > 30)
      .slice(0, 3)
      .map((report) => ({
        text: `${report.camp.name} ${toInputDateValue(report.date)}: diferencia horómetros > 30h`,
        severity: "warning" as const
      })),
    ...recentReports
      .filter((report) => report.internetStatus !== "FUNCIONANDO")
      .slice(0, 3)
      .map((report) => ({
        text: `${report.camp.name} ${toInputDateValue(report.date)}: internet ${report.internetStatus.replaceAll("_", " ").toLowerCase()}`,
        severity: "warning" as const
      }))
  ];

  return (
    <AppShell
      title="Informe diario"
      user={user}
      activeNav="carga"
      showAdminSections={canSeeAdminSections}
      notifications={notificationItems}
    >
      <div className="page-stack">
        {!canSeeAdminSections && !user.campId ? (
          <div className="alert error">Tu usuario supervisor no tiene campamento asignado. Pide al administrador que lo configure.</div>
        ) : null}

        {canSeeAdminSections ? (
          <div className="alert success">
            Vista solo lectura. Como administrador puedes revisar resúmenes e historial, pero no editar el informe diario.
          </div>
        ) : null}

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Estado de carga de hoy</h2>
          <div className="summary-grid">
            <div className="metric">
              <div className="label">Campamentos con informe hoy</div>
              <div className="value">{reportsToday.length}</div>
            </div>
            <div className="metric">
              <div className="label">Campamentos pendientes</div>
              <div className="value">{missingCampsToday.length}</div>
            </div>
          </div>
          <div className="summary-list">
            {camps.map((camp) => {
              const report = reportsToday.find((row) => row.campId === camp.id);
              return (
                <div key={camp.id} className="summary-row">
                  <div>
                    <strong>{camp.name}</strong>
                    <div style={{ color: "var(--muted)" }}>
                      {report
                        ? `${report.peopleCount} personas · ${report.breakfastCount + report.lunchCount + report.dinnerCount} comidas`
                        : "Todavía no hay informe cargado hoy"}
                    </div>
                  </div>
                  <span className={report ? "status-pill ok" : "status-pill danger"}>
                    {report ? "Cargado" : "Pendiente"}
                  </span>
                </div>
              );
            })}
            {camps.length === 0 ? <div className="alert error">No hay campamento asignado o activo para este usuario.</div> : null}
          </div>
        </div>

        {canEdit && camps.length > 0 ? (
          <ReportForm camps={camps.map((camp) => ({ id: camp.id, name: camp.name }))} defaultDate={toInputDateValue(new Date())} />
        ) : canEdit ? (
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Carga diaria</h2>
            <div className="alert error">No hay campamento asignado o activo para este usuario.</div>
          </div>
        ) : null}

        {canSeeAdminSections ? (
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Resumen ejecutivo</h2>
            <div className="summary-grid">
              <div className="metric">
                <div className="label">Personas registradas ayer</div>
                <div className="value">{reportsToday.reduce((sum, report) => sum + report.peopleCount, 0)}</div>
              </div>
              <div className="metric">
                <div className="label">Agua informada ayer</div>
                <div className="value">{reportsToday.reduce((sum, report) => sum + report.waterLiters, 0)} L</div>
              </div>
              <div className="metric">
                <div className="label">Combustible informado ayer</div>
                <div className="value">{reportsToday.reduce((sum, report) => sum + report.fuelLiters, 0)} L</div>
              </div>
            </div>
          </div>
        ) : null}

        <div className="card table-card">
          <h2 style={{ marginTop: 0 }}>Historial reciente de informes</h2>
          <div className="section-caption" style={{ marginBottom: 10 }}>
            Este bloque es solo de consulta. La carga se hace en el formulario superior.
          </div>
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Campamento</th>
                <th>Personas</th>
                <th>Comidas</th>
                <th>Colaciones</th>
                <th>Botellas</th>
                <th>Alojamientos</th>
                <th>Lectura medidor</th>
                <th>Horómetro G1</th>
                <th>Horómetro G2</th>
                <th>Internet</th>
                <th>Aguas negras</th>
                <th>Agua potable</th>
                <th>Agua gastada</th>
                <th>Combustible</th>
                <th>Basura</th>
                <th>Cloro</th>
                <th>pH</th>
              </tr>
            </thead>
            <tbody>
              {recentReports.map((report) => (
                <tr key={report.id}>
                  <td>{toInputDateValue(report.date)}</td>
                  <td>{report.camp.name}</td>
                  <td>{report.peopleCount}</td>
                  <td>{report.breakfastCount + report.lunchCount + report.dinnerCount}</td>
                  <td>{report.snackSimpleCount + report.snackReplacementCount}</td>
                  <td>{report.waterBottleCount}</td>
                  <td>{report.lodgingCount}</td>
                  <td>{report.meterReading.toFixed(2)}</td>
                  <td>{report.generator1Hours.toFixed(2)}</td>
                  <td>{report.generator2Hours.toFixed(2)}</td>
                  <td>{report.internetStatus.replaceAll("_", " ")}</td>
                  <td>{report.blackWaterRemoved ? `${report.blackWaterRemovedM3.toFixed(2)} m3` : "No"}</td>
                  <td>{report.potableWaterDelivered ? `${report.potableWaterDeliveredM3.toFixed(2)} m3` : "No"}</td>
                  <td>{report.waterLiters} L</td>
                  <td>{report.fuelLiters} L</td>
                  <td>{report.wasteFillPercent}%</td>
                  <td>{report.chlorineLevel.toFixed(2)}</td>
                  <td>{report.phLevel.toFixed(2)}</td>
                </tr>
              ))}
              {recentReports.length === 0 ? (
                <tr>
                  <td colSpan={18} style={{ color: "var(--muted)" }}>
                    Aún no hay informes registrados.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
