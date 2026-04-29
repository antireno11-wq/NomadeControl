import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole, EVALUACIONES_ROLES, isAdminRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { guardarEvaluacionAction, eliminarEvaluacionAction } from "../actions";
import { EvaluacionForm } from "../eval-form";

type Params = { id: string };
type SearchParams = { status?: string; modo?: string };

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

const COMPETENCIAS_LABELS: Record<string, string> = {
  planificacion: "Planificación",
  iniciativa: "Iniciativa",
  cooperacion: "Cooperación",
  responsabilidad: "Responsabilidad",
  convivenciaLaboral: "Convivencia Laboral",
  comunicacionSeg: "Comunicación (Seguridad)",
  indumentaria: "Uso y Cuidado de Indumentaria",
  elaboracionDocs: "Elaboración de Documentos",
  reportabilidad: "Reportabilidad",
  gestionAmbiente: "Gestión del Ambiente",
};

const SCORE_LABEL = ["", "No cumple", "Cumple parcialmente", "Cumple lo esperado", "Excede", "Sobre excede"];

function ScoreBar({ score }: { score: number | null }) {
  if (score === null) return <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>Sin calificar</span>;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ display: "flex", gap: 3 }}>
        {[1, 2, 3, 4, 5].map(i => (
          <div
            key={i}
            style={{
              width: 22,
              height: 22,
              borderRadius: 4,
              background: i <= score ? puntajeColor(score) : "var(--border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "0.75rem",
              fontWeight: i <= score ? 700 : 400,
              color: i <= score ? "white" : "var(--muted)",
            }}
          >
            {i}
          </div>
        ))}
      </div>
      <span style={{ fontSize: "0.82rem", color: "var(--muted)" }}>{SCORE_LABEL[score]}</span>
    </div>
  );
}

function statusMsg(s?: string) {
  if (s === "created") return { type: "success", text: "Evaluación creada correctamente." };
  if (s === "updated") return { type: "success", text: "Evaluación actualizada correctamente." };
  return null;
}

export default async function EvaluacionDetailPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams?: SearchParams;
}) {
  const user = await requireRole(EVALUACIONES_ROLES);
  const isAdmin = isAdminRole(user.role);
  const editing = searchParams?.modo === "editar";
  const msg = statusMsg(searchParams?.status);

  const ev = await db.evaluacion.findUnique({ where: { id: params.id } });
  if (!ev) notFound();

  // Solo puede ver el admin o el propio evaluador
  if (!isAdmin && ev.evaluadorId !== user.id) notFound();

  if (editing) {
    const [users, staffMembers] = await Promise.all([
      db.user.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, positionTitle: true } }),
      db.staffMember.findMany({ where: { isActive: true }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true, role: true } }),
    ]);
    const trabajadores = [
      ...users.map(u => ({ nombre: u.name, cargo: u.positionTitle ?? "" })),
      ...staffMembers.filter(s => !users.some(u => u.name === s.fullName)).map(s => ({ nombre: s.fullName, cargo: s.role ?? "" })),
    ].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

    return (
      <AppShell title="Editar Evaluación" user={user} activeNav="evaluaciones">
        <div style={{ marginBottom: 16 }}>
          <Link href={`/evaluaciones/${ev.id}`} style={{ color: "var(--teal)", textDecoration: "none", fontSize: "0.9rem", fontWeight: 600 }}>
            ← Volver a la evaluación
          </Link>
        </div>
        <EvaluacionForm
          action={guardarEvaluacionAction}
          evaluacion={ev}
          trabajadores={trabajadores}
          evaluadorNombre={user.name}
        />
      </AppShell>
    );
  }

  // Vista de lectura
  const competencias = [
    { group: "Competencias Transversales", items: ["planificacion", "iniciativa", "cooperacion", "responsabilidad", "convivenciaLaboral"] },
    { group: "Seguridad y Medio Ambiente", items: ["comunicacionSeg", "indumentaria", "elaboracionDocs", "reportabilidad", "gestionAmbiente"] },
  ];

  return (
    <AppShell title="Evaluación de Desempeño" user={user} activeNav="evaluaciones">
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

        {/* Breadcrumb + actions */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <Link href="/evaluaciones" style={{ color: "var(--teal)", textDecoration: "none", fontSize: "0.9rem", fontWeight: 600 }}>
            ← Volver a evaluaciones
          </Link>
          <div style={{ display: "flex", gap: 10 }}>
            <Link href={`/evaluaciones/${ev.id}?modo=editar`}>
              <button style={{ borderRadius: 8, padding: "8px 16px", fontSize: "0.88rem", fontWeight: 600 }}>
                ✏️ Editar
              </button>
            </Link>
            <form action={eliminarEvaluacionAction} onSubmit={(e) => { if (!confirm("¿Eliminar esta evaluación? Esta acción no se puede deshacer.")) e.preventDefault(); }}>
              <input type="hidden" name="id" value={ev.id} />
              <button type="submit" style={{ borderRadius: 8, padding: "8px 16px", fontSize: "0.88rem", fontWeight: 600, background: "var(--danger)", color: "white", border: "none", cursor: "pointer" }}>
                🗑 Eliminar
              </button>
            </form>
          </div>
        </div>

        {msg && (
          <div style={{ padding: "12px 16px", borderRadius: 10, background: "#dcfce7", color: "#166534", fontWeight: 500, fontSize: "0.9rem" }}>
            {msg.text}
          </div>
        )}

        {/* Header card */}
        <div className="card" style={{ padding: "20px 24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
            <div>
              <div style={{ fontSize: "1.3rem", fontWeight: 800, color: "var(--text)", marginBottom: 4 }}>
                {ev.evaluadoNombre}
              </div>
              {ev.evaluadoCargo && <div style={{ color: "var(--muted)", fontSize: "0.9rem" }}>{ev.evaluadoCargo}</div>}
              <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: "8px 20px" }}>
                <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>📅 Período: <strong style={{ color: "var(--text)" }}>{ev.periodo}</strong></span>
                {ev.proyecto && <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>🏗️ Proyecto: <strong style={{ color: "var(--text)" }}>{ev.proyecto}</strong></span>}
                <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>👤 Evaluador: <strong style={{ color: "var(--text)" }}>{ev.evaluadorNombre}</strong></span>
                <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>📆 Fecha: <strong style={{ color: "var(--text)" }}>{ev.createdAt.toLocaleDateString("es-CL", { day: "2-digit", month: "long", year: "numeric" })}</strong></span>
              </div>
            </div>

            {/* Puntaje total */}
            <div style={{ textAlign: "center", minWidth: 120 }}>
              <div style={{
                fontSize: "3rem",
                fontWeight: 900,
                color: puntajeColor(ev.puntajeTotal),
                lineHeight: 1,
              }}>
                {ev.puntajeTotal !== null ? ev.puntajeTotal.toFixed(1) : "—"}
              </div>
              <div style={{ fontSize: "0.8rem", fontWeight: 600, color: puntajeColor(ev.puntajeTotal), marginTop: 4 }}>
                {puntajeLabel(ev.puntajeTotal)}
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: 2 }}>puntaje final</div>
              <span style={{
                display: "inline-block",
                marginTop: 8,
                padding: "3px 12px",
                borderRadius: 20,
                fontSize: "0.78rem",
                fontWeight: 600,
                background: ev.estado === "completada" ? "#dcfce7" : "#fef9c3",
                color: ev.estado === "completada" ? "#166534" : "#854d0e",
              }}>
                {ev.estado === "completada" ? "✓ Completada" : "Borrador"}
              </span>
            </div>
          </div>
        </div>

        {/* Competencias */}
        {competencias.map(({ group, items }) => (
          <div key={group} className="card">
            <div style={{ fontWeight: 700, color: "var(--teal)", fontSize: "0.95rem", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 16 }}>
              {group}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {items.map(key => {
                const score = (ev as any)[key] as number | null;
                const comentKey = {
                  planificacion: ev.comentPlanificacion,
                  iniciativa: ev.comentIniciativa,
                  cooperacion: ev.comentCooperacion,
                  responsabilidad: ev.comentResponsabilidad,
                  convivenciaLaboral: ev.comentConvivencia,
                  comunicacionSeg: ev.comentComunicacion,
                  indumentaria: ev.comentIndumentaria,
                  elaboracionDocs: ev.comentElaboracion,
                  reportabilidad: ev.comentReportabilidad,
                  gestionAmbiente: ev.comentGestion,
                }[key];

                return (
                  <div key={key} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap", paddingBottom: 12, borderBottom: "1px solid var(--border)" }}>
                    <div style={{ fontWeight: 600, color: "var(--text)", minWidth: 200, flex: 1 }}>
                      {COMPETENCIAS_LABELS[key]}
                      {comentKey && (
                        <div style={{ fontSize: "0.82rem", color: "var(--muted)", fontWeight: 400, marginTop: 4, fontStyle: "italic" }}>
                          "{comentKey}"
                        </div>
                      )}
                    </div>
                    <div>
                      <ScoreBar score={score} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {/* Retroalimentación */}
        {(ev.oportunidadesMejora || ev.mantenerCargo || ev.reubicar || ev.promocion || ev.reconocimiento || ev.requiereCapacitacion || ev.observacionesFinales) && (
          <div className="card">
            <div style={{ fontWeight: 700, color: "var(--teal)", fontSize: "0.95rem", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 16 }}>
              Sesión de Retroalimentación
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {ev.oportunidadesMejora && (
                <div>
                  <div style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--muted)", marginBottom: 4 }}>OPORTUNIDADES DE MEJORA</div>
                  <p style={{ color: "var(--text)", fontSize: "0.9rem", lineHeight: 1.6, margin: 0 }}>{ev.oportunidadesMejora}</p>
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
                {[
                  { label: "¿Mantener en el cargo?", val: ev.mantenerCargo },
                  { label: "¿Reubicar?", val: ev.reubicar },
                  { label: "Promoción", val: ev.promocion },
                  { label: "Reconocimiento", val: ev.reconocimiento },
                  { label: "Capacitación requerida", val: ev.requiereCapacitacion },
                ].filter(i => i.val).map(item => (
                  <div key={item.label} style={{ background: "rgba(0,0,0,0.03)", borderRadius: 8, padding: "12px 14px" }}>
                    <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--muted)", marginBottom: 4, textTransform: "uppercase" }}>{item.label}</div>
                    <div style={{ fontSize: "0.9rem", color: "var(--text)", fontWeight: 500 }}>{item.val}</div>
                  </div>
                ))}
              </div>
              {ev.observacionesFinales && (
                <div>
                  <div style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--muted)", marginBottom: 4 }}>OBSERVACIONES FINALES</div>
                  <p style={{ color: "var(--text)", fontSize: "0.9rem", lineHeight: 1.6, margin: 0 }}>{ev.observacionesFinales}</p>
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </AppShell>
  );
}
