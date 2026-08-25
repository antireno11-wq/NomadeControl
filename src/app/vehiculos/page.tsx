import Link from "next/link";
import { isAdminRole, normalizeRole, VEHICLE_ROLES, requireRole } from "@/lib/auth";
import { formatDisplayDate } from "@/lib/report-utils";
import { db } from "@/lib/db";
import { daysUntil, getChecklistIssueCount, getVehicleHealthStatus, startOfDay, summarizeByDocumentType, summarizeVehicleExpiries } from "@/lib/vehicle-status";
import { AppShell } from "@/components/app-shell";

export default async function VehiculosPage() {
  const user = await requireRole(VEHICLE_ROLES);
  const canSeeAdminSections = isAdminRole(user.role);
  // Quien puede escribir es quien las acciones del servidor ya aceptan. Esta
  // línea comparaba contra "VEHICULOS", el nombre antiguo del rol: al guardar
  // un usuario se persiste con el nombre nuevo, así que dejaba sin botones a
  // los operativos que las acciones sí dejan pasar. La pantalla era más
  // estricta que el servidor, que siempre es el error más confuso de depurar.
  const canManageVehicles = VEHICLE_ROLES.includes(normalizeRole(user.role));
  const today = startOfDay(new Date());

  const vehicleWhere = canSeeAdminSections
    ? undefined
    : user.campId
      ? {
          OR: [{ assignedCampId: user.campId }, { assignedCampId: null }],
          status: { not: "FUERA_DE_SERVICIO" as const }
        }
      : { status: { not: "FUERA_DE_SERVICIO" as const } };

  const [vehicles, checklistsToday] = await Promise.all([
    db.vehicle.findMany({
      where: vehicleWhere,
      orderBy: [{ status: "asc" }, { plate: "asc" }],
      include: {
        assignedCamp: true,
        assignedProject: true,
        documents: { orderBy: { expiresAt: "asc" } },
        checklists: {
          take: 1,
          orderBy: [{ date: "desc" }, { createdAt: "desc" }],
          include: { driver: true }
        }
      }
    }),
    db.vehicleChecklist.count({
      where: {
        date: today,
        ...(canSeeAdminSections
          ? {}
          : user.campId
            ? {
                vehicle: {
                  OR: [{ assignedCampId: user.campId }, { assignedCampId: null }]
                }
              }
            : {})
      }
    })
  ]);

  const rows = vehicles.map((vehicle) => {
    const latestChecklist = vehicle.checklists[0] ?? null;
    const expirySummary = summarizeVehicleExpiries(vehicle, today);
    const health = getVehicleHealthStatus(vehicle, latestChecklist, today);
    const checklistIssues = getChecklistIssueCount(latestChecklist);
    const topAlert = expirySummary.expired[0] ?? expirySummary.upcoming[0] ?? null;

    return {
      ...vehicle,
      latestChecklist,
      expirySummary,
      health,
      checklistIssues,
      topAlert
    };
  });

  const expiredCount = rows.reduce((sum, vehicle) => sum + vehicle.expirySummary.expired.length, 0);
  const upcomingCount = rows.reduce((sum, vehicle) => sum + vehicle.expirySummary.upcoming.length, 0);
  const operationalCount = rows.filter((vehicle) => vehicle.status === "OPERATIVO").length;
  const accreditationSummary = {
    acreditado: rows.filter((vehicle) => vehicle.accreditationStatus === "ACREDITADO").length,
    pendiente: rows.filter((vehicle) => vehicle.accreditationStatus === "PENDIENTE").length,
    noAcreditado: rows.filter((vehicle) => vehicle.accreditationStatus === "NO_ACREDITADO").length
  };
  const documentSummary = summarizeByDocumentType(rows, today);
  const alertVehicles = rows.filter((vehicle) => vehicle.expirySummary.expired.length > 0 || vehicle.checklistIssues > 0).slice(0, 6);

  const notifications = alertVehicles.map((vehicle) => ({
    text:
      vehicle.expirySummary.expired[0]
        ? `${vehicle.plate}: ${vehicle.expirySummary.expired[0].label} vencido`
        : `${vehicle.plate}: checklist con observaciones`,
    severity: vehicle.expirySummary.expired.length > 0 ? ("error" as const) : ("warning" as const)
  }));

  return (
    <AppShell
      title="Vehículos"
      user={user}
      activeNav="vehiculos"
      showAdminSections={canSeeAdminSections}
      notifications={notifications}
      rightSlot={
        canManageVehicles ? (
          <Link href="/vehiculos/nuevo">
            <button type="button">Nuevo vehículo</button>
          </Link>
        ) : undefined
      }
    >
      <div className="page-stack">

        {/* ── Métricas rápidas ── */}
        <div className="summary-grid vehicle-summary-grid">
          <div className="metric">
            <div className="label">Vehículos registrados</div>
            <div className="value">{rows.length}</div>
          </div>
          <div className="metric">
            <div className="label">Operativos</div>
            <div className="value">{operationalCount}</div>
          </div>
          <div className="metric">
            <div className="label">Documentos vencidos</div>
            <div className="value">{expiredCount}</div>
          </div>
          <div className="metric">
            <div className="label">Por vencer</div>
            <div className="value">{upcomingCount}</div>
          </div>
          <div className="metric">
            <div className="label">Checklist hoy</div>
            <div className="value">{checklistsToday}</div>
          </div>
        </div>

        {/* ── Flota completa ── */}
        <div className="card table-card">
          <div className="dashboard-panel-header" style={{ marginBottom: 12 }}>
            <h2>Flota registrada</h2>
            <span className="dashboard-chip small">Checklist + documentos</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Patente</th>
                <th>Vehículo</th>
                <th>Campamento / proyecto</th>
                <th>Estado</th>
                <th>Acreditación</th>
                <th>Próxima alerta</th>
                <th>Último checklist</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((vehicle) => {
                const alertText = vehicle.topAlert
                  ? `${vehicle.topAlert.label} · ${formatDisplayDate(vehicle.topAlert.expiresAt)}`
                  : vehicle.latestChecklist
                    ? vehicle.checklistIssues > 0
                      ? `${vehicle.checklistIssues} observación(es)`
                      : "Sin alertas"
                    : "Sin alertas";

                return (
                  <tr key={vehicle.id}>
                    <td><strong>{vehicle.plate}</strong></td>
                    <td>
                      {vehicle.brand} {vehicle.model}
                      <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>{vehicle.odometerKm.toLocaleString("es-CL")} km · {vehicle.company ?? "Sin empresa"}</div>
                    </td>
                    <td>
                      {vehicle.assignedCamp?.name ?? "Sin campamento"}
                      <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                        {vehicle.assignedProject?.name ?? "Sin proyecto"}
                      </div>
                    </td>
                    <td>
                      <span className={`status-pill ${vehicle.health.tone === "danger" ? "danger" : vehicle.health.tone === "warn" ? "warn" : "ok"}`}>
                        {vehicle.health.label}
                      </span>
                    </td>
                    <td>
                      <span className={`status-pill ${vehicle.accreditationStatus === "ACREDITADO" ? "ok" : vehicle.accreditationStatus === "PENDIENTE" ? "warn" : "danger"}`}>
                        {vehicle.accreditationStatus.replaceAll("_", " ")}
                      </span>
                    </td>
                    <td style={{ fontSize: "0.88rem" }}>{alertText}</td>
                    <td style={{ fontSize: "0.88rem" }}>
                      {vehicle.latestChecklist
                        ? `${formatDisplayDate(vehicle.latestChecklist.date)} · ${vehicle.latestChecklist.driver.name}`
                        : <span style={{ color: "var(--muted)" }}>Sin checklist</span>}
                    </td>
                    <td>
                      <Link href={`/vehiculos/${vehicle.id}`} className="dashboard-mini-link">Abrir</Link>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ color: "var(--muted)" }}>Todavía no hay vehículos registrados.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {/* ── Panel inferior: alertas + acreditación/documentos ── */}
        <div className="vehicle-list-grid">

          {/* Alertas activas */}
          <div className="card">
            <div className="dashboard-panel-header" style={{ marginBottom: 12 }}>
              <h2>Alertas activas</h2>
              <span className="dashboard-chip small">Prioridad operativa</span>
            </div>
            <div className="summary-list">
              {alertVehicles.length === 0 ? (
                <div className="alert success">No hay alertas críticas activas.</div>
              ) : (
                alertVehicles.map((vehicle) => {
                  const primaryExpired = vehicle.expirySummary.expired[0];
                  const primaryUpcoming = vehicle.expirySummary.upcoming[0];
                  const alertText = primaryExpired
                    ? `${primaryExpired.label} vencido`
                    : primaryUpcoming
                      ? `${primaryUpcoming.label} vence en ${daysUntil(primaryUpcoming.expiresAt, today)} días`
                      : `${vehicle.checklistIssues} observación(es) en checklist`;

                  return (
                    <div key={`alert-${vehicle.id}`} className="summary-row">
                      <div>
                        <strong>{vehicle.plate} · {vehicle.brand} {vehicle.model}</strong>
                        <div style={{ color: "var(--muted)" }}>{alertText}</div>
                      </div>
                      <Link href={`/vehiculos/${vehicle.id}`} className="dashboard-mini-link">Ver ficha</Link>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Acreditación + resumen por documento */}
          <div className="card table-card">
            <div className="dashboard-panel-header" style={{ marginBottom: 12 }}>
              <h2>Estado documental</h2>
              <span className="dashboard-chip small">Acreditación · por tipo</span>
            </div>

            {/* Acreditación pills */}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 14px", borderRadius: 20, background: "var(--teal-light, #e8f7f5)", fontSize: "0.88rem" }}>
                <span style={{ fontWeight: 600 }}>{accreditationSummary.acreditado}</span>
                <span style={{ color: "var(--muted)" }}>acreditado{accreditationSummary.acreditado !== 1 ? "s" : ""}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 14px", borderRadius: 20, background: "#fefce8", fontSize: "0.88rem" }}>
                <span style={{ fontWeight: 600 }}>{accreditationSummary.pendiente}</span>
                <span style={{ color: "var(--muted)" }}>pendiente{accreditationSummary.pendiente !== 1 ? "s" : ""}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 14px", borderRadius: 20, background: "#fef2f2", fontSize: "0.88rem" }}>
                <span style={{ fontWeight: 600 }}>{accreditationSummary.noAcreditado}</span>
                <span style={{ color: "var(--muted)" }}>no acreditado{accreditationSummary.noAcreditado !== 1 ? "s" : ""}</span>
              </div>
            </div>

            {/* Documentos por tipo */}
            <table>
              <thead>
                <tr>
                  <th>Documento</th>
                  <th>Vigente</th>
                  <th>Por vencer</th>
                  <th>Vencido</th>
                  <th>N/A</th>
                </tr>
              </thead>
              <tbody>
                {documentSummary.map((row) => (
                  <tr key={row.key}>
                    <td>{row.label}</td>
                    <td>{row.vigente}</td>
                    <td>{row.porVencer}</td>
                    <td>{row.vencido}</td>
                    <td>{row.na}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

        </div>
      </div>
    </AppShell>
  );
}
