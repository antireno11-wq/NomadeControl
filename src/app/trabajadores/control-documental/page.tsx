import Link from "next/link";
import { isAdminRole, TRABAJADORES_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { SectionTabs } from "@/components/section-tabs";
import { buildTrabajadoresTabs } from "@/lib/section-nav";
import { formatDisplayDate } from "@/lib/report-utils";
import { ESTADO_STYLE, esEstadoOk, type EstadoDocumento } from "@/lib/acreditacion";
import { getTiposDocumento, getEstadoDocumental } from "@/lib/acreditacion-db";

type SearchParams = {
  campId?: string | string[];
  estado?: string | string[];
  tipo?: string | string[];
  q?: string | string[];
};

function normalizeText(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

function normalizeRut(s: string) {
  return s.replace(/[.\-\s]/g, "").toLowerCase();
}

const ESTADOS_FILTRABLES: Array<{ value: EstadoDocumento; label: string }> = [
  { value: "vencido",    label: "🔴 Vencidos" },
  { value: "por_vencer", label: "🟡 Por vencer (30d)" },
  { value: "sin_fecha",  label: "⚪ Sin cargar" },
];

function estadoParam(s: string | string[] | undefined): EstadoDocumento | "" {
  const v = typeof s === "string" ? s : "";
  return ESTADOS_FILTRABLES.some(e => e.value === v) ? (v as EstadoDocumento) : "";
}

export default async function ControlDocumentalPage({ searchParams }: { searchParams?: SearchParams }) {
  const user = await requireRole(TRABAJADORES_ROLES);
  const canSeeAdmin = isAdminRole(user.role);
  // Los 3 niveles (Admin / Operativo / Consulta) ven todos los trabajadores.
  const canSeeAllStaff = true;

  const selectedCampId = typeof searchParams?.campId === "string" && searchParams.campId !== "general" ? searchParams.campId : undefined;
  const filtroEstado = estadoParam(searchParams?.estado);
  const busqueda = typeof searchParams?.q === "string" ? searchParams.q.trim() : "";

  const [camps, staff, tipos] = await Promise.all([
    db.camp.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    db.staffMember.findMany({
      where: {
        isActive: true,
        ...(selectedCampId ? { campId: selectedCampId } : {}),
      },
      include: { camp: true },
      orderBy: [{ fullName: "asc" }],
    }),
    getTiposDocumento(true),
  ]);

  const filtroTipo = (() => {
    const v = typeof searchParams?.tipo === "string" ? searchParams.tipo : "";
    return tipos.some(t => t.id === v) ? v : "";
  })();

  const today = new Date();
  const estadoPorTrabajador = await getEstadoDocumental(staff.map(w => w.id), tipos, today);

  const rows = staff.map(worker => {
    const estado = estadoPorTrabajador.get(worker.id)!;
    return { worker, estado };
  });

  // ── Búsqueda por nombre o RUT ──
  const queryNorm = busqueda ? normalizeText(busqueda) : "";
  const queryRut = busqueda ? normalizeRut(busqueda) : "";
  const matchesBusqueda = (worker: (typeof rows)[number]["worker"]) => {
    if (!busqueda) return true;
    if (normalizeText(worker.fullName).includes(queryNorm)) return true;
    const rutNorm = normalizeRut(worker.nationalId ?? "");
    return Boolean(rutNorm && rutNorm.includes(queryRut));
  };

  const filteredRows = rows.filter(r => {
    if (!matchesBusqueda(r.worker)) return false;

    if (filtroTipo) {
      const entry = r.estado.porTipo.get(filtroTipo);
      if (!entry) return false;
      if (filtroEstado && entry.estado !== filtroEstado) return false;
      return true;
    }

    if (filtroEstado === "vencido"    && r.estado.vencidos === 0) return false;
    if (filtroEstado === "por_vencer" && r.estado.porVencer === 0) return false;
    if (filtroEstado === "sin_fecha"  && r.estado.sinFecha === 0) return false;
    return true;
  });

  // ── KPIs globales ──
  const totalDocs  = rows.length * tipos.length;
  const totalOk    = rows.reduce((s, r) => s + r.estado.ok, 0);
  const totalExp   = rows.reduce((s, r) => s + r.estado.vencidos, 0);
  const totalDue   = rows.reduce((s, r) => s + r.estado.porVencer, 0);
  const totalMiss  = rows.reduce((s, r) => s + r.estado.sinFecha, 0);
  const compliance = totalDocs === 0 ? 100 : Math.round((totalOk / totalDocs) * 100);
  const workersAtRisk = rows.filter(r => r.estado.vencidos > 0 || r.estado.porVencer > 0).length;

  // ── Próximos vencimientos (60 días) ──
  const tipoNombre = new Map(tipos.map(t => [t.id, t.nombre]));
  const upcoming = rows.flatMap(r =>
    Array.from(r.estado.porTipo.values())
      .filter(e => e.documento?.fechaVencimiento && e.dias != null && e.dias >= -3 && e.dias <= 60)
      .map(e => ({
        workerId: r.worker.id,
        workerName: r.worker.fullName,
        campName: r.worker.camp?.name ?? "Sin asignar",
        label: tipoNombre.get(e.tipoId) ?? "",
        date: e.documento!.fechaVencimiento!,
        dias: e.dias!,
        estado: e.estado,
      }))
  ).sort((a, b) => a.dias - b.dias);

  return (
    <AppShell
      title="Control documental"
      user={user}
      activeNav="trabajadores"
      showAdminSections={canSeeAdmin}
      rightSlot={
        canSeeAllStaff ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link href="/trabajadores/control-documental/extraer">
              <button type="button" style={{ background: "linear-gradient(135deg, #7c3aed, #a855f7)", border: "none", color: "#fff", padding: "8px 14px", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}>
                🤖 Extraer con IA
              </button>
            </Link>
            <Link href="/trabajadores/importar">
              <button type="button" style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text)", padding: "8px 14px", borderRadius: 8, fontWeight: 600, cursor: "pointer" }}>
                ⬆ Importar Excel
              </button>
            </Link>
            <Link href="/trabajadores/nuevo">
              <button type="button">+ Nuevo trabajador</button>
            </Link>
          </div>
        ) : undefined
      }
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
            <div className="dashboard-kpi-label">Sin cargar</div>
            <div className="dashboard-kpi-value">{totalMiss}</div>
            <div className="dashboard-kpi-meta">ficha incompleta</div>
          </div>
        </div>

        {/* ── Buscador + Filtros ── */}
        <div className="card">
          <form method="get" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label htmlFor="q" style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", marginBottom: 4 }}>
                Buscar trabajador
              </label>
              <div style={{ position: "relative" }}>
                <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: "1rem", color: "var(--muted)", pointerEvents: "none" }}>🔍</span>
                <input
                  id="q" name="q" type="search" defaultValue={busqueda}
                  placeholder="Escribe nombre, apellido o RUT — ej. Juan Pérez, 12345678, 12.345.678-9"
                  style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px 10px 38px", fontSize: "0.92rem", borderRadius: 10, border: "1.5px solid var(--border)" }}
                  autoComplete="off"
                />
              </div>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
              <div>
                <label htmlFor="campId" style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", marginBottom: 4 }}>Campamento</label>
                <select id="campId" name="campId" defaultValue={selectedCampId ?? "general"}>
                  <option value="general">Todos</option>
                  {camps.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="estado" style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", marginBottom: 4 }}>Estado</label>
                <select id="estado" name="estado" defaultValue={filtroEstado}>
                  <option value="">Todos</option>
                  {ESTADOS_FILTRABLES.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="tipo" style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", marginBottom: 4 }}>Tipo de documento</label>
                <select id="tipo" name="tipo" defaultValue={filtroTipo}>
                  <option value="">Todos</option>
                  {tipos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                </select>
              </div>
              <button type="submit">Aplicar</button>
              {(busqueda || selectedCampId || filtroEstado || filtroTipo) && (
                <Link href="/trabajadores/control-documental">
                  <button type="button" className="secondary">Limpiar</button>
                </Link>
              )}
            </div>

            {busqueda && (
              <div style={{ fontSize: "0.82rem", color: "var(--muted)" }}>
                Mostrando <strong>{filteredRows.length}</strong> resultado{filteredRows.length !== 1 ? "s" : ""} para <strong>&quot;{busqueda}&quot;</strong>
              </div>
            )}
          </form>
        </div>

        {/* ── Próximos vencimientos ── */}
        {upcoming.length > 0 && (
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: "1rem" }}>⏰ Próximos vencimientos (60 días)</h2>
              <span className="dashboard-chip small">{upcoming.length} eventos</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {upcoming.slice(0, 12).map((u, i) => {
                const style = ESTADO_STYLE[u.estado];
                return (
                  <Link key={i} href={`/trabajadores/${u.workerId}?tab=documentos`} style={{ textDecoration: "none" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", borderRadius: 8, background: style.bg, border: `1px solid ${style.border}`, cursor: "pointer" }}>
                      <div style={{ display: "flex", gap: 12, alignItems: "baseline", minWidth: 0 }}>
                        <strong style={{ color: style.color, minWidth: 140 }}>{u.label}</strong>
                        <span style={{ color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.workerName}</span>
                        <span style={{ color: "var(--muted)", fontSize: "0.82rem" }}>{u.campName}</span>
                      </div>
                      <div style={{ display: "flex", gap: 12, alignItems: "center", flexShrink: 0 }}>
                        <span style={{ color: "var(--text)", fontSize: "0.85rem" }}>{formatDisplayDate(u.date)}</span>
                        <span style={{ color: style.color, fontWeight: 700, fontSize: "0.82rem", minWidth: 70, textAlign: "right" }}>
                          {u.dias < 0 ? `${Math.abs(u.dias)}d vencido` : u.dias === 0 ? "Vence hoy" : `${u.dias}d`}
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

        {/* ── Matriz ── */}
        <div className="card table-card" style={{ padding: 0 }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <h2 style={{ margin: 0, fontSize: "1rem" }}>Matriz de documentos por trabajador</h2>
            <span className="dashboard-chip small">{filteredRows.length} trabajadores</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="dashboard-table" style={{ width: "100%", tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: 220 }} />
                {tipos.map((t) => <col key={t.id} />)}
              </colgroup>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Trabajador</th>
                  {tipos.map((t) => (
                    <th key={t.id} title={t.nombre} style={{ whiteSpace: "nowrap", textAlign: "center", fontSize: "0.72rem", padding: "8px 4px" }}>
                      {t.etiquetaCorta ?? t.nombre}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={tipos.length + 1} style={{ textAlign: "center", padding: 32, color: "var(--muted)" }}>
                      No hay trabajadores con estos filtros.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map(({ worker, estado }) => (
                    <tr key={worker.id}>
                      <td style={{ padding: "8px 12px" }}>
                        <Link href={`/trabajadores/${worker.id}?tab=documentos`} style={{ textDecoration: "none", color: "inherit", display: "block" }}>
                          <div style={{ fontWeight: 600, color: "var(--teal)", fontSize: "0.9rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {worker.fullName}
                          </div>
                          <div style={{ color: "var(--muted)", fontSize: "0.72rem", display: "flex", gap: 8, flexWrap: "wrap" }}>
                            {worker.nationalId && <span>{worker.nationalId}</span>}
                            {worker.camp?.name && <span>· {worker.camp.name}</span>}
                          </div>
                        </Link>
                      </td>
                      {tipos.map((t) => {
                        const e = estado.porTipo.get(t.id)!;
                        const style = ESTADO_STYLE[e.estado];
                        const calculada = e.documento?.vencimientoCalculado;
                        return (
                          <td key={t.id} style={{ textAlign: "center", padding: "4px 3px" }}>
                            <div
                              title={`${t.nombre}: ${style.label}${calculada ? " · fecha calculada, no impresa" : ""}`}
                              style={{
                                display: "inline-block", padding: "4px 4px", borderRadius: 5,
                                background: style.bg, color: style.color,
                                border: `1px solid ${style.border}`,
                                fontSize: "0.7rem", fontWeight: 600, lineHeight: 1.2,
                                width: "100%", boxSizing: "border-box",
                                // Borde punteado = vigencia inferida, no impresa en el documento
                                borderStyle: calculada ? "dashed" : "solid",
                              }}
                            >
                              {e.estado === "sin_vencimiento"
                                ? "∞"
                                : e.documento?.fechaVencimiento
                                  ? formatDisplayDate(e.documento.fechaVencimiento)
                                  : "—"}
                              {(e.estado === "vencido" || e.estado === "por_vencer") && e.dias != null && (
                                <div style={{ fontSize: "0.62rem", fontWeight: 500, opacity: 0.9 }}>
                                  {e.estado === "vencido" ? `${Math.abs(e.dias)}d vencido` : `en ${e.dias}d`}
                                </div>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Leyenda ── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, padding: "0 4px" }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: "0.8rem", color: "var(--muted)" }}>
            {(Object.keys(ESTADO_STYLE) as EstadoDocumento[]).map((key) => {
              const s = ESTADO_STYLE[key];
              return (
                <div key={key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 3, background: s.bg, border: `1px solid ${s.border}`, display: "inline-block" }} />
                  {s.label}
                </div>
              );
            })}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: "#fff", border: "1px dashed #94a3b8", display: "inline-block" }} />
              Fecha calculada
            </div>
          </div>
          {canSeeAllStaff && (
            <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
              💡 Click en el nombre para abrir la ficha y editar fechas
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
