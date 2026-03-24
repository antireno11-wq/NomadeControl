import Link from "next/link";
import Image from "next/image";
import { isAdminRole, requireRole, SUPERVISOR_ROLES } from "@/lib/auth";
import { db } from "@/lib/db";
import { toInputDateValue } from "@/lib/report-utils";
import { logoutAction } from "@/app/dashboard/actions";
import { ReportForm } from "@/app/dashboard/report-form";
import { OpsNav } from "@/components/ops-nav";
import { NotificationBell } from "@/components/notification-bell";

export default async function CargaDiariaPage() {
  const user = await requireRole(SUPERVISOR_ROLES);
  const canSeeAdminSections = isAdminRole(user.role);
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
    <main>
      <div className="header">
        <div>
          <div className="brand-inline">
            <Link href="/" aria-label="Ir al inicio">
              <Image src="/nomade-logo-v2.png" alt="Logo Nomade" width={120} height={120} priority />
            </Link>
          </div>
          <h1>Informe diario de consumos</h1>
          <div style={{ color: "var(--muted)", fontSize: "0.92rem" }}>
            Sesión: {user.name} ({user.role})
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Link href="/mi-perfil" className="menu-item">
            Mi perfil
          </Link>
          <NotificationBell items={notificationItems} />
          <form action={logoutAction}>
            <button className="danger" type="submit">
              Cerrar sesión
            </button>
          </form>
        </div>
      </div>

      <OpsNav active="carga" showAdminSections={canSeeAdminSections} />

      <div className="page-stack">
        {!canSeeAdminSections && !user.campId ? (
          <div className="alert error">Tu usuario supervisor no tiene campamento asignado. Pide al administrador que lo configure.</div>
        ) : null}

        <div className="hero-panel">
          <div className="hero-kicker">Carga principal</div>
          <h2 style={{ marginTop: 0, marginBottom: 8 }}>Informe diario de consumos y operación</h2>
          <div className="section-caption">
            Esta pantalla es solo para registrar el informe diario. El historial queda separado más abajo para que no se mezcle con la carga.
          </div>
          <div className="action-grid" style={{ marginTop: 16 }}>
            <div className="action-card">
              <strong>Campos exigibles diarios</strong>
              <span>
                Desayuno, almuerzo, cena, colación simple, colación de reemplazo, botellas de agua, alojamientos,
                lectura de medidor, agua gastada, basura, cloro y pH.
              </span>
            </div>
            <Link href="/dashboard" className="action-card">
              <strong>Volver al dashboard</strong>
              <span>Revisa el resumen diario y el estado general del campamento.</span>
            </Link>
          </div>
        </div>

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

        {camps.length > 0 ? (
          <ReportForm camps={camps.map((camp) => ({ id: camp.id, name: camp.name }))} defaultDate={toInputDateValue(new Date())} />
        ) : (
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Carga diaria</h2>
            <div className="alert error">No hay campamento asignado o activo para este usuario.</div>
          </div>
        )}

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
                  <td>{report.waterLiters} L</td>
                  <td>{report.fuelLiters} L</td>
                  <td>{report.wasteFillPercent}%</td>
                  <td>{report.chlorineLevel.toFixed(2)}</td>
                  <td>{report.phLevel.toFixed(2)}</td>
                </tr>
              ))}
              {recentReports.length === 0 ? (
                <tr>
                  <td colSpan={16} style={{ color: "var(--muted)" }}>
                    Aún no hay informes registrados.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
