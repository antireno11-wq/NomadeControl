import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { canAccessEvaluaciones, isAdminRole, isSupervisorRole, OPERATION_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { updateWorkerAction } from "@/app/trabajadores/actions";
import { WorkerForm } from "@/app/trabajadores/worker-form";
import { formatDisplayDate, toInputDateValue } from "@/lib/report-utils";
import { getStaffDocumentEntries } from "@/lib/staff-docs";
import { formatShiftRange, getShiftProjection } from "@/lib/shift-projection";

// ─── helpers ─────────────────────────────────────────────────────────────────

function docStatusStyle(status: "ok" | "dueSoon" | "expired" | "missing") {
  const map = {
    ok:       { bg: "#e8f7ef", color: "#146c3d", border: "#b6e8c8", label: "Al día" },
    dueSoon:  { bg: "#fff4dc", color: "#9a6300", border: "#f5d98e", label: "Por vencer" },
    expired:  { bg: "#fce9e8", color: "#9e2f23", border: "#f5c0bb", label: "Vencido" },
    missing:  { bg: "#f1f5f9", color: "#64748b", border: "#cbd5e1", label: "Sin fecha" },
  };
  return map[status];
}

function daysLabel(daysUntil: number | null) {
  if (daysUntil === null) return "—";
  if (daysUntil < 0) return `Venció hace ${Math.abs(daysUntil)} día${Math.abs(daysUntil) === 1 ? "" : "s"}`;
  if (daysUntil === 0) return "Vence hoy";
  if (daysUntil === 1) return "Vence mañana";
  return `Vence en ${daysUntil} días`;
}

function contractDaysLabel(contractEndDate: Date | null): string {
  if (!contractEndDate) return "Indefinido";
  const diff = Math.ceil((contractEndDate.getTime() - Date.now()) / 86400000);
  if (diff < 0) return `Venció hace ${Math.abs(diff)} días`;
  if (diff === 0) return "Vence hoy";
  return `Vence en ${diff} días`;
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default async function PerfilTrabajadorPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { status?: string | string[]; tab?: string };
}) {
  const user = await requireRole(OPERATION_ROLES);
  const canAdmin = isAdminRole(user.role);
  const canEvaluar = canAccessEvaluaciones(user.role);

  const [worker, camps] = await Promise.all([
    db.staffMember.findUnique({ where: { id: params.id }, include: { camp: true } }),
    db.camp.findMany({
      where: { isActive: true, ...(isSupervisorRole(user.role) && user.campId ? { id: user.campId } : {}) },
      orderBy: { name: "asc" },
    }),
  ]);

  if (!worker) notFound();
  if (isSupervisorRole(user.role) && worker.campId !== user.campId) {
    redirect("/trabajadores?status=forbidden");
  }

  const today = new Date();
  const docs = getStaffDocumentEntries(worker, today);
  const shiftProjection = getShiftProjection(
    { shiftPattern: worker.shiftPattern, shiftWorkDays: worker.shiftWorkDays, shiftOffDays: worker.shiftOffDays, shiftStartDate: worker.shiftStartDate },
    today
  );

  const statusRaw = searchParams?.status;
  const status = typeof statusRaw === "string" ? statusRaw : "";
  const tab = searchParams?.tab ?? "perfil";

  const alert =
    status === "updated" ? { type: "success", text: "Trabajador actualizado correctamente." }
    : status === "invalid" ? { type: "error", text: "Revisa los datos del trabajador." }
    : status === "forbidden" ? { type: "error", text: "No puedes editar trabajadores de otro campamento." }
    : null;

  const expiredDocs  = docs.filter(d => d.status === "expired");
  const dueSoonDocs  = docs.filter(d => d.status === "dueSoon");
  const okDocs       = docs.filter(d => d.status === "ok");
  const missingDocs  = docs.filter(d => d.status === "missing");

  const overallStatus = expiredDocs.length > 0 ? "expired" : dueSoonDocs.length > 0 ? "dueSoon" : "ok";

  // Contract days remaining
  const contractDays = worker.contractEndDate
    ? Math.ceil((worker.contractEndDate.getTime() - today.getTime()) / 86400000)
    : null;

  return (
    <AppShell
      title={worker.fullName}
      user={user}
      activeNav="trabajadores"
      showAdminSections={canAdmin}
      rightSlot={
        <Link href="/trabajadores">
          <button type="button" className="secondary">← Trabajadores</button>
        </Link>
      }
    >
      <div className="page-stack">
        {alert && <div className={`alert ${alert.type}`}>{alert.text}</div>}

        {/* ── Header card ─────────────────────────────────────────────── */}
        <div className="card" style={{ padding: "20px 24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>

            {/* Left: identity */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div style={{
                  width: 52, height: 52, borderRadius: "50%",
                  background: "var(--teal)", color: "white",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "1.3rem", fontWeight: 800, flexShrink: 0,
                }}>
                  {worker.fullName.split(" ").map(w => w[0]).slice(0, 2).join("")}
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: "1.25rem", color: "var(--text)" }}>{worker.fullName}</h2>
                  <div style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: 2 }}>
                    {worker.role ?? "Sin cargo"} · {worker.camp.name}
                  </div>
                </div>
                <span style={{
                  padding: "4px 12px", borderRadius: 20, fontSize: "0.78rem", fontWeight: 700,
                  background: worker.isActive ? "#dcfce7" : "#fee2e2",
                  color: worker.isActive ? "#166534" : "#991b1b",
                }}>
                  {worker.isActive ? "Activo" : "Inactivo"}
                </span>
              </div>

              {/* Info row */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 24px", marginTop: 16 }}>
                {worker.nationalId && (
                  <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>🪪 RUT: <strong style={{ color: "var(--text)" }}>{worker.nationalId}</strong></span>
                )}
                {worker.employerCompany && (
                  <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>🏢 Empresa: <strong style={{ color: "var(--text)" }}>{worker.employerCompany}</strong></span>
                )}
                {worker.phone && (
                  <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>📞 <strong style={{ color: "var(--text)" }}>{worker.phone}</strong></span>
                )}
                {worker.personalEmail && (
                  <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>✉️ <strong style={{ color: "var(--text)" }}>{worker.personalEmail}</strong></span>
                )}
              </div>
            </div>

            {/* Right: actions */}
            <div style={{ display: "flex", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
              {canEvaluar && (
                <Link href={`/evaluaciones/nueva?nombre=${encodeURIComponent(worker.fullName)}&cargo=${encodeURIComponent(worker.role ?? "")}`}>
                  <button type="button" style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 8, padding: "8px 14px", fontSize: "0.88rem", cursor: "pointer" }}>
                    📊 Evaluar
                  </button>
                </Link>
              )}
              <Link href={`/trabajadores/${worker.id}?tab=editar`}>
                <button type="button" style={{ borderRadius: 8, padding: "8px 14px", fontSize: "0.88rem", cursor: "pointer" }}>
                  ✏️ Editar ficha
                </button>
              </Link>
            </div>
          </div>
        </div>

        {/* ── Tab bar ─────────────────────────────────────────────────── */}
        <div style={{ display: "flex", gap: 4, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 4, width: "fit-content" }}>
          {[
            { key: "perfil", label: "👤 Perfil" },
            { key: "documentos", label: `📄 Documentos${expiredDocs.length > 0 ? ` (${expiredDocs.length} vencido${expiredDocs.length > 1 ? "s" : ""})` : dueSoonDocs.length > 0 ? ` (${dueSoonDocs.length} por vencer)` : ""}` },
            { key: "turno", label: "📅 Turno" },
            { key: "editar", label: "✏️ Editar" },
          ].map(t => (
            <Link key={t.key} href={`/trabajadores/${worker.id}?tab=${t.key}`} style={{ textDecoration: "none" }}>
              <div style={{
                padding: "8px 14px", borderRadius: 9, fontSize: "0.85rem", fontWeight: tab === t.key ? 700 : 500,
                background: tab === t.key ? "var(--teal)" : "transparent",
                color: tab === t.key ? "white" : "var(--muted)",
                cursor: "pointer", whiteSpace: "nowrap",
              }}>
                {t.label}
              </div>
            </Link>
          ))}
        </div>

        {/* ══ TAB: PERFIL ═══════════════════════════════════════════════ */}
        {tab === "perfil" && (
          <>
            {/* Contract summary */}
            <div className="card">
              <h3 style={{ margin: "0 0 16px", color: "var(--text)", fontSize: "1rem" }}>📋 Resumen del contrato</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                {[
                  {
                    label: "Inicio de turno",
                    value: worker.shiftStartDate ? formatDisplayDate(worker.shiftStartDate) : "—",
                    sub: worker.shiftStartDate ? `Desde ${Math.floor((today.getTime() - worker.shiftStartDate.getTime()) / (86400000 * 30))} meses` : null,
                  },
                  {
                    label: "Vencimiento contrato",
                    value: worker.contractEndDate ? formatDisplayDate(worker.contractEndDate) : "Indefinido",
                    sub: worker.contractEndDate ? contractDaysLabel(worker.contractEndDate) : "Sin fecha de término",
                    highlight: contractDays !== null && contractDays <= 30 ? (contractDays < 0 ? "danger" : "warn") : null,
                  },
                  {
                    label: "Patrón de turno",
                    value: worker.shiftPattern,
                    sub: `${worker.shiftWorkDays} trabajo / ${worker.shiftOffDays} descanso`,
                  },
                  {
                    label: "Estado documental",
                    value: overallStatus === "expired" ? `${expiredDocs.length} vencido(s)` : overallStatus === "dueSoon" ? `${dueSoonDocs.length} por vencer` : "Al día",
                    highlight: overallStatus === "expired" ? "danger" : overallStatus === "dueSoon" ? "warn" : null,
                  },
                ].map(item => (
                  <div key={item.label} style={{
                    padding: "14px 16px", borderRadius: 10,
                    background: item.highlight === "danger" ? "#fce9e8" : item.highlight === "warn" ? "#fff4dc" : "rgba(0,0,0,0.03)",
                    border: `1px solid ${item.highlight === "danger" ? "#f5c0bb" : item.highlight === "warn" ? "#f5d98e" : "var(--border)"}`,
                  }}>
                    <div style={{ fontSize: "0.75rem", color: item.highlight === "danger" ? "#9e2f23" : item.highlight === "warn" ? "#9a6300" : "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>
                      {item.label}
                    </div>
                    <div style={{ fontWeight: 700, fontSize: "1rem", color: item.highlight === "danger" ? "#9e2f23" : item.highlight === "warn" ? "#9a6300" : "var(--text)" }}>
                      {item.value}
                    </div>
                    {item.sub && <div style={{ fontSize: "0.78rem", color: "var(--muted)", marginTop: 2 }}>{item.sub}</div>}
                  </div>
                ))}
              </div>
            </div>

            {/* Quick doc overview */}
            <div className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
                <h3 style={{ margin: 0, color: "var(--text)", fontSize: "1rem" }}>📄 Estado de documentos</h3>
                <Link href={`/trabajadores/${worker.id}?tab=documentos`} style={{ fontSize: "0.85rem", color: "var(--teal)", fontWeight: 600, textDecoration: "none" }}>
                  Ver detalle completo →
                </Link>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
                {[
                  { count: expiredDocs.length, label: "Vencidos", bg: "#fce9e8", color: "#9e2f23", icon: "🔴" },
                  { count: dueSoonDocs.length, label: "Por vencer (30 días)", bg: "#fff4dc", color: "#9a6300", icon: "🟡" },
                  { count: okDocs.length, label: "Vigentes", bg: "#e8f7ef", color: "#146c3d", icon: "🟢" },
                  { count: missingDocs.length, label: "Sin fecha cargada", bg: "#f1f5f9", color: "#64748b", icon: "⚪" },
                ].map(stat => (
                  <div key={stat.label} style={{ background: stat.bg, border: `1px solid ${stat.color}33`, borderRadius: 10, padding: "12px 14px", textAlign: "center" }}>
                    <div style={{ fontSize: "1.5rem", fontWeight: 900, color: stat.color }}>{stat.count}</div>
                    <div style={{ fontSize: "0.78rem", color: stat.color, fontWeight: 600, marginTop: 2 }}>{stat.icon} {stat.label}</div>
                  </div>
                ))}
              </div>
              {worker.notes && (
                <div style={{ marginTop: 16, padding: "12px 14px", background: "rgba(0,0,0,0.03)", borderRadius: 8, fontSize: "0.88rem", color: "var(--text)", borderLeft: "3px solid var(--teal)" }}>
                  <strong style={{ color: "var(--muted)", fontSize: "0.75rem", textTransform: "uppercase" }}>Notas</strong>
                  <p style={{ margin: "4px 0 0", lineHeight: 1.6 }}>{worker.notes}</p>
                </div>
              )}
            </div>
          </>
        )}

        {/* ══ TAB: DOCUMENTOS ═══════════════════════════════════════════ */}
        {tab === "documentos" && (
          <div className="card">
            <h3 style={{ margin: "0 0 20px", color: "var(--text)", fontSize: "1rem" }}>📄 Documentos y vencimientos</h3>
            <div style={{ display: "grid", gap: 10 }}>
              {docs.map(doc => {
                const style = docStatusStyle(doc.status);
                return (
                  <div key={doc.key} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    flexWrap: "wrap", gap: 12,
                    padding: "14px 16px", borderRadius: 12,
                    background: style.bg, border: `1px solid ${style.border}`,
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, color: style.color, fontSize: "0.95rem" }}>{doc.label}</div>
                      <div style={{ fontSize: "0.82rem", color: style.color, opacity: 0.8, marginTop: 2 }}>
                        {doc.date ? formatDisplayDate(doc.date) : "Sin fecha cargada"}
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{
                        padding: "5px 14px", borderRadius: 20,
                        background: `${style.color}22`,
                        color: style.color, fontWeight: 700, fontSize: "0.82rem",
                        whiteSpace: "nowrap",
                      }}>
                        {style.label}
                      </div>
                      <div style={{ fontSize: "0.78rem", color: style.color, marginTop: 4, opacity: 0.85 }}>
                        {daysLabel(doc.daysUntil)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 20, padding: "12px 16px", borderRadius: 10, background: "rgba(0,168,191,0.07)", border: "1px solid rgba(0,168,191,0.2)", fontSize: "0.85rem", color: "var(--muted)" }}>
              💡 Para actualizar fechas, ve a la pestaña <Link href={`/trabajadores/${worker.id}?tab=editar`} style={{ color: "var(--teal)", fontWeight: 600 }}>✏️ Editar</Link>.
            </div>
          </div>
        )}

        {/* ══ TAB: TURNO ════════════════════════════════════════════════ */}
        {tab === "turno" && (
          <div className="card">
            <h3 style={{ margin: "0 0 16px", color: "var(--text)", fontSize: "1rem" }}>📅 Turno proyectado</h3>
            {shiftProjection ? (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 20 }}>
                  {[
                    { label: "Estado hoy", value: `${shiftProjection.shiftPatternLabel} · ${shiftProjection.currentStateLabel}` },
                    { label: "Día del bloque", value: `${shiftProjection.currentBlockDay} / ${shiftProjection.currentBlockTotal}` },
                    { label: "Bloque actual", value: formatShiftRange(shiftProjection.currentBlockStart, shiftProjection.currentBlockEnd) },
                    { label: "Próximo cambio", value: `${shiftProjection.nextBlockLabel} · ${formatDisplayDate(shiftProjection.nextBlockStart)}` },
                  ].map(item => (
                    <div key={item.label} style={{ padding: "14px 16px", borderRadius: 10, background: "rgba(0,0,0,0.03)", border: "1px solid var(--border)" }}>
                      <div style={{ fontSize: "0.75rem", color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>{item.label}</div>
                      <div style={{ fontWeight: 700, fontSize: "0.95rem", color: "var(--text)" }}>{item.value}</div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: "0.82rem", color: "var(--muted)", marginBottom: 14 }}>Proyección del ciclo completo desde hoy:</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))", gap: 6 }}>
                  {shiftProjection.projectedDays.map(day => (
                    <div key={day.dateKey} style={{
                      padding: "10px 6px", borderRadius: 8, textAlign: "center",
                      background: day.isToday ? "var(--teal)" : day.state === "work" ? "#fff7f1" : "#f4fbfb",
                      border: day.isToday ? "none" : "1px solid var(--border)",
                    }}>
                      <div style={{ fontSize: "0.7rem", fontWeight: 600, color: day.isToday ? "white" : "var(--muted)" }}>{day.isToday ? "HOY" : day.shortLabel}</div>
                      <div style={{ fontSize: "0.8rem", fontWeight: 700, color: day.isToday ? "white" : "var(--text)", marginTop: 2 }}>{day.stateLabel}</div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div style={{ color: "var(--muted)", fontSize: "0.9rem" }}>No hay suficiente información para proyectar el turno de este trabajador.</div>
            )}
          </div>
        )}

        {/* ══ TAB: EDITAR ═══════════════════════════════════════════════ */}
        {tab === "editar" && (
          <div className="card" style={{ maxWidth: 860 }}>
            <h3 style={{ margin: "0 0 16px", color: "var(--text)", fontSize: "1rem" }}>✏️ Editar ficha del trabajador</h3>
            <WorkerForm
              action={updateWorkerAction}
              workerId={worker.id}
              camps={camps.map(c => ({ id: c.id, name: c.name }))}
              fixedCampId={isSupervisorRole(user.role) ? worker.campId : undefined}
              fixedCampName={isSupervisorRole(user.role) ? worker.camp.name : undefined}
              successRedirectTo={`/trabajadores/${worker.id}?tab=perfil&status=updated`}
              errorRedirectTo={`/trabajadores/${worker.id}?tab=editar`}
              submitLabel="Guardar cambios"
              defaults={{
                campId: worker.campId,
                fullName: worker.fullName,
                role: worker.role ?? "",
                employerCompany: worker.employerCompany ?? "",
                nationalId: worker.nationalId ?? "",
                phone: worker.phone ?? "",
                personalEmail: worker.personalEmail ?? "",
                shiftPattern: worker.shiftPattern,
                shiftStartDate: toInputDateValue(worker.shiftStartDate),
                contractEndDate: worker.contractEndDate ? toInputDateValue(worker.contractEndDate) : "",
                altitudeExamDueDate: worker.altitudeExamDueDate ? toInputDateValue(worker.altitudeExamDueDate) : "",
                occupationalExamDueDate: worker.occupationalExamDueDate ? toInputDateValue(worker.occupationalExamDueDate) : "",
                inductionDueDate: worker.inductionDueDate ? toInputDateValue(worker.inductionDueDate) : "",
                accreditationDueDate: worker.accreditationDueDate ? toInputDateValue(worker.accreditationDueDate) : "",
                driversLicenseDueDate: worker.driversLicenseDueDate ? toInputDateValue(worker.driversLicenseDueDate) : "",
                notes: worker.notes ?? "",
                isActive: worker.isActive,
              }}
            />
          </div>
        )}

      </div>
    </AppShell>
  );
}
