import Link from "next/link";
import { isAdminRole, OPERATION_ROLES, requireRole } from "@/lib/auth";
import { toInputDateValue } from "@/lib/report-utils";
import { db } from "@/lib/db";
import { daysUntil, getChecklistIssueCount, getVehicleHealthStatus, startOfDay, summarizeByDocumentType, summarizeVehicleExpiries } from "@/lib/vehicle-status";
import { AppShell } from "@/components/app-shell";

export default async function VehiculosPage() {
  const user = await requireRole(OPERATION_ROLES);
  const canSeeAdminSections = isAdminRole(user.role);
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
        canSeeAdminSections ? (
          <Link href="/vehiculos/nuevo">
            <button type="button">Nuevo vehículo</button>
          </Link>
        ) : undefined
      }
    >
      <div className="page-stack">
        <div className="hero-panel">
          <span className="hero-kicker">Nomade Control</span>
          <h2 style={{ margin: "0 0 8px" }}>Control base de flota y documentos</h2>
          <p className="section-caption" style={{ margin: 0 }}>
            Este módulo deja lista la ficha del vehículo, los vencimientos y el checklist que cada chofer sube al tomar una unidad.
          </p>
        </div>

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

        <div className="vehicle-list-grid">
          <div className="card">
            <div className="dashboard-panel-header" style={{ marginBottom: 12 }}>
              <h2>Acreditación</h2>
              <span className="dashboard-chip small">Estado general</span>
            </div>
            <div className="summary-list">
              <div className="summary-row">
                <div>
                  <strong>Acreditados</strong>
                  <div style={{ color: "var(--muted)" }}>Vehículos listos para operar</div>
                </div>
                <span className="status-pill ok">{accreditationSummary.acreditado}</span>
              </div>
              <div className="summary-row">
                <div>
                  <strong>Pendientes</strong>
                  <div style={{ color: "var(--muted)" }}>Aún faltan respaldos o revisión</div>
                </div>
                <span className="status-pill warn">{accreditationSummary.pendiente}</span>
              </div>
              <div className="summary-row">
                <div>
                  <strong>No acreditados</strong>
                  <div style={{ color: "var(--muted)" }}>Fuera de condición documental</div>
                </div>
                <span className="status-pill danger">{accreditationSummary.noAcreditado}</span>
              </div>
            </div>
          </div>

          <div className="card table-card">
            <div className="dashboard-panel-header" style={{ marginBottom: 12 }}>
              <h2>Resumen por documento</h2>
              <span className="dashboard-chip small">Vigente / por vencer / vencido</span>
            </div>
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

        <div className="vehicle-list-grid">
          <div className="card">
            <div className="dashboard-panel-header" style={{ marginBottom: 12 }}>
              <h2>Alertas activas</h2>
              <span className="dashboard-chip small">Prioridad operativa</span>
            </div>
            <div className="summary-list">
              {alertVehicles.length === 0 ? (
                <div className="alert success">No hay alertas críticas activas en la flota visible.</div>
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
                  <th>Próxima alerta</th>
                  <th>Último checklist</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((vehicle) => {
                  const alertText = vehicle.topAlert
                    ? `${vehicle.topAlert.label} · ${toInputDateValue(vehicle.topAlert.expiresAt)}`
                    : vehicle.latestChecklist
                      ? `${vehicle.checklistIssues} observación(es)`
                      : "Sin alertas";

                  return (
                    <tr key={vehicle.id}>
                      <td><strong>{vehicle.plate}</strong></td>
                      <td>
                        {vehicle.brand} {vehicle.model}
                        <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>{vehicle.odometerKm.toLocaleString("es-CL")} km</div>
                        <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>{vehicle.company ?? "Sin empresa"}</div>
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
                        <div style={{ color: "var(--muted)", fontSize: "0.82rem", marginTop: 6 }}>
                          {vehicle.accreditationStatus.replaceAll("_", " ")}
                        </div>
                      </td>
                      <td>{alertText}</td>
                      <td>
                        {vehicle.latestChecklist ? `${toInputDateValue(vehicle.latestChecklist.date)} · ${vehicle.latestChecklist.driver.name}` : "Sin checklist"}
                      </td>
                      <td>
                        <Link href={`/vehiculos/${vehicle.id}`} className="dashboard-mini-link">Abrir</Link>
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ color: "var(--muted)" }}>Todavía no hay vehículos registrados.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
