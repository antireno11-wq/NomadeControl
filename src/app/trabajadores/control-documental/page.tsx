import Link from "next/link";
import { canAccessEvaluaciones, isAdminRole, TRABAJADORES_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { SectionTabs } from "@/components/section-tabs";
import { buildTrabajadoresTabs } from "@/lib/section-nav";
import { STAFF_DOCUMENT_FIELDS, getStaffDocumentEntries } from "@/lib/staff-docs";
import { formatDisplayDate } from "@/lib/report-utils";

type SearchParams = {
  campId?: string | string[];
  estado?: string | string[];
  tipo?: string | string[];
};

const STATUS_STYLES: Record<string, { bg: string; color: string; border: string; label: string }> = {
  ok:      { bg: "#e8f7ef", color: "#146c3d", border: "#b6e8c8", label: "Vigente" },
  dueSoon: { bg: "#fff4dc", color: "#9a6300", border: "#f5d98e", label: "Por vencer" },
  expired: { bg: "#fce9e8", color: "#9e2f23", border: "#f5c0bb", label: "Vencido" },
  missing: { bg: "#f1f5f9", color: "#64748b", border: "#cbd5e1", label: "Sin fecha" },
};

function estadoParam(s: string | string[] | undefined) {
  const v = typeof s === "string" ? s : "";
  return ["expired", "dueSoon", "missing", ""].includes(v) ? v : "";
}

function tipoParam(s: string | string[] | undefined) {
  const v = typeof s === "string" ? s : "";
  return STAFF_DOCUMENT_FIELDS.find(f => f.key === v) ? v : "";
}

export default async function ControlDocumentalPage({ searchParams }: { searchParams?: SearchParams }) {
  const user = await requireRole(TRABAJADORES_ROLES);
  const canSeeAdmin = isAdminRole(user.role);
  const isHR = user.role === "RRHH";
  const canSeeAllStaff = canSeeAdmin || isHR;

  const selectedCampId = typeof searchParams?.campId === "string" && searchParams.campId !== "general" ? searchParams.campId : undefined;
  const filtroEstado = estadoParam(searchParams?.estado);
  const filtroTipo = tipoParam(searchParams?.tipo);

  const campFilter = !canSeeAllStaff ? user.campId ?? "__none__" : undefined;

  const [camps, staff] = await Promise.all([
    db.camp.findMany({
      where: { isActive: true, ...(campFilter ? { id: campFilter } : {}) },
      orderBy: { name: "asc" },
    }),
    db.staffMember.findMany({
      where: {
        isActive: true,
        ...(campFilter ? { campId: campFilter } : {}),
        ...(selectedCampId && canSeeAllStaff ? { campId: selectedCampId } : {}),
      },
      include: { camp: true },
      orderBy: [{ fullName: "asc" }],
    }),
  ]);

  const today = new Date();

  // Enriquecer con estado de documentos
  const rows = staff.map(w => {
    const entries = getStaffDocumentEntries(w, today);
    const expiredCount = entries.filter(e => e.status === "expired").length;
    const dueSoonCount = entries.filter(e => e.status === "dueSoon").length;
    const missingCount = entries.filter(e => e.status === "missing").length;
    const okCount      = entries.filter(e => e.status === "ok").length;
    return { worker: w, entries, expiredCount, dueSoonCount, missingCount, okCount };
  });

  // Filtro por estado (a nivel trabajador: si tiene al menos un doc en ese estado)
  const filteredRows = rows.filter(r => {
    if (filtroEstado === "expired" && r.expiredCount === 0) return false;
    if (filtroEstado === "dueSoon" && r.dueSoonCount === 0) return false;
    if (filtroEstado === "missing" && r.missingCount === 0) return false;
    if (filtroTipo) {
      const entry = r.entries.find(e => e.key === filtroTipo);
      if (!entry) return false;
      if (filtroEstado && entry.status !== filtroEstado) return false;
    }
    return true;
  });

  // KPIs globales (sobre todos los trabajadores, no filtrados)
  const totalDocs   = rows.reduce((s, r) => s + r.entries.length, 0);
  const totalOk     = rows.reduce((s, r) => s + r.okCount, 0);
  const totalExp    = rows.reduce((s, r) => s + r.expiredCount, 0);
  const totalDue    = rows.reduce((s, r) => s + r.dueSoonCount, 0);
  const totalMiss   = rows.reduce((s, r) => s + r.missingCount, 0);
  const compliance  = totalDocs === 0 ? 100 : Math.round((totalOk / totalDocs) * 100);
  const workersAtRisk = rows.filter(r => r.expiredCount > 0 || r.dueSoonCount > 0).length;

  // Próximos vencimientos (60 días) — todos los docs de todos los trabajadores
  const upcoming = rows.flatMap(r =>
    r.entries
      .filter(e => e.date && e.daysUntil != null && e.daysUntil >= -3 && e.daysUntil <= 60)
      .map(e => ({
        workerId: r.worker.id,
        workerName: r.worker.fullName,
        campName: r.worker.camp?.name ?? "Sin asignar",
        label: e.label,
        date: e.date!,
        daysUntil: e.daysUntil!,
        status: e.status,
      }))
  ).sort((a, b) => a.daysUntil - b.daysUntil);

  return (
    <AppShell
      title="Control documental"
      user={user}
      activeNav="trabajadores"
      showAdminSections={canSeeAdmin}
    >
      <div className="page-stack">
        <SectionTabs items={buildTrabajadoresTabs("control-documental")} />

        {/* ── KPIs ── */}
        <div className="dashboard-kpi-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
          <div className="dashboard-kpi teal">
            <div className="dashboard-kpi-label">% Cumplimiento</div>
            <div className="dashboard-kpi-value">{compliance}%</div>
            <div className="dashboard-kpi-meta">{totalOk} de {totalDocs} docs vigentes</div>
          </div>
          <div className="dashboard-kpi">
            <div className="dashboard-kpi-label">Trabajadores activos</div>
            <div className="dashboard-kpi-value">{rows.length}</div>
            <div className="dashboard-kpi-meta">{workersAtRisk} requieren atención</div>
          </div>
          <div className={`dashboard-kpi ${totalExp > 0 ? "accent" : ""}`}>
            <div className="dashboard-kpi-label">Documentos vencidos</div>
            <div className="dashboard-kpi-value">{totalExp}</div>
            <div className="dashboard-kpi-meta">acción inmediata</div>
          </div>
          <div className={`dashboard-kpi ${totalDue > 0 ? "accent" : ""}`}>
            <div className="dashboard-kpi-label">Por vencer (30d)</div>
            <div className="dashboard-kpi-value">{totalDue}</div>
            <div className="dashboard-kpi-meta">renovar pronto</div>
          </div>
          <div className="dashboard-kpi">
            <div className="dashboard-kpi-label">Sin fecha cargada</div>
            <div className="dashboard-kpi-value">{totalMiss}</div>
            <div className="dashboard-kpi-meta">ficha incompleta</div>
          </div>
        </div>

        {/* ── Filtros ── */}
        <div className="card">
          <form method="get" style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
            {canSeeAllStaff && (
              <div>
                <label htmlFor="campId" style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", marginBottom: 4 }}>
                  Campamento
                </label>
                <select id="campId" name="campId" defaultValue={selectedCampId ?? "general"}>
                  <option value="general">Todos</option>
                  {camps.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label htmlFor="estado" style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", marginBottom: 4 }}>
                Estado
              </label>
              <select id="estado" name="estado" defaultValue={filtroEstado}>
                <option value="">Todos</option>
                <option value="expired">🔴 Vencidos</option>
                <option value="dueSoon">🟡 Por vencer (30d)</option>
                <option value="missing">⚪ Sin fecha</option>
              </select>
            </div>
            <div>
              <label htmlFor="tipo" style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", marginBottom: 4 }}>
                Tipo de documento
              </label>
              <select id="tipo" name="tipo" defaultValue={filtroTipo}>
                <option value="">Todos</option>
                {STAFF_DOCUMENT_FIELDS.map((f) => (
                  <option key={f.key} value={f.key}>{f.label}</option>
                ))}
              </select>
            </div>
            <button type="submit">Aplicar filtros</button>
            {(selectedCampId || filtroEstado || filtroTipo) && (
              <Link href="/trabajadores/control-documental">
                <button type="button" className="secondary">Limpiar</button>
              </Link>
            )}
          </form>
        </div>

        {/* ── Próximos vencimientos (timeline compacto) ── */}
        {upcoming.length > 0 && (
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: "1rem" }}>⏰ Próximos vencimientos (60 días)</h2>
              <span className="dashboard-chip small">{upcoming.length} eventos</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {upcoming.slice(0, 12).map((u, i) => {
                const style = STATUS_STYLES[u.status] ?? STATUS_STYLES.ok;
                return (
                  <Link key={i} href={`/trabajadores/${u.workerId}?tab=documentos`} style={{ textDecoration: "none" }}>
                    <div style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "8px 12px", borderRadius: 8,
                      background: style.bg, border: `1px solid ${style.border}`,
                      cursor: "pointer",
                    }}>
                      <div style={{ display: "flex", gap: 12, alignItems: "baseline", minWidth: 0 }}>
                        <strong style={{ color: style.color, minWidth: 100 }}>{u.label}</strong>
                        <span style={{ color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.workerName}</span>
                        <span style={{ color: "var(--muted)", fontSize: "0.82rem" }}>{u.campName}</span>
                      </div>
                      <div style={{ display: "flex", gap: 12, alignItems: "center", flexShrink: 0 }}>
                        <span style={{ color: "var(--text)", fontSize: "0.85rem" }}>{formatDisplayDate(u.date)}</span>
                        <span style={{ color: style.color, fontWeight: 700, fontSize: "0.82rem", minWidth: 70, textAlign: "right" }}>
                          {u.daysUntil < 0 ? `${Math.abs(u.daysUntil)}d vencido` : u.daysUntil === 0 ? "Vence hoy" : `${u.daysUntil}d`}
                        </span>
                      </div>
                    </div>
                  </Link>
                );
              })}
              {upcoming.length > 12 && (
                <div style={{ textAlign: "center", color: "var(--muted)", fontSize: "0.82rem", marginTop: 4 }}>
                  y {upcoming.length - 12} más…
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Matriz principal: Trabajador × Documento ── */}
        <div className="card table-card" style={{ padding: 0 }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <h2 style={{ margin: 0, fontSize: "1rem" }}>Matriz de documentos por trabajador</h2>
            <span className="dashboard-chip small">{filteredRows.length} trabajadores</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="dashboard-table" style={{ minWidth: 1100 }}>
              <thead>
                <tr>
                  <th style={{ position: "sticky", left: 0, background: "var(--bg)", zIndex: 2 }}>Trabajador</th>
                  <th>Campamento</th>
                  {STAFF_DOCUMENT_FIELDS.map((f) => (
                    <th key={f.key} style={{ minWidth: 100, whiteSpace: "nowrap", textAlign: "center" }}>
                      {f.short}
                    </th>
                  ))}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={STAFF_DOCUMENT_FIELDS.length + 3} style={{ textAlign: "center", padding: 32, color: "var(--muted)" }}>
                      No hay trabajadores con estos filtros.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map(r => (
                    <tr key={r.worker.id}>
                      <td style={{ position: "sticky", left: 0, background: "#fff", fontWeight: 600, zIndex: 1 }}>
                        {r.worker.fullName}
                        {r.worker.nationalId && (
                          <div style={{ color: "var(--muted)", fontSize: "0.75rem", fontWeight: 400 }}>{r.worker.nationalId}</div>
                        )}
                      </td>
                      <td style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
                        {r.worker.camp?.name ?? "—"}
                      </td>
                      {r.entries.map((e) => {
                        const style = STATUS_STYLES[e.status];
                        return (
                          <td key={e.key} style={{ textAlign: "center", padding: 4 }}>
                            <div style={{
                              display: "inline-block",
                              padding: "5px 8px",
                              borderRadius: 6,
                              background: style.bg,
                              color: style.color,
                              border: `1px solid ${style.border}`,
                              fontSize: "0.75rem",
                              fontWeight: 600,
                              minWidth: 78,
                              whiteSpace: "nowrap",
                            }} title={`${e.label}: ${style.label}`}>
                              {e.date ? formatDisplayDate(e.date) : "—"}
                              {e.status !== "missing" && e.daysUntil != null && (
                                <div style={{ fontSize: "0.68rem", fontWeight: 500, opacity: 0.9 }}>
                                  {e.status === "expired"
                                    ? `${Math.abs(e.daysUntil)}d vencido`
                                    : e.status === "dueSoon"
                                      ? `${e.daysUntil}d`
                                      : "vigente"}
                                </div>
                              )}
                            </div>
                          </td>
                        );
                      })}
                      <td>
                        <Link href={`/trabajadores/${r.worker.id}?tab=documentos`} className="dashboard-mini-link" style={{ whiteSpace: "nowrap" }}>
                          Ver ficha →
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Leyenda de colores ── */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: "0.8rem", color: "var(--muted)", padding: "0 4px" }}>
          {Object.entries(STATUS_STYLES).map(([key, s]) => (
            <div key={key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: s.bg, border: `1px solid ${s.border}`, display: "inline-block" }} />
              {s.label}
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
