import Link from "next/link";
import { ADMIN_ROLES, requireRole } from "@/lib/auth";
import { requireAuditOwner } from "@/lib/audit";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { formatDisplayDate } from "@/lib/report-utils";

function formatDateTime(date: Date) {
  return `${formatDisplayDate(date)} ${date.toISOString().slice(11, 16)}`;
}

export default async function AuditoriaPage() {
  // Solo pedía sesión, no rol: cualquier usuario con cuenta —Consulta
  // incluido— podía leer quién hizo qué en todo el sistema. El menú solo se
  // lo mostraba a los administradores, pero la URL estaba abierta.
  const user = await requireRole(ADMIN_ROLES);
  await requireAuditOwner(user);

  const logs = await db.auditLog.findMany({
    take: 200,
    orderBy: { createdAt: "desc" }
  });

  return (
    <AppShell
      title="Auditoría"
      user={user}
      activeNav={null}
      showAdminSections
      rightSlot={
        <Link href="/administracion">
          <button type="button" className="secondary">Volver</button>
        </Link>
      }
    >
      <div className="page-stack">
        <div className="hero-panel">
          <div className="hero-kicker">Log oculto</div>
          <h2 style={{ marginTop: 0, marginBottom: 8 }}>Actividad del sistema</h2>
          <div className="section-caption">
            Registro interno de accesos y cambios relevantes. Visible solo para tu usuario.
          </div>
        </div>

        <div className="dashboard-bottom-grid">
          <section className="dashboard-panel dashboard-panel-wide">
            <div className="dashboard-panel-header">
              <h2>Últimos eventos</h2>
              <span className="dashboard-chip small">{logs.length} registro(s)</span>
            </div>
            <div className="dashboard-table-wrap">
              <table className="dashboard-table">
                <thead>
                  <tr>
                    <th>Fecha y hora</th>
                    <th>Usuario</th>
                    <th>Acción</th>
                    <th>Tipo</th>
                    <th>Resumen</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id}>
                      <td>{formatDateTime(log.createdAt)}</td>
                      <td>{log.actorName ?? log.actorEmail ?? "Sistema"}</td>
                      <td>{log.action}</td>
                      <td>{log.entityType}</td>
                      <td>
                        {log.summary}
                        {log.metadata ? (
                          <div style={{ color: "var(--muted)", fontSize: "0.78rem", marginTop: 4 }}>
                            {log.metadata}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                  {logs.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ color: "var(--muted)" }}>
                        Todavía no hay eventos registrados.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
