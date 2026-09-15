import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isAdminRole, normalizeRole, VEHICLE_ROLES, VEHICLE_MANAGE_ROLES, requireRole } from "@/lib/auth";
import { formatDisplayDate } from "@/lib/report-utils";
import { db } from "@/lib/db";
import { daysUntil, getChecklistIssueCount, getVehicleHealthStatus, summarizeVehicleExpiries } from "@/lib/vehicle-status";
import { AppShell } from "@/components/app-shell";
import { VehicleChecklistForm } from "../vehicle-checklist-form";
import { RESULTADO_LABEL, type ResultadoChecklist } from "@/lib/checklist-vehiculos";

/** Quién hizo el checklist: usuario de la app, o el nombre que dio en el formulario. */
const quienHizo = (c: { driver?: { name: string } | null; conductorNombre?: string | null; origen?: string }) =>
  c.driver?.name ?? c.conductorNombre ?? (c.origen === "google_forms" ? "Formulario Google" : "—");
import { VehicleDocumentForm } from "../vehicle-document-form";
import { VehicleForm } from "../vehicle-form";

export default async function VehiculoDetallePage({ params }: { params: { id: string } }) {
  const user = await requireRole(VEHICLE_ROLES);
  const canSeeAdminSections = isAdminRole(user.role);
  // Quien puede escribir es quien las acciones del servidor ya aceptan. Esta
  // línea comparaba contra "VEHICULOS", el nombre antiguo del rol: al guardar
  // un usuario se persiste con el nombre nuevo, así que dejaba sin botones a
  // los operativos que las acciones sí dejan pasar. La pantalla era más
  // estricta que el servidor, que siempre es el error más confuso de depurar.
  const canManageVehicles = VEHICLE_MANAGE_ROLES.includes(normalizeRole(user.role));

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
          include: { driver: true, fotos: { orderBy: { orden: "asc" }, select: { id: true, archivoId: true, descripcion: true } } }
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
          <button type="button" className="secondary">← Flota</button>
        </Link>
      }
    >
      <div className="page-stack">

        {/* ── KPIs ── */}
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
            {/* El veredicto va aquí, grande: es la respuesta a la única pregunta
                que importa antes de salir. */}
            {latestChecklist && (() => {
              const r = RESULTADO_LABEL[(latestChecklist.resultado as ResultadoChecklist) ?? "apto"];
              const color = r.tone === "danger" ? "#dc2626" : r.tone === "warn" ? "#9a6300" : "#16a34a";
              return (
                <div style={{ marginTop: 6, fontWeight: 800, color, fontSize: "0.9rem" }}>{r.label}</div>
              );
            })()}
            <div className="dashboard-kpi-meta">
              {latestChecklist
                ? `${quienHizo(latestChecklist)}${latestChecklist.resultadoMotivo ? ` · ${latestChecklist.resultadoMotivo}` : checklistIssues > 0 ? ` · ${checklistIssues} observaciones` : ""}`
                : "Aún no hay checklist"}
            </div>
          </div>
        </div>

        {/* ── Ficha del vehículo (solo gestores) ── */}
        {canManageVehicles ? (
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Ficha del vehículo</h2>
            <VehicleForm
              camps={campOptions.map((camp) => ({ id: camp.id, name: camp.name }))}
              projects={projectOptions.map((project) => ({ id: project.id, name: project.name }))}
              vehicle={vehicle}
            />
          </div>
        ) : (
          /* Info resumida si el usuario no puede editar */
          <div className="summary-grid" style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))" }}>
            <div className="metric">
              <div className="label">Empresa</div>
              <div className="value" style={{ fontSize: "1.1rem" }}>{vehicle.company ?? "-"}</div>
            </div>
            <div className="metric">
              <div className="label">Proyecto</div>
              <div className="value" style={{ fontSize: "1.1rem" }}>{vehicle.assignedProject?.name ?? "Sin proyecto"}</div>
            </div>
            <div className="metric">
              <div className="label">Campamento</div>
              <div className="value" style={{ fontSize: "1.1rem" }}>{vehicle.assignedCamp?.name ?? "-"}</div>
            </div>
            <div className="metric">
              <div className="label">Cert. GPS</div>
              <div className="value">{vehicle.gpsCertificatePresent ? "Sí" : "No"}</div>
            </div>
            <div className="metric">
              <div className="label">Fotos unidad</div>
              <div className="value">{vehicle.unitPhotoSet ? "Sí" : "No"}</div>
            </div>
          </div>
        )}

        {/* ── Documentos ── */}
        <div className="vehicle-detail-grid">
          <div className="card" style={{ gridColumn: canManageVehicles ? "span 7" : "span 12" }}>
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

          {canManageVehicles ? (
            <div className="card" style={{ gridColumn: "span 5" }}>
              <h2 style={{ marginTop: 0 }}>Agregar documento</h2>
              <VehicleDocumentForm vehicleId={vehicle.id} />
            </div>
          ) : null}
        </div>

        {/* ── Checklist ── */}
        <div className="vehicle-detail-grid">
          <div className="card" style={{ gridColumn: "span 5" }}>
            <h2 style={{ marginTop: 0 }}>Checklist de salida</h2>
            <VehicleChecklistForm vehicleId={vehicle.id} odometerKm={vehicle.odometerKm} tipoVehiculo={vehicle.type} />
          </div>

          <div className="card table-card" style={{ gridColumn: "span 7" }}>
            <h2 style={{ marginTop: 0 }}>Historial de checklists</h2>
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
                      <td>{quienHizo(checklist)}</td>
                      <td>{checklist.odometerKm.toLocaleString("es-CL")} km</td>
                      <td>{checklist.fuelPercent}%</td>
                      <td>
                        {(() => {
                          const r = RESULTADO_LABEL[(checklist.resultado as ResultadoChecklist) ?? "apto"];
                          const color = r.tone === "danger" ? "#dc2626" : r.tone === "warn" ? "#9a6300" : "#16a34a";
                          const neum = Array.isArray(checklist.neumaticos)
                            ? (checklist.neumaticos as Array<{ posicion: string; mm: number | null }>)
                            : [];
                          return (
                            <>
                              <strong style={{ color }}>{r.label}</strong>
                              {neum.length > 0 && (
                                <span style={{ color: "var(--muted)", fontSize: "0.78rem" }}>
                                  {" · "}{neum.map(n => `${n.mm ?? "?"}`).join(" / ")} mm
                                </span>
                              )}
                              {checklist.resultadoMotivo && (
                                <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>{checklist.resultadoMotivo}</div>
                              )}
                              {!checklist.resultadoMotivo && issueCount > 0 && (
                                <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>{issueCount} alerta(s)</div>
                              )}
                              {checklist.observations && (
                                <div style={{ fontSize: "0.78rem" }}>{checklist.observations}</div>
                              )}
                              {checklist.fotos.length > 0 && (
                                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                                  {checklist.fotos.map(f => (
                                    <a key={f.id} href={`/api/archivo/${f.archivoId}`} target="_blank" rel="noreferrer"
                                       title={f.descripcion ?? "Abrir foto"}>
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img src={`/api/archivo/${f.archivoId}`} alt="" loading="lazy"
                                           style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)", display: "block" }} />
                                    </a>
                                  ))}
                                </div>
                              )}
                            </>
                          );
                        })()}
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

      </div>
    </AppShell>
  );
}
