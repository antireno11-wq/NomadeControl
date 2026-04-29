import Link from "next/link";
import { requireRole, EVALUACIONES_ROLES, isAdminRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";

type SearchParams = { status?: string; q?: string };

function puntajeColor(p: number | null) {
  if (p === null) return "#94a3b8";
  if (p >= 4.5) return "#16a34a";
  if (p >= 3.5) return "#2563eb";
  if (p >= 2.5) return "#f59e0b";
  return "#dc2626";
}

function puntajeLabel(p: number | null) {
  if (p === null) return "Sin calificar";
  if (p >= 4.5) return "Sobre excede";
  if (p >= 3.5) return "Excede";
  if (p >= 2.5) return "Cumple lo esperado";
  if (p >= 1.5) return "Cumple parcialmente";
  return "No cumple";
}

function statusMsg(s?: string) {
  if (s === "created")  return { type: "success", text: "Evaluación guardada correctamente." };
  if (s === "updated")  return { type: "success", text: "Evaluación actualizada correctamente." };
  if (s === "deleted")  return { type: "success", text: "Evaluación eliminada." };
  if (s === "invalid")  return { type: "error",   text: "Revisá los datos ingresados." };
  return null;
}

export default async function EvaluacionesPage({ searchParams }: { searchParams?: SearchParams }) {
  const user = await requireRole(EVALUACIONES_ROLES);
  const isAdmin = isAdminRole(user.role);
  const q = searchParams?.q?.trim() ?? "";
  const msg = statusMsg(searchParams?.status);

  const evaluaciones = await db.evaluacion.findMany({
    where: {
      ...(isAdmin ? {} : { evaluadorId: user.id }),
      ...(q ? { evaluadoNombre: { contains: q, mode: "insensitive" } } : {}),
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <AppShell title="Evaluaciones de Desempeño" user={user} activeNav="evaluaciones">
      <div style={{ display: "flex", flexDirection: "column", gap: 20, paddingTop: 8 }}>

        {/* Header row */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <form method="GET" style={{ display: "flex", gap: 8, flex: 1, maxWidth: 360 }}>
            <input
              name="q"
              defaultValue={q}
              placeholder="Buscar por nombre del evaluado…"
              style={{ flex: 1, borderRadius: 8, border: "1px solid var(--border)", padding: "8px 12px", background: "var(--surface)", color: "var(--text)", fontSize: "0.9rem" }}
            />
            <button type="submit" style={{ borderRadius: 8, padding: "8px 14px", fontSize: "0.85rem" }}>Buscar</button>
          </form>
          <Link href="/evaluaciones/nueva">
            <button style={{ borderRadius: 8, padding: "10px 18px", fontWeight: 700, fontSize: "0.9rem" }}>
              + Nueva evaluación
            </button>
          </Link>
        </div>

        {msg && (
          <div style={{ padding: "12px 16px", borderRadius: 10, background: msg.type === "success" ? "#dcfce7" : "#fee2e2", color: msg.type === "success" ? "#166534" : "#991b1b", fontWeight: 500, fontSize: "0.9rem" }}>
            {msg.text}
          </div>
        )}

        {/* Table */}
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          {evaluaciones.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>
              No hay evaluaciones{q ? ` para "${q}"` : ""}. <Link href="/evaluaciones/nueva" style={{ color: "var(--teal)", fontWeight: 600 }}>Crear primera evaluación →</Link>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "rgba(0,0,0,0.03)", borderBottom: "2px solid var(--border)" }}>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--muted)", fontWeight: 600 }}>Evaluado</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--muted)", fontWeight: 600 }}>Cargo</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--muted)", fontWeight: 600 }}>Período</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--muted)", fontWeight: 600 }}>Evaluador</th>
                    <th style={{ padding: "12px 16px", textAlign: "center", fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--muted)", fontWeight: 600 }}>Puntaje</th>
                    <th style={{ padding: "12px 16px", textAlign: "center", fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--muted)", fontWeight: 600 }}>Estado</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--muted)", fontWeight: 600 }}>Fecha</th>
                    <th style={{ padding: "12px 16px" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {evaluaciones.map((ev) => (
                    <tr key={ev.id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "12px 16px", fontWeight: 600, color: "var(--text)" }}>{ev.evaluadoNombre}</td>
                      <td style={{ padding: "12px 16px", color: "var(--muted)", fontSize: "0.88rem" }}>{ev.evaluadoCargo ?? "—"}</td>
                      <td style={{ padding: "12px 16px", color: "var(--text)", fontSize: "0.88rem" }}>{ev.periodo}</td>
                      <td style={{ padding: "12px 16px", color: "var(--muted)", fontSize: "0.88rem" }}>{ev.evaluadorNombre}</td>
                      <td style={{ padding: "12px 16px", textAlign: "center" }}>
                        {ev.puntajeTotal !== null ? (
                          <span style={{
                            display: "inline-block",
                            padding: "4px 12px",
                            borderRadius: 20,
                            fontWeight: 700,
                            fontSize: "0.9rem",
                            background: puntajeColor(ev.puntajeTotal) + "22",
                            color: puntajeColor(ev.puntajeTotal),
                            minWidth: 40,
                          }}>
                            {ev.puntajeTotal.toFixed(1)}
                          </span>
                        ) : (
                          <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: "12px 16px", textAlign: "center" }}>
                        <span style={{
                          display: "inline-block",
                          padding: "3px 10px",
                          borderRadius: 20,
                          fontSize: "0.78rem",
                          fontWeight: 600,
                          background: ev.estado === "completada" ? "#dcfce7" : "#fef9c3",
                          color: ev.estado === "completada" ? "#166534" : "#854d0e",
                        }}>
                          {ev.estado === "completada" ? "✓ Completada" : "Borrador"}
                        </span>
                      </td>
                      <td style={{ padding: "12px 16px", color: "var(--muted)", fontSize: "0.85rem" }}>
                        {ev.createdAt.toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" })}
                      </td>
                      <td style={{ padding: "12px 16px" }}>
                        <Link href={`/evaluaciones/${ev.id}`} style={{ color: "var(--teal)", fontWeight: 700, textDecoration: "none", fontSize: "0.88rem" }}>
                          Ver →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Summary stats */}
        {evaluaciones.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
            {[
              { label: "Total evaluaciones", value: evaluaciones.length },
              { label: "Completadas", value: evaluaciones.filter((e) => e.estado === "completada").length },
              { label: "Borradores", value: evaluaciones.filter((e) => e.estado === "borrador").length },
              {
                label: "Puntaje promedio",
                value: (() => {
                  const withScore = evaluaciones.filter((e) => e.puntajeTotal !== null);
                  if (withScore.length === 0) return "—";
                  const avg = withScore.reduce((acc: number, e) => acc + (e.puntajeTotal ?? 0), 0) / withScore.length;
                  return avg.toFixed(1);
                })()
              },
            ].map((stat) => (
              <div key={stat.label} className="card" style={{ padding: "16px 20px", textAlign: "center" }}>
                <div style={{ fontSize: "1.6rem", fontWeight: 800, color: "var(--teal)" }}>{stat.value}</div>
                <div style={{ fontSize: "0.78rem", color: "var(--muted)", marginTop: 4 }}>{stat.label}</div>
              </div>
            ))}
          </div>
        )}

      </div>
    </AppShell>
  );
}
