import Link from "next/link";
import { isAdminRole, OPERATION_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDisplayDate, toInputDateValue } from "@/lib/report-utils";
import { AppShell } from "@/components/app-shell";
import { TasksForm } from "./tasks-form";

export default async function ControlTareasDiariasPage() {
  const user = await requireRole(OPERATION_ROLES);
  const canSeeAdminSections = isAdminRole(user.role);
  const canEdit = !canSeeAdminSections;
  const campFilter = !canSeeAdminSections ? user.campId ?? "__none__" : undefined;
  const today = new Date();
  const todayDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  const [camps, recent, todayControls] = await Promise.all([
    db.camp.findMany({
      where: {
        isActive: true,
        ...(campFilter ? { id: campFilter } : {})
      },
      orderBy: { name: "asc" }
    }),
    db.dailyTaskControl.findMany({
      where: campFilter ? { campId: campFilter } : undefined,
      take: 15,
      orderBy: [{ date: "desc" }, { camp: { name: "asc" } }],
      include: { camp: true, createdBy: true }
    }),
    db.dailyTaskControl.findMany({
      where: {
        ...(campFilter ? { campId: campFilter } : {}),
        date: todayDate
      },
      include: { camp: true, createdBy: true }
    })
  ]);

  const latestByCamp = new Map<string, (typeof recent)[number]>();
  for (const row of recent) {
    if (!latestByCamp.has(row.campId)) {
      latestByCamp.set(row.campId, row);
    }
  }

  const toChecksCount = (value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { done: 0, total: 0 };
    }
    const entries = Object.values(value as Record<string, unknown>);
    const total = entries.length;
    const done = entries.filter((entry) => entry === true).length;
    return { done, total };
  };

  const semaphoreRows = camps.map((camp) => {
    const latest = latestByCamp.get(camp.id);
    if (!latest) {
      return { campName: camp.name, status: "SIN REGISTRO", percent: 0, color: "#6c757d" };
    }
    const adminChecks = toChecksCount(latest.administrativeChecks);
    const opChecks = toChecksCount(latest.operationalChecks);
    const done = adminChecks.done + opChecks.done;
    const total = adminChecks.total + opChecks.total;
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
    const color = percent >= 90 ? "#0d8a3b" : percent >= 70 ? "#f39c12" : "#c0392b";
    const status = percent >= 90 ? "VERDE" : percent >= 70 ? "AMARILLO" : "ROJO";
    return { campName: camp.name, status, percent, color };
  });
  const todayByCamp = new Map<string, (typeof todayControls)[number]>();
  for (const row of todayControls) {
    todayByCamp.set(row.campId, row);
  }

  return (
    <AppShell title="Control de tareas" user={user} activeNav="tareas" showAdminSections={canSeeAdminSections}>
      <div className="page-stack">
        {!canSeeAdminSections && !user.campId ? (
          <div className="alert error">Tu usuario supervisor no tiene campamento asignado. Pide al administrador que lo configure.</div>
        ) : null}

        {canSeeAdminSections ? (
          <div className="alert success">
            Vista solo lectura. Como administrador puedes revisar cumplimiento y controles cargados, pero no editarlos.
          </div>
        ) : null}

        <div className="hero-panel">
          <div className="hero-kicker">Seguimiento operativo</div>
          <h2 style={{ marginTop: 0, marginBottom: 8 }}>Control de tareas diarias</h2>
          <div className="section-caption">
            Registra el checklist diario sin mezclarlo con el historial. El resumen del cumplimiento del día queda arriba y los registros anteriores quedan al final.
          </div>
          <div className="action-grid" style={{ marginTop: 16 }}>
            <Link href="/dashboard" className="action-card">
              <strong>Volver al dashboard</strong>
              <span>Revisa el resumen del informe diario y del control de tareas.</span>
            </Link>
            <div className="action-card">
              <strong>Semáforo del campamento</strong>
              <span>Verde sobre 90%, amarillo desde 70% y rojo bajo 70% de cumplimiento.</span>
            </div>
          </div>
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Resumen de cumplimiento</h2>
          <div className="summary-grid">
            <div className="metric">
              <div className="label">Campamentos con control hoy</div>
              <div className="value">{todayControls.length}</div>
            </div>
            <div className="metric">
              <div className="label">Campamentos pendientes</div>
              <div className="value">{Math.max(camps.length - todayControls.length, 0)}</div>
            </div>
          </div>
          <div className="summary-list">
            {camps.map((camp) => {
              const latest = todayByCamp.get(camp.id);
              const semaphore = semaphoreRows.find((row) => row.campName === camp.name);
              return (
                <div key={camp.id} className="summary-row">
                  <div>
                    <strong>{camp.name}</strong>
                    <div style={{ color: "var(--muted)" }}>
                      {latest
                        ? `${semaphore?.percent ?? 0}% de tareas completadas hoy`
                        : "Todavía no hay control de tareas cargado hoy"}
                    </div>
                  </div>
                  <span className={latest ? "status-pill ok" : "status-pill warn"}>
                    {latest ? semaphore?.status ?? "OK" : "Pendiente"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Semáforo de cumplimiento</h2>
          <div className="grid two">
            {semaphoreRows.map((row) => (
              <div key={row.campName} className="metric">
                <div className="label">{row.campName}</div>
                <div className="value" style={{ color: row.color }}>
                  {row.status} ({row.percent}%)
                </div>
              </div>
            ))}
          </div>
        </div>

        {canEdit && camps.length > 0 ? (
          <TasksForm camps={camps.map((camp) => ({ id: camp.id, name: camp.name }))} defaultDate={toInputDateValue(new Date())} />
        ) : canEdit ? (
          <div className="card">
            <div className="alert error">No hay campamento disponible para registrar tareas.</div>
          </div>
        ) : null}

        {canSeeAdminSections ? (
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Resumen ejecutivo</h2>
            <div className="summary-grid">
              <div className="metric">
                <div className="label">Controles cargados</div>
                <div className="value">{todayControls.length}</div>
              </div>
              <div className="metric">
                <div className="label">Pendientes</div>
                <div className="value">{Math.max(camps.length - todayControls.length, 0)}</div>
              </div>
              <div className="metric">
                <div className="label">Semáforo promedio</div>
                <div className="value">
                  {semaphoreRows.length > 0
                    ? Math.round(semaphoreRows.reduce((sum, row) => sum + row.percent, 0) / semaphoreRows.length)
                    : 0}
                  %
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <div className="card table-card">
          <h2 style={{ marginTop: 0 }}>Historial reciente de controles</h2>
          <div className="section-caption" style={{ marginBottom: 10 }}>
            Este bloque es de consulta. La carga del checklist se hace en el formulario superior.
          </div>
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Campamento</th>
                <th>Registrado por</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((row) => (
                <tr key={row.id}>
                  <td>{formatDisplayDate(row.date)}</td>
                  <td>{row.camp.name}</td>
                  <td>{row.createdBy.name}</td>
                </tr>
              ))}
              {recent.length === 0 ? (
                <tr>
                  <td colSpan={3} style={{ color: "var(--muted)" }}>
                    Aún no hay controles diarios cargados.
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
