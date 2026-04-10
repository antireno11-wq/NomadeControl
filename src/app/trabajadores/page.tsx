import Link from "next/link";
import { isAdminRole, OPERATION_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { formatDisplayDate } from "@/lib/report-utils";
import { getNearestDocument, getStaffDocumentEntries } from "@/lib/staff-docs";
import { formatShiftRange, getShiftProjection } from "@/lib/shift-projection";

type SearchParams = {
  campId?: string | string[];
  status?: string | string[];
};

function getStatusInfo(status: string) {
  if (status === "created") return { type: "success", text: "Trabajador creado correctamente." };
  if (status === "updated") return { type: "success", text: "Trabajador actualizado correctamente." };
  if (status === "invalid") return { type: "error", text: "Revisa los datos del trabajador." };
  if (status === "forbidden") return { type: "error", text: "No tienes permiso para modificar trabajadores de otro campamento." };
  if (status === "no-camp") return { type: "error", text: "Tu usuario no tiene campamento asignado." };
  return null;
}

export default async function TrabajadoresPage({ searchParams }: { searchParams?: SearchParams }) {
  const user = await requireRole(OPERATION_ROLES);
  const canSeeAdminSections = isAdminRole(user.role);
  const selectedCampIdRaw = searchParams?.campId;
  const selectedCampId = typeof selectedCampIdRaw === "string" && selectedCampIdRaw !== "general" ? selectedCampIdRaw : undefined;
  const scopedSelectedCampId = canSeeAdminSections ? selectedCampId : user.campId ?? selectedCampId;
  const campFilter = !canSeeAdminSections ? user.campId ?? "__none__" : undefined;

  const [camps, staffMembers] = await Promise.all([
    db.camp.findMany({
      where: { isActive: true, ...(campFilter ? { id: campFilter } : {}) },
      orderBy: { name: "asc" }
    }),
    db.staffMember.findMany({
      where: {
        ...(campFilter ? { campId: campFilter } : {}),
        ...(scopedSelectedCampId ? { campId: scopedSelectedCampId } : {})
      },
      include: { camp: true },
      orderBy: [{ isActive: "desc" }, { fullName: "asc" }]
    })
  ]);

  const today = new Date();
  const staffRows = staffMembers.map((worker) => {
    const docs = getStaffDocumentEntries(worker, today);
    const nearest = getNearestDocument(worker, today);
    const shiftProjection = getShiftProjection(
      {
        shiftPattern: worker.shiftPattern,
        shiftWorkDays: worker.shiftWorkDays,
        shiftOffDays: worker.shiftOffDays,
        shiftStartDate: worker.shiftStartDate
      },
      today
    );
    const expired = docs.filter((entry) => entry.status === "expired");
    const dueSoon = docs.filter((entry) => entry.status === "dueSoon");
    const missing = docs.filter((entry) => entry.status === "missing");

    return {
      worker,
      docs,
      nearest,
      shiftProjection,
      expiredCount: expired.length,
      dueSoonCount: dueSoon.length,
      missingCount: missing.length,
      overallStatus: expired.length > 0 ? "danger" : dueSoon.length > 0 ? "warn" : "ok"
    } as const;
  });

  const activeShiftRows = staffRows.filter((row) => row.worker.isActive && row.shiftProjection);
  const workersOnShift = activeShiftRows.filter((row) => row.shiftProjection?.currentState === "work").length;
  const workersResting = activeShiftRows.filter((row) => row.shiftProjection?.currentState === "off").length;
  const shiftChangesThisWeek = activeShiftRows.filter((row) => (row.shiftProjection?.daysRemainingInBlock ?? 99) <= 7).length;
  const nextShiftChanges = activeShiftRows
    .map((row) => ({
      workerId: row.worker.id,
      workerName: row.worker.fullName,
      campName: row.worker.camp.name,
      shiftPattern: row.shiftProjection!.shiftPatternLabel,
      currentStateLabel: row.shiftProjection!.currentStateLabel,
      nextBlockLabel: row.shiftProjection!.nextBlockLabel,
      daysRemainingInBlock: row.shiftProjection!.daysRemainingInBlock,
      nextBlockStart: row.shiftProjection!.nextBlockStart,
      currentBlockRange: formatShiftRange(row.shiftProjection!.currentBlockStart, row.shiftProjection!.currentBlockEnd),
      nextBlockRange: formatShiftRange(row.shiftProjection!.nextBlockStart, row.shiftProjection!.nextBlockEnd)
    }))
    .sort((a, b) => a.daysRemainingInBlock - b.daysRemainingInBlock || a.workerName.localeCompare(b.workerName));

  const expiredWorkers = staffRows.filter((row) => row.expiredCount > 0).length;
  const dueSoonWorkers = staffRows.filter((row) => row.expiredCount === 0 && row.dueSoonCount > 0).length;
  const undocumentedWorkers = staffRows.filter((row) => row.missingCount === row.docs.length).length;
  const upcomingEntries = staffRows
    .flatMap((row) =>
      row.docs
        .filter((entry) => entry.date && entry.daysUntil != null)
        .map((entry) => ({
          workerId: row.worker.id,
          workerName: row.worker.fullName,
          campName: row.worker.camp.name,
          label: entry.label,
          date: entry.date!,
          daysUntil: entry.daysUntil!,
          severity: entry.daysUntil! < 0 ? "danger" : entry.daysUntil! <= 30 ? "warn" : "ok"
        }))
    )
    .sort((a, b) => a.daysUntil - b.daysUntil)
    .slice(0, 8);

  const statusRaw = searchParams?.status;
  const status = typeof statusRaw === "string" ? statusRaw : "";
  const alert = getStatusInfo(status);

  return (
    <AppShell
      title="Trabajadores"
      user={user}
      activeNav="trabajadores"
      showAdminSections={canSeeAdminSections}
      rightSlot={
        <>
          {canSeeAdminSections ? (
            <>
              <form method="get" className="dashboard-filter">
                <select name="campId" defaultValue={scopedSelectedCampId ?? "general"}>
                  <option value="general">Todos</option>
                  {camps.map((camp) => (
                    <option key={camp.id} value={camp.id}>
                      {camp.name}
                    </option>
                  ))}
                </select>
                <button type="submit">Ver</button>
              </form>
              <Link href="/trabajadores/nuevo">
                <button type="button">Nuevo trabajador</button>
              </Link>
            </>
          ) : null}
        </>
      }
    >
      <div className="page-stack">
        {alert ? <div className={`alert ${alert.type}`}>{alert.text}</div> : null}

        <div className="dashboard-kpi-grid insight-kpi-grid">
          <div className="dashboard-kpi teal">
            <div className="dashboard-kpi-label">Trabajadores</div>
            <div className="dashboard-kpi-value">{staffRows.length}</div>
            <div className="dashboard-kpi-meta">{staffRows.filter((row) => row.worker.isActive).length} activos</div>
          </div>
          <div className="dashboard-kpi teal">
            <div className="dashboard-kpi-label">En turno hoy</div>
            <div className="dashboard-kpi-value">{workersOnShift}</div>
            <div className="dashboard-kpi-meta">{workersResting} en descanso</div>
          </div>
          <div className={`dashboard-kpi ${shiftChangesThisWeek > 0 ? "accent" : ""}`}>
            <div className="dashboard-kpi-label">Cambios próximos</div>
            <div className="dashboard-kpi-value">{shiftChangesThisWeek}</div>
            <div className="dashboard-kpi-meta">cambian de bloque en 7 días</div>
          </div>
          <div className={`dashboard-kpi ${expiredWorkers > 0 ? "accent" : "teal"}`}>
            <div className="dashboard-kpi-label">Con vencidos</div>
            <div className="dashboard-kpi-value">{expiredWorkers}</div>
            <div className="dashboard-kpi-meta">documentos ya vencidos</div>
          </div>
          <div className={`dashboard-kpi ${dueSoonWorkers > 0 ? "accent" : ""}`}>
            <div className="dashboard-kpi-label">Por vencer</div>
            <div className="dashboard-kpi-value">{dueSoonWorkers}</div>
            <div className="dashboard-kpi-meta">próximos 30 días</div>
          </div>
          <div className="dashboard-kpi">
            <div className="dashboard-kpi-label">Sin fechas</div>
            <div className="dashboard-kpi-value">{undocumentedWorkers}</div>
            <div className="dashboard-kpi-meta">fichas incompletas</div>
          </div>
        </div>

        <div className="dashboard-core-grid">
          <section className="dashboard-panel dashboard-panel-large">
            <div className="dashboard-panel-header">
              <h2>Proyección de todo el turno</h2>
              <span className="dashboard-chip small">Bloque actual y siguiente</span>
            </div>
            <div className="summary-list">
              {nextShiftChanges.map((entry) => (
                <div key={entry.workerId} className="summary-row">
                  <div>
                    <strong>{entry.workerName}</strong>
                    <div style={{ color: "var(--muted)" }}>{entry.campName}</div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700 }}>{entry.shiftPattern} · {entry.currentStateLabel}</div>
                    <div style={{ color: "var(--muted)", fontSize: "0.82rem" }}>
                      Actual: {entry.currentBlockRange}
                    </div>
                    <div style={{ color: "var(--muted)", fontSize: "0.82rem" }}>
                      Luego: {entry.nextBlockLabel} · {entry.nextBlockRange}
                    </div>
                  </div>
                  <div style={{ minWidth: 120 }}>{formatDisplayDate(entry.nextBlockStart)}</div>
                  <div className={`status-pill ${entry.daysRemainingInBlock <= 2 ? "danger" : entry.daysRemainingInBlock <= 7 ? "warn" : "ok"}`}>
                    {entry.daysRemainingInBlock === 0 ? "Cambia mañana" : `${entry.daysRemainingInBlock} día(s)`}
                  </div>
                </div>
              ))}
              {nextShiftChanges.length === 0 ? <div className="section-caption">Todavía no hay turnos configurados en los trabajadores activos.</div> : null}
            </div>
          </section>

          <section className="dashboard-panel dashboard-panel-large">
            <div className="dashboard-panel-header">
              <h2>Alertas documentales</h2>
              <span className="dashboard-chip small">Próximos vencimientos</span>
            </div>
            <div className="summary-list">
              {upcomingEntries.map((entry) => (
                <div key={`${entry.workerId}-${entry.label}-${entry.date.toISOString()}`} className="summary-row">
                  <div>
                    <strong>{entry.workerName}</strong>
                    <div style={{ color: "var(--muted)" }}>{entry.campName}</div>
                  </div>
                  <div style={{ flex: 1, color: "var(--muted)" }}>{entry.label}</div>
                  <div style={{ minWidth: 110 }}>{formatDisplayDate(entry.date)}</div>
                  <div className={`status-pill ${entry.severity === "danger" ? "danger" : entry.severity === "warn" ? "warn" : "ok"}`}>
                    {entry.daysUntil < 0 ? `${Math.abs(entry.daysUntil)} días vencido` : `${entry.daysUntil} días`}
                  </div>
                </div>
              ))}
              {upcomingEntries.length === 0 ? <div className="section-caption">Todavía no hay vencimientos cargados.</div> : null}
            </div>
          </section>
        </div>

        <div className="dashboard-bottom-grid">
          <section className="dashboard-panel dashboard-panel-wide">
            <div className="dashboard-panel-header">
              <h2>Control documental del personal</h2>
              <span className="dashboard-chip small">{scopedSelectedCampId ? "Campamento filtrado" : "Todos los campamentos"}</span>
            </div>
            <div className="dashboard-table-wrap">
              <table className="dashboard-table">
                <thead>
                  <tr>
                    <th>Trabajador</th>
                    <th>Campamento</th>
                    <th>Cargo</th>
                    <th>Turno proyectado</th>
                    <th>Contrato</th>
                    <th>Altura</th>
                    <th>Acreditación</th>
                    <th>Próximo venc.</th>
                    <th>Estado</th>
                    <th>Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {staffRows.map((row) => (
                    <tr key={row.worker.id}>
                      <td>{row.worker.fullName}</td>
                      <td>{row.worker.camp.name}</td>
                      <td>{row.worker.role ?? "-"}</td>
                      <td>
                        {row.shiftProjection ? (
                          <div style={{ display: "grid", gap: 4 }}>
                            <strong style={{ lineHeight: 1.2 }}>
                              {row.shiftProjection.shiftPatternLabel} · {row.shiftProjection.currentStateLabel}
                            </strong>
                            <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>
                              Día {row.shiftProjection.currentBlockDay}/{row.shiftProjection.currentBlockTotal}
                            </span>
                            <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>
                              Próx. cambio: {formatDisplayDate(row.shiftProjection.nextBlockStart)}
                            </span>
                          </div>
                        ) : (
                          "Sin turno"
                        )}
                      </td>
                      <td>{row.worker.contractEndDate ? formatDisplayDate(row.worker.contractEndDate) : "Sin fecha"}</td>
                      <td>{row.worker.altitudeExamDueDate ? formatDisplayDate(row.worker.altitudeExamDueDate) : "Sin fecha"}</td>
                      <td>{row.worker.accreditationDueDate ? formatDisplayDate(row.worker.accreditationDueDate) : "Sin fecha"}</td>
                      <td>{row.nearest?.date ? `${row.nearest.label} · ${formatDisplayDate(row.nearest.date)}` : "Sin fechas"}</td>
                      <td>
                        <span className={`status-pill ${row.overallStatus}`}>
                          {row.expiredCount > 0 ? `${row.expiredCount} vencido(s)` : row.dueSoonCount > 0 ? `${row.dueSoonCount} por vencer` : "OK"}
                        </span>
                      </td>
                      <td>
                        <Link href={`/trabajadores/${row.worker.id}`} className="dashboard-mini-link">
                          Editar
                        </Link>
                      </td>
                    </tr>
                  ))}
                  {staffRows.length === 0 ? (
                    <tr>
                      <td colSpan={10} style={{ color: "var(--muted)" }}>
                        No hay trabajadores cargados todavía.
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
