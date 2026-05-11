import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole, OPERATION_ROLES, isSupervisorRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { terminarContratoAction } from "@/app/trabajadores/actions";
import { formatDisplayDate } from "@/lib/report-utils";

// ─── helpers ─────────────────────────────────────────────────────────────────

const TIPO_LABELS: Record<string, string> = {
  finiquito: "Finiquito",
  no_renovacion: "No renovación",
  renuncia: "Renuncia",
  mutuo_acuerdo: "Mutuo acuerdo",
  otro: "Otro",
};

const DESEMPENO_LABELS: Record<string, string> = {
  excelente: "Excelente",
  bueno: "Bueno",
  regular: "Regular",
  malo: "Malo",
};

const PRIORIDAD_LABELS: Record<string, string> = {
  inmediata: "Inmediata",
  normal: "Normal",
  baja: "Baja",
  no_aplica: "No aplica",
};

// ─── page ─────────────────────────────────────────────────────────────────────

export default async function TerminarContratoPage({
  params,
}: {
  params: { id: string };
}) {
  const user = await requireRole(OPERATION_ROLES);

  const worker = await db.staffMember.findUnique({
    where: { id: params.id },
    include: { camp: true, cierre: true },
  });

  if (!worker) notFound();

  if (isSupervisorRole(user.role) && worker.campId !== user.campId) {
    return (
      <AppShell
        title={`Terminar contrato — ${worker.fullName}`}
        user={user}
        activeNav="trabajadores"
        rightSlot={
          <Link href={`/trabajadores/${params.id}?tab=contrato`}>
            <button type="button" className="secondary">← Volver</button>
          </Link>
        }
      >
        <div className="page-stack">
          <div className="card" style={{ maxWidth: 520, padding: "24px 28px" }}>
            <p style={{ color: "var(--muted)", margin: 0, fontSize: "0.95rem" }}>
              No tienes permiso para terminar el contrato de un trabajador de otro campamento.
            </p>
          </div>
        </div>
      </AppShell>
    );
  }

  // ── Ya procesado ──────────────────────────────────────────────────────────
  if (worker.cierre && !worker.isActive) {
    const c = worker.cierre;
    return (
      <AppShell
        title={`Terminar contrato — ${worker.fullName}`}
        user={user}
        activeNav="trabajadores"
        rightSlot={
          <Link href={`/trabajadores/${params.id}?tab=contrato`}>
            <button type="button" className="secondary">← Volver</button>
          </Link>
        }
      >
        <div className="page-stack">
          <div className="card" style={{ maxWidth: 680 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "5px 14px", borderRadius: 20,
                background: "#fee2e2", color: "#991b1b",
                fontWeight: 700, fontSize: "0.82rem",
              }}>
                Inactivo · Contrato terminado
              </span>
            </div>

            <h2 style={{ margin: "0 0 20px", fontSize: "1.05rem", color: "var(--text)" }}>
              Registro de cierre de contrato
            </h2>

            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
              gap: 14,
              marginBottom: 20,
            }}>
              {[
                { label: "Tipo de término", value: TIPO_LABELS[c.tipo] ?? c.tipo },
                {
                  label: "Fecha de cierre",
                  value: formatDisplayDate(c.fechaCierre),
                },
                {
                  label: "Motivo / Contexto",
                  value: c.motivoCierre ?? "—",
                },
                { label: "Desempeño general", value: DESEMPENO_LABELS[c.desempenoGeneral] ?? c.desempenoGeneral },
                {
                  label: "¿Recontratar?",
                  value: c.recontratarRecomendado ? "Sí" : "No",
                },
                {
                  label: "Prioridad de recontratación",
                  value: PRIORIDAD_LABELS[c.prioridadRecontratacion] ?? c.prioridadRecontratacion,
                },
                { label: "Evaluado por", value: c.evaluadoPorNombre },
                { label: "Observaciones", value: c.observaciones ?? "—" },
              ].map((item) => (
                <div
                  key={item.label}
                  style={{
                    padding: "12px 14px",
                    borderRadius: 10,
                    background: "rgba(0,0,0,0.03)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <div style={{
                    fontSize: "0.72rem",
                    color: "var(--muted)",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    marginBottom: 4,
                  }}>
                    {item.label}
                  </div>
                  <div style={{ fontWeight: 600, fontSize: "0.92rem", color: "var(--text)" }}>
                    {item.value}
                  </div>
                </div>
              ))}
            </div>

            <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0 0 20px" }}>
              Para modificar la evaluación, edita desde el perfil del trabajador.
            </p>

            <Link href={`/trabajadores/${params.id}?tab=contrato`}>
              <button type="button" className="secondary">← Volver al perfil</button>
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  // ── Formulario ────────────────────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);

  return (
    <AppShell
      title={`Terminar contrato — ${worker.fullName}`}
      user={user}
      activeNav="trabajadores"
      rightSlot={
        <Link href={`/trabajadores/${params.id}?tab=contrato`}>
          <button type="button" className="secondary">← Volver</button>
        </Link>
      }
    >
      <div className="page-stack">
        <form action={terminarContratoAction}>
          <input type="hidden" name="staffMemberId" value={params.id} />

          {/* ── Two-column layout ──────────────────────────────────────── */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 440px) minmax(0, 1fr)",
            gap: "1.5rem",
            alignItems: "start",
          }}>
            {/* ── Left: Información del cierre ────────────────────────── */}
            <div className="card">
              <h2 style={{ margin: "0 0 20px", fontSize: "1rem", color: "var(--text)" }}>
                Información del cierre
              </h2>

              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: 6, color: "var(--text)" }}>
                    Tipo de término <span style={{ color: "#dc2626" }}>*</span>
                  </label>
                  <select name="tipo" required style={{ width: "100%" }}>
                    <option value="">Selecciona...</option>
                    <option value="finiquito">Finiquito</option>
                    <option value="no_renovacion">No renovación</option>
                    <option value="renuncia">Renuncia</option>
                    <option value="mutuo_acuerdo">Mutuo acuerdo</option>
                    <option value="otro">Otro</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: 6, color: "var(--text)" }}>
                    Fecha de cierre <span style={{ color: "#dc2626" }}>*</span>
                  </label>
                  <input
                    type="date"
                    name="fechaCierre"
                    required
                    defaultValue={today}
                    style={{ width: "100%" }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: 6, color: "var(--text)" }}>
                    Motivo o contexto
                  </label>
                  <textarea
                    name="motivoCierre"
                    rows={3}
                    placeholder="Motivo o contexto del cierre..."
                    style={{ width: "100%", resize: "vertical" }}
                  />
                </div>
              </div>
            </div>

            {/* ── Right: Evaluación de salida ─────────────────────────── */}
            <div className="card">
              <h2 style={{ margin: "0 0 8px", fontSize: "1rem", color: "var(--text)" }}>
                Evaluación de salida
              </h2>
              <p style={{ margin: "0 0 20px", fontSize: "0.85rem", color: "var(--muted)", lineHeight: 1.5 }}>
                Esta evaluación queda en el registro interno y ayuda a decidir si podemos volver a convocar a esta persona.
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: 6, color: "var(--text)" }}>
                    Desempeño general <span style={{ color: "#dc2626" }}>*</span>
                  </label>
                  <select name="desempenoGeneral" required style={{ width: "100%" }}>
                    <option value="">Selecciona...</option>
                    <option value="excelente">Excelente</option>
                    <option value="bueno">Bueno</option>
                    <option value="regular">Regular</option>
                    <option value="malo">Malo</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: 6, color: "var(--text)" }}>
                    Puntualidad y asistencia <span style={{ color: "#dc2626" }}>*</span>
                  </label>
                  <select name="puntualidad" required style={{ width: "100%" }}>
                    <option value="">Selecciona...</option>
                    <option value="buena">Buena</option>
                    <option value="regular">Regular</option>
                    <option value="mala">Mala</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: 6, color: "var(--text)" }}>
                    Trabajo en equipo <span style={{ color: "#dc2626" }}>*</span>
                  </label>
                  <select name="trabajoEnEquipo" required style={{ width: "100%" }}>
                    <option value="">Selecciona...</option>
                    <option value="bueno">Bueno</option>
                    <option value="regular">Regular</option>
                    <option value="malo">Malo</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: 6, color: "var(--text)" }}>
                    Calidad del trabajo <span style={{ color: "#dc2626" }}>*</span>
                  </label>
                  <select name="calidadTrabajo" required style={{ width: "100%" }}>
                    <option value="">Selecciona...</option>
                    <option value="buena">Buena</option>
                    <option value="regular">Regular</option>
                    <option value="mala">Mala</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: 6, color: "var(--text)" }}>
                    Actitud frente a seguridad <span style={{ color: "#dc2626" }}>*</span>
                  </label>
                  <select name="actitudSeguridad" required style={{ width: "100%" }}>
                    <option value="">Selecciona...</option>
                    <option value="buena">Buena</option>
                    <option value="regular">Regular</option>
                    <option value="mala">Mala</option>
                  </select>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input
                    type="checkbox"
                    id="recontratarRecomendado"
                    name="recontratarRecomendado"
                    style={{ width: 18, height: 18, cursor: "pointer", flexShrink: 0 }}
                  />
                  <label
                    htmlFor="recontratarRecomendado"
                    style={{ fontSize: "0.88rem", fontWeight: 600, color: "var(--text)", cursor: "pointer" }}
                  >
                    ¿Recomendarías recontratar a esta persona?
                  </label>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: 6, color: "var(--text)" }}>
                    Prioridad de recontratación
                  </label>
                  <select name="prioridadRecontratacion" defaultValue="normal" style={{ width: "100%" }}>
                    <option value="inmediata">Inmediata</option>
                    <option value="normal">Normal</option>
                    <option value="baja">Baja</option>
                    <option value="no_aplica">No aplica</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: 6, color: "var(--text)" }}>
                    Observaciones internas
                  </label>
                  <textarea
                    name="observaciones"
                    rows={3}
                    placeholder="Notas internas sobre el trabajador..."
                    style={{ width: "100%", resize: "vertical" }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* ── Warning + submit ───────────────────────────────────────── */}
          <div style={{
            margin: "1.5rem 0 0",
            padding: "14px 18px",
            borderRadius: 10,
            background: "#fffbeb",
            border: "1px solid #fbbf24",
            color: "#92400e",
            fontSize: "0.9rem",
            fontWeight: 500,
            lineHeight: 1.5,
          }}>
            ⚠️ Esta acción marcará al trabajador como inactivo. Asegúrate de haber llenado toda la información correctamente.
          </div>

          <div style={{ marginTop: "1rem" }}>
            <button type="submit" className="danger" style={{ width: "100%", padding: "12px 20px", fontSize: "1rem" }}>
              Terminar contrato y guardar evaluación
            </button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
