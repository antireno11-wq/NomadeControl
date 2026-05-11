import Link from "next/link";
import { OPERATION_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import type { CierreContrato } from "@prisma/client";

// ─── Types ────────────────────────────────────────────────────────────────────

type SearchParams = {
  q?: string;
  recontratar?: string;
  camp?: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tipoLabel(tipo: string): string {
  const map: Record<string, string> = {
    finiquito: "Finiquito",
    no_renovacion: "No renovación",
    renuncia: "Renuncia",
    mutuo_acuerdo: "Mutuo acuerdo",
    otro: "Otro",
  };
  return map[tipo] ?? tipo;
}

function evalColor(value: string): string {
  if (["excelente", "buena", "bueno"].includes(value)) return "#146c3d";
  if (value === "regular") return "#9a6300";
  if (["malo", "mala"].includes(value)) return "#9e2f23";
  return "#64748b";
}

function evalBg(value: string): string {
  if (["excelente", "buena", "bueno"].includes(value)) return "#e8f7ef";
  if (value === "regular") return "#fff4dc";
  if (["malo", "mala"].includes(value)) return "#fce9e8";
  return "#f1f5f9";
}

function prioridadLabel(p: string): string {
  const map: Record<string, string> = {
    inmediata: "Inmediata",
    normal: "Normal",
    baja: "Baja",
    no_aplica: "No aplica",
  };
  return map[p] ?? p;
}

function prioridadColor(p: string): { bg: string; color: string } {
  if (p === "inmediata") return { bg: "#fce9e8", color: "#9e2f23" };
  if (p === "normal")    return { bg: "#e8f7ef", color: "#146c3d" };
  if (p === "baja")      return { bg: "#f1f5f9", color: "#64748b" };
  return { bg: "#f1f5f9", color: "#64748b" };
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" });
}

function initials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

// ─── Evaluation mini-grid ─────────────────────────────────────────────────────

function EvalGrid({ cierre }: { cierre: CierreContrato }) {
  const items: Array<{ key: string; value: string }> = [
    { key: "D", value: cierre.desempenoGeneral },
    { key: "P", value: cierre.puntualidad },
    { key: "T", value: cierre.trabajoEnEquipo },
    { key: "C", value: cierre.calidadTrabajo },
    { key: "S", value: cierre.actitudSeguridad },
  ];

  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      {items.map(({ key, value }) => (
        <span
          key={key}
          title={value}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 26,
            height: 26,
            borderRadius: 6,
            fontSize: "0.72rem",
            fontWeight: 700,
            background: evalBg(value),
            color: evalColor(value),
            border: `1px solid ${evalColor(value)}30`,
            cursor: "default",
          }}
        >
          {key}
        </span>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function ExTrabajadoresPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const user = await requireRole(OPERATION_ROLES);

  const recontratarFilter = searchParams?.recontratar;

  const [workers, camps] = await Promise.all([
    db.staffMember.findMany({
      where: {
        isActive: false,
        NOT: { cierre: null },
        ...(searchParams?.q
          ? { fullName: { contains: searchParams.q, mode: "insensitive" } }
          : {}),
        ...(recontratarFilter === "si"
          ? { cierre: { recontratarRecomendado: true } }
          : {}),
        ...(recontratarFilter === "no"
          ? { cierre: { recontratarRecomendado: false } }
          : {}),
        ...(searchParams?.camp ? { campId: searchParams.camp } : {}),
      },
      include: { camp: true, cierre: true },
      orderBy: [
        { cierre: { recontratarRecomendado: "desc" } },
        { cierre: { fechaCierre: "desc" } },
      ],
    }),
    db.camp.findMany({ orderBy: { name: "asc" } }),
  ]);

  const total = workers.length;
  const siRecontratar = workers.filter((w) => w.cierre?.recontratarRecomendado === true).length;
  const noRecontratar = workers.filter((w) => w.cierre?.recontratarRecomendado === false).length;

  return (
    <AppShell
      title="Ex trabajadores"
      user={user}
      activeNav="trabajadores"
      rightSlot={
        <Link href="/trabajadores">
          <button type="button" style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text)" }}>
            ← Trabajadores
          </button>
        </Link>
      }
    >
      <div className="page-stack">
        {/* ── KPI cards ── */}
        <div className="dashboard-kpi-grid insight-kpi-grid">
          <div className="dashboard-kpi teal">
            <div className="dashboard-kpi-label">Total ex-trabajadores</div>
            <div className="dashboard-kpi-value">{total}</div>
            <div className="dashboard-kpi-meta">con evaluación de salida</div>
          </div>
          <div className="dashboard-kpi" style={{ borderTop: "3px solid #16a34a" }}>
            <div className="dashboard-kpi-label" style={{ color: "#146c3d" }}>Recomendados</div>
            <div className="dashboard-kpi-value" style={{ color: "#16a34a" }}>{siRecontratar}</div>
            <div className="dashboard-kpi-meta">para recontratar</div>
          </div>
          <div className="dashboard-kpi" style={{ borderTop: "3px solid #dc2626" }}>
            <div className="dashboard-kpi-label" style={{ color: "#9e2f23" }}>No recomendados</div>
            <div className="dashboard-kpi-value" style={{ color: "#dc2626" }}>{noRecontratar}</div>
            <div className="dashboard-kpi-meta">para recontratar</div>
          </div>
        </div>

        {/* ── Filters ── */}
        <div className="card" style={{ padding: "1rem 1.25rem" }}>
          <form method="get" action="/trabajadores/ex-trabajadores" style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: "0.78rem", color: "var(--muted)", fontWeight: 600 }}>Nombre</label>
              <input
                name="q"
                type="text"
                placeholder="Buscar por nombre..."
                defaultValue={searchParams?.q ?? ""}
                style={{ padding: "0.4rem 0.6rem", border: "1px solid var(--border)", borderRadius: 6, fontSize: "0.9rem", minWidth: 220 }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: "0.78rem", color: "var(--muted)", fontWeight: 600 }}>¿Recontratar?</label>
              <select
                name="recontratar"
                defaultValue={searchParams?.recontratar ?? ""}
                style={{ padding: "0.4rem 0.6rem", border: "1px solid var(--border)", borderRadius: 6, fontSize: "0.9rem" }}
              >
                <option value="">Todos</option>
                <option value="si">Sí recontratar</option>
                <option value="no">No recontratar</option>
              </select>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: "0.78rem", color: "var(--muted)", fontWeight: 600 }}>Campamento</label>
              <select
                name="camp"
                defaultValue={searchParams?.camp ?? ""}
                style={{ padding: "0.4rem 0.6rem", border: "1px solid var(--border)", borderRadius: 6, fontSize: "0.9rem" }}
              >
                <option value="">Todos los campamentos</option>
                {camps.map((camp) => (
                  <option key={camp.id} value={camp.id}>
                    {camp.name}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" style={{ padding: "0.45rem 1.1rem", borderRadius: 6, fontWeight: 600, fontSize: "0.9rem" }}>
              Filtrar
            </button>
          </form>
        </div>

        {/* ── Table ── */}
        <div className="card">
          <div className="dashboard-table-wrap">
            <table className="dashboard-table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Campamento</th>
                  <th>Cierre</th>
                  <th>Evaluación</th>
                  <th>¿Recontratar?</th>
                  <th>Prioridad</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {workers.map((worker) => {
                  const cierre = worker.cierre;
                  if (!cierre) return null;

                  const prioridad = prioridadColor(cierre.prioridadRecontratacion);

                  return (
                    <tr key={worker.id}>
                      {/* Nombre + avatar */}
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                          <div
                            style={{
                              width: 36,
                              height: 36,
                              borderRadius: "50%",
                              background: "var(--teal, #0d9488)",
                              color: "#fff",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontWeight: 700,
                              fontSize: "0.78rem",
                              flexShrink: 0,
                            }}
                          >
                            {initials(worker.fullName)}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, color: "var(--text)" }}>{worker.fullName}</div>
                            {worker.role && (
                              <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>{worker.role}</div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Campamento */}
                      <td style={{ color: "var(--text)" }}>{worker.camp.name}</td>

                      {/* Fecha cierre + tipo badge */}
                      <td>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          <span style={{ fontWeight: 500, color: "var(--text)", fontSize: "0.88rem" }}>
                            {formatDate(cierre.fechaCierre)}
                          </span>
                          <span
                            style={{
                              display: "inline-block",
                              padding: "1px 8px",
                              borderRadius: 12,
                              fontSize: "0.72rem",
                              fontWeight: 600,
                              background: "#f1f5f9",
                              color: "#475569",
                              border: "1px solid #cbd5e1",
                              width: "fit-content",
                            }}
                          >
                            {tipoLabel(cierre.tipo)}
                          </span>
                        </div>
                      </td>

                      {/* Evaluación */}
                      <td>
                        <EvalGrid cierre={cierre} />
                      </td>

                      {/* ¿Recontratar? */}
                      <td>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            padding: "3px 10px",
                            borderRadius: 12,
                            fontSize: "0.82rem",
                            fontWeight: 700,
                            background: cierre.recontratarRecomendado ? "#e8f7ef" : "#fce9e8",
                            color: cierre.recontratarRecomendado ? "#146c3d" : "#9e2f23",
                            border: `1px solid ${cierre.recontratarRecomendado ? "#b6e8c8" : "#f5c0bb"}`,
                          }}
                        >
                          {cierre.recontratarRecomendado ? "✓ Sí" : "✗ No"}
                        </span>
                      </td>

                      {/* Prioridad */}
                      <td>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "3px 10px",
                            borderRadius: 12,
                            fontSize: "0.78rem",
                            fontWeight: 600,
                            background: prioridad.bg,
                            color: prioridad.color,
                            border: `1px solid ${prioridad.color}30`,
                          }}
                        >
                          {prioridadLabel(cierre.prioridadRecontratacion)}
                        </span>
                      </td>

                      {/* Acciones */}
                      <td>
                        <Link href={`/trabajadores/${worker.id}?tab=contrato`}>
                          <button
                            type="button"
                            style={{
                              padding: "4px 10px",
                              fontSize: "0.8rem",
                              borderRadius: 6,
                              background: "transparent",
                              border: "1px solid var(--border)",
                              color: "var(--text)",
                              cursor: "pointer",
                              whiteSpace: "nowrap",
                            }}
                          >
                            Ver perfil
                          </button>
                        </Link>
                      </td>
                    </tr>
                  );
                })}

                {workers.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ color: "var(--muted)", textAlign: "center", padding: "2rem 1rem" }}>
                      No hay ex-trabajadores registrados con evaluación de salida.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
