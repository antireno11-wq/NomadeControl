import Link from "next/link";
import { isAdminRole, OPERATION_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDisplayDate, toInputDateValue } from "@/lib/report-utils";
import { ReportForm } from "@/app/dashboard/report-form";
import { NotificationBell } from "@/components/notification-bell";
import { AppShell } from "@/components/app-shell";
import { SectionTabs } from "@/components/section-tabs";
import { buildOperacionesTabs } from "@/lib/section-nav";

export default async function CargaDiariaPage({ searchParams }: { searchParams?: { camp?: string; status?: string } }) {
  const user = await requireRole(OPERATION_ROLES);
  const canSeeAdminSections = isAdminRole(user.role);
  // Antes el administrador era solo lectura acá, y el supervisor era el único
  // que cargaba. Con los roles simplificados eso dejó la pantalla sin nadie
  // que pudiera escribir. Operativo y administrador cargan; el administrador
  // además puede corregir cualquier informe, no solo los suyos.
  const canEdit = true;
  const puedeEditarCualquiera = canSeeAdminSections;
  // Regla única de alcance: un usuario con campamento asignado ve SOLO ese
  // campamento, sea cual sea su rol. Quien no tiene campamento —la gerencia
  // en Santiago— ve todos y puede elegir uno. Así el "administrador de Agua
  // Verde" se crea con su campamento y no ve los informes de Filo Sur.
  const campSel = typeof searchParams?.camp === "string" ? searchParams.camp : "";
  const campFilter = user.campId ?? (campSel || undefined);

  const today = new Date();
  const todayDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  const todosLosCamps = user.campId ? [] : await db.camp.findMany({
    where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true },
  });

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
        text: `${report.camp.name} ${formatDisplayDate(report.date)}: diferencia horómetros > 30h`,
        severity: "warning" as const
      })),
    ...recentReports
      .filter((report) => report.internetStatus !== "FUNCIONANDO")
      .slice(0, 3)
      .map((report) => ({
        text: `${report.camp.name} ${formatDisplayDate(report.date)}: internet ${report.internetStatus.replaceAll("_", " ").toLowerCase()}`,
        severity: "warning" as const
      }))
  ];
  const recentDatesLoaded = Array.from(
    new Map(
      recentReports.map((report) => [
        `${report.campId}-${toInputDateValue(report.date)}`,
        {
          id: report.id,
          date: formatDisplayDate(report.date),
          campName: report.camp.name,
          createdById: report.createdById,
          createdBy: report.createdBy.name,
          peopleCount: report.peopleCount
        }
      ])
    ).values()
  ).slice(0, 7);

  return (
    <AppShell
      title="Informe diario"
      user={user}
      activeNav="carga"
      showAdminSections={canSeeAdminSections}
      notifications={notificationItems}
    >
      <div className="page-stack">
        <SectionTabs items={buildOperacionesTabs(user.role, "carga-diaria")} />

        {!canSeeAdminSections && !user.campId ? (
          <div className="alert error">Tu usuario no tiene campamento asignado. Pide al administrador que lo configure.</div>
        ) : null}

        {!user.campId && (
          <form method="GET" className="card" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <label htmlFor="f-camp" style={{ margin: 0, fontWeight: 700, fontSize: "0.85rem" }}>Campamento</label>
            <select id="f-camp" name="camp" defaultValue={campSel} style={{ width: "auto" }}>
              <option value="">Todos</option>
              {todosLosCamps.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button type="submit" className="secondary" style={{ width: "auto" }}>Ver</button>
          </form>
        )}

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

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Últimas fechas guardadas</h2>
          <div className="section-caption" style={{ marginBottom: 12 }}>
            Revisa aquí si el informe del día quedó realmente guardado antes de salir.
          </div>
          <div className="summary-list">
            {recentDatesLoaded.map((row) => (
              <div key={row.id} className="summary-row">
                <div>
                  <strong>{row.date}</strong>
                  <div style={{ color: "var(--muted)" }}>
                    {row.campName} · {row.peopleCount} personas · cargado por {row.createdBy}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="status-pill ok">Guardado</span>
                  {canEdit && (puedeEditarCualquiera || row.createdById === user.id) ? (
                    <Link href={`/informes/${row.id}/editar`}>
                      <button type="button" className="secondary">Editar</button>
                    </Link>
                  ) : null}
                </div>
              </div>
            ))}
            {recentDatesLoaded.length === 0 ? <div className="alert error">Aún no hay informes guardados para mostrar.</div> : null}
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
                <div className="label">Consumo agua ayer</div>
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
                <th>Estanque negras</th>
                <th>Aguas negras</th>
                <th>Agua potable</th>
                <th>Agua gastada calc.</th>
                <th>Combustible</th>
                <th>Basura</th>
                <th>Cloro</th>
                <th>pH</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {recentReports.map((report) => (
                <tr key={report.id}>
                  <td>{formatDisplayDate(report.date)}</td>
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
                  <td>{report.blackWaterTankLevelPercent}%</td>
                  <td>{report.blackWaterRemoved ? `${report.blackWaterRemovedM3.toFixed(2)} m3` : "No"}</td>
                  <td>{report.potableWaterDelivered ? `${report.potableWaterDeliveredM3.toFixed(2)} m3` : "No"}</td>
                  <td>{report.waterLiters} L</td>
                  <td>{report.fuelLiters} L</td>
                  <td>{report.wasteFillPercent}%</td>
                  <td>{report.chlorineLevel.toFixed(2)}</td>
                  <td>{report.phLevel.toFixed(2)}</td>
                  <td>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <Link href={`/informes/${report.id}`}>
                        <button type="button" className="secondary">Ver</button>
                      </Link>
                      {canEdit && (puedeEditarCualquiera || report.createdById === user.id) ? (
                        <Link href={`/informes/${report.id}/editar`}>
                          <button type="button" className="secondary">Editar</button>
                        </Link>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {recentReports.length === 0 ? (
                <tr>
                  <td colSpan={20} style={{ color: "var(--muted)" }}>
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
