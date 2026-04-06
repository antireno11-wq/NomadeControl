import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isAdminRole, VEHICLE_ROLES, requireRole } from "@/lib/auth";
import { formatDisplayDate } from "@/lib/report-utils";
import { db } from "@/lib/db";
import { daysUntil, getChecklistIssueCount, getVehicleHealthStatus, summarizeVehicleExpiries } from "@/lib/vehicle-status";
import { AppShell } from "@/components/app-shell";
import { VehicleChecklistForm } from "../vehicle-checklist-form";
import { VehicleDocumentForm } from "../vehicle-document-form";
import { VehicleForm } from "../vehicle-form";

export default async function VehiculoDetallePage({ params }: { params: { id: string } }) {
  const user = await requireRole(VEHICLE_ROLES);
  const canSeeAdminSections = isAdminRole(user.role);

  const [vehicle, camps] = await Promise.all([
    db.vehicle.findUnique({
      where: { id: params.id },
      include: {
        assignedCamp: true,
        assignedProject: true,
        documents: { orderBy: { expiresAt: "asc" } },
        checklists: {
          take: 10,
          orderBy: [{ date: "desc" }, { createdAt: "desc" }],
          include: { driver: true }
        }
      }
    }),
    Promise.all([
      db.camp.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
      db.project.findMany({ where: { isActive: true }, orderBy: { name: "asc" } })
    ])
  ]);

  if (!vehicle) notFound();

  if (!canSeeAdminSections && user.campId && vehicle.assignedCampId && vehicle.assignedCampId !== user.campId) {
    redirect("/vehiculos");
  }

  const [campOptions, projectOptions] = camps;

  const latestChecklist = vehicle.checklists[0] ?? null;
  const expirySummary = summarizeVehicleExpiries(vehicle);
  const health = getVehicleHealthStatus(vehicle, latestChecklist);
  const checklistIssues = getChecklistIssueCount(latestChecklist);

  return (
    <AppShell
      title={`${vehicle.plate} · ${vehicle.brand} ${vehicle.model}`}
      user={user}
      activeNav="vehiculos"
      showAdminSections={canSeeAdminSections}
      rightSlot={
        <Link href="/vehiculos">
          <button type="button" className="secondary">Volver</button>
        </Link>
      }
    >
      <div className="page-stack">
        <div className="dashboard-kpi-grid vehicle-kpi-grid">
          <div className={`dashboard-kpi ${health.tone === "danger" ? "accent" : health.tone === "warn" ? "teal" : ""}`}>
            <div className="dashboard-kpi-label">Estado general</div>
            <div className="dashboard-kpi-value" style={{ fontSize: "1.5rem" }}>{health.label}</div>
            <div className="dashboard-kpi-meta">
              {vehicle.status.replaceAll("_", " ")} · {vehicle.accreditationStatus.replaceAll("_", " ")}
            </div>
          </div>
          <div className="dashboard-kpi">
            <div className="dashboard-kpi-label">Kilometraje</div>
            <div className="dashboard-kpi-value">{vehicle.odometerKm.toLocaleString("es-CL")}</div>
            <div className="dashboard-kpi-meta">km registrados</div>
          </div>
          <div className="dashboard-kpi">
            <div className="dashboard-kpi-label">Próximo vencimiento</div>
            <div className="dashboard-kpi-value" style={{ fontSize: "1.45rem" }}>
              {expirySummary.next ? formatDisplayDate(expirySummary.next.expiresAt) : "-"}
            </div>
            <div className="dashboard-kpi-meta">{expirySummary.next?.label ?? "Sin documentos cargados"}</div>
          </div>
          <div className="dashboard-kpi">
            <div className="dashboard-kpi-label">Último checklist</div>
            <div className="dashboard-kpi-value" style={{ fontSize: "1.45rem" }}>
              {latestChecklist ? formatDisplayDate(latestChecklist.date) : "-"}
            </div>
            <div className="dashboard-kpi-meta">
              {latestChecklist ? `${latestChecklist.driver.name} · ${checklistIssues} observaciones` : "Aún no hay checklist"}
            </div>
          </div>
        </div>

        <div className="summary-grid vehicle-summary-grid">
          <div className="metric">
            <div className="label">Empresa</div>
            <div className="value" style={{ fontSize: "1.1rem" }}>{vehicle.company ?? "-"}</div>
          </div>
          <div className="metric">
            <div className="label">Proyecto</div>
            <div className="value" style={{ fontSize: "1.1rem" }}>{vehicle.assignedProject?.name ?? "Sin proyecto"}</div>
          </div>
          <div className="metric">
            <div className="label">Cert. GPS</div>
            <div className="value">{vehicle.gpsCertificatePresent ? "Sí" : "No"}</div>
          </div>
          <div className="metric">
            <div className="label">Fotos unidad</div>
            <div className="value">{vehicle.unitPhotoSet ? "Sí" : "No"}</div>
          </div>
          <div className="metric">
            <div className="label">Revisado por</div>
            <div className="value" style={{ fontSize: "1.1rem" }}>{vehicle.reviewedByName ?? "-"}</div>
          </div>
        </div>

        <div className="vehicle-detail-grid">
          {canSeeAdminSections ? (
            <div className="card">
              <h2 style={{ marginTop: 0 }}>Ficha del vehículo</h2>
              <VehicleForm
                camps={campOptions.map((camp) => ({ id: camp.id, name: camp.name }))}
                projects={projectOptions.map((project) => ({ id: project.id, name: project.name }))}
                vehicle={vehicle}
              />
            </div>
          ) : null}

          <div className="card">
            <h2 style={{ marginTop: 0 }}>Checklist de salida</h2>
            <VehicleChecklistForm vehicleId={vehicle.id} odometerKm={vehicle.odometerKm} />
          </div>
        </div>

        <div className="vehicle-detail-grid">
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Documentos y vencimientos</h2>
            <div className="summary-list">
              {expirySummary.items.length === 0 ? (
                <div className="alert error">Todavía no hay documentos registrados para este vehículo.</div>
              ) : (
                expirySummary.items.map((item) => {
                  const diff = daysUntil(item.expiresAt);
                  const pillClass = diff < 0 ? "danger" : diff <= item.alertDays ? "warn" : "ok";
                  const pillLabel = diff < 0 ? `Vencido hace ${Math.abs(diff)} días` : diff === 0 ? "Vence hoy" : `${diff} días`;

                  return (
                    <div key={`${item.label}-${item.expiresAt.toISOString()}`} className="summary-row">
                      <div>
                        <strong>{item.label}</strong>
                        <div style={{ color: "var(--muted)" }}>{formatDisplayDate(item.expiresAt)}</div>
                      </div>
                      <span className={`status-pill ${pillClass}`}>{pillLabel}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {canSeeAdminSections ? (
            <div className="card">
              <h2 style={{ marginTop: 0 }}>Agregar documento controlado</h2>
              <VehicleDocumentForm vehicleId={vehicle.id} />
            </div>
          ) : null}
        </div>

        <div className="card table-card">
          <h2 style={{ marginTop: 0 }}>Últimos checklists</h2>
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Chofer</th>
                <th>Kilometraje</th>
                <th>Combustible</th>
                <th>Observaciones</th>
              </tr>
            </thead>
            <tbody>
              {vehicle.checklists.map((checklist) => {
                const issueCount = getChecklistIssueCount(checklist);
                return (
                  <tr key={checklist.id}>
                    <td>{formatDisplayDate(checklist.date)}</td>
                    <td>{checklist.driver.name}</td>
                    <td>{checklist.odometerKm.toLocaleString("es-CL")} km</td>
                    <td>{checklist.fuelPercent}%</td>
                    <td>
                      {issueCount > 0 ? `${issueCount} alerta(s)` : "Sin observaciones"}
                      {checklist.observations ? ` · ${checklist.observations}` : ""}
                    </td>
                  </tr>
                );
              })}
              {vehicle.checklists.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ color: "var(--muted)" }}>Todavía no hay checklists para este vehículo.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
