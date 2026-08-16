import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { canAccessEvaluaciones, isAdminRole, isSupervisorRole, TRABAJADORES_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { renovarContratoAction, updateWorkerAction, subirFotoTrabajadorAction } from "@/app/trabajadores/actions";
import { WorkerForm } from "@/app/trabajadores/worker-form";
import { ExigenciaBanner } from "@/app/trabajadores/exigencia-banner";
import { ExtractClient } from "@/app/trabajadores/control-documental/extraer/extract-client";
import { formatDisplayDate, toInputDateValue } from "@/lib/report-utils";
import { getStaffDocumentEntries } from "@/lib/staff-docs";
import { ESTADO_STYLE } from "@/lib/acreditacion";
import { DocumentosPanel, type FilaDoc, type VersionDoc } from "./documentos-panel";
import { getTiposDocumento, getEstadoDocumental } from "@/lib/acreditacion-db";
import { getCalificaciones, getCargos, getProyectos, getRequisitosDeTrabajador, resumirExigencia } from "@/lib/requisitos-db";
import { asignarCalificacionesAction } from "@/app/administracion/calificaciones/actions";
import { formatShiftRange, getShiftProjection } from "@/lib/shift-projection";

// ─── helpers ─────────────────────────────────────────────────────────────────

function docStatusStyle(status: "ok" | "dueSoon" | "expired" | "missing" | "indefinite") {
  const map = {
    ok:         { bg: "#e8f7ef", color: "#146c3d", border: "#b6e8c8", label: "Al día" },
    indefinite: { bg: "#e0f2fe", color: "#0369a1", border: "#7dd3fc", label: "Indefinido" },
    dueSoon:    { bg: "#fff4dc", color: "#9a6300", border: "#f5d98e", label: "Por vencer" },
    expired:    { bg: "#fce9e8", color: "#9e2f23", border: "#f5c0bb", label: "Vencido" },
    missing:    { bg: "#f1f5f9", color: "#64748b", border: "#cbd5e1", label: "Sin fecha" },
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

function contractDaysLabel(contractEndDate: Date | null, isIndefinite = false): string {
  if (isIndefinite) return "Indefinido";
  if (!contractEndDate) return "Sin fecha cargada";
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
  const user = await requireRole(TRABAJADORES_ROLES);
  const canAdmin = isAdminRole(user.role);
  const canEvaluar = canAccessEvaluaciones(user.role);

  const [worker, camps, docCount] = await Promise.all([
    db.staffMember.findUnique({ where: { id: params.id }, include: { camp: true, cierre: true } }),
    db.camp.findMany({
      where: { isActive: true, ...(isSupervisorRole(user.role) && user.campId ? { id: user.campId } : {}) },
      orderBy: { name: "asc" },
    }),
    db.documentoTrabajador.count({ where: { staffMemberId: params.id } }),
  ]);

  if (!worker) notFound();
  if (isSupervisorRole(user.role) && worker.campId !== user.campId) {
    redirect("/trabajadores?status=forbidden");
  }

  const today = new Date();
  const docs = getStaffDocumentEntries(worker, today);

  // Estado documental desde el modelo de acreditación. Se muestran los
  // tipos core (los de la matriz) más cualquier otro que tenga documento
  // cargado — así un certificado de antecedentes no queda invisible.
  const tiposTodos = await getTiposDocumento();
  const estadoMap = await getEstadoDocumental([worker.id], tiposTodos, today);
  const estadoWorker = estadoMap.get(worker.id);

  // Qué le exige su matriz de acreditación y qué le falta de verdad.
  // Las calificaciones se consultan antes: de ellas depende qué requisitos
  // se le exigen, así que no pueden ir en paralelo con el cálculo.
  const [calificaciones, susCalificaciones] = await Promise.all([
    getCalificaciones(),
    db.staffMember.findUnique({
      where: { id: worker.id },
      select: { calificaciones: { select: { id: true } } },
    }).then(r => r?.calificaciones.map(c => c.id) ?? []),
  ]);

  const [cargos, proyectos, requisitosWorker] = await Promise.all([
    getCargos(),
    getProyectos(),
    getRequisitosDeTrabajador({
      proyectoId: worker.proyectoId,
      cargoId: worker.cargoId,
      calificacionIds: susCalificaciones,
      contractIsIndefinite: worker.contractIsIndefinite,
      trabajoPrevioMandante: worker.trabajoPrevioMandante,
      contractEndDate: worker.contractEndDate,
    }),
  ]);
  const nombresTipos = new Map(tiposTodos.map(t => [t.id, t.nombre]));
  // Dos cumplimientos separados. El del mandante decide si puede entrar a la
  // faena; el interno es de la contratación y no bloquea nada allá.
  const exigencia = resumirExigencia(requisitosWorker, estadoWorker, nombresTipos, "mandante");
  const exigenciaInterna = resumirExigencia(requisitosWorker, estadoWorker, nombresTipos, "interno");
  const docsAcreditacion = tiposTodos
    .map(tipo => ({ tipo, entry: estadoWorker?.porTipo.get(tipo.id) }))
    .filter((x): x is { tipo: typeof tiposTodos[number]; entry: NonNullable<typeof x.entry> } =>
      Boolean(x.entry) && (x.tipo.mostrarEnMatriz || x.entry!.estado !== "sin_fecha"));
  // Todas las versiones, incluidas las anuladas: el panel muestra el historial
  // completo porque el modelo es append-only y una corrección solo se entiende
  // al lado de lo que reemplazó.
  const versiones = await db.documentoAcreditacion.findMany({
    where: { staffMemberId: worker.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, tipoDocumentoId: true, fechaEmision: true, fechaVencimiento: true,
      sinVencimiento: true, vencimientoCalculado: true, origen: true,
      confianzaExtraccion: true, archivoId: true, originalFilename: true, nota: true,
      createdAt: true, confirmadoPorNombre: true, anulado: true,
      anuladoPorNombre: true, motivoAnulacion: true,
      empleadorNombre: true, empleadorRut: true, cargoContrato: true,
      archivosExtra: { select: { archivoId: true } },
    },
  });

  const aIso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  const aVersion = (v: typeof versiones[number]): VersionDoc => ({
    id: v.id,
    fechaEmision: aIso(v.fechaEmision),
    fechaVencimiento: aIso(v.fechaVencimiento),
    sinVencimiento: v.sinVencimiento,
    vencimientoCalculado: v.vencimientoCalculado,
    origen: v.origen,
    confianza: v.confianzaExtraccion,
    archivoId: v.archivoId,
    archivosExtra: v.archivosExtra.map(a => a.archivoId),
    nombreArchivo: v.originalFilename,
    nota: v.nota,
    creado: formatDisplayDate(v.createdAt),
    confirmadoPor: v.confirmadoPorNombre,
    anulado: v.anulado,
    anuladoPor: v.anuladoPorNombre,
    motivoAnulacion: v.motivoAnulacion,
  });

  // ── Coherencia entre los papeles laborales ──────────────────────────
  // Las fechas no son lo único que puede estar mal. Un anexo firmado por una
  // razón social distinta a la del contrato no modifica nada: el mandante lo
  // va a ver antes que nosotros, y hasta ahora eso solo se pillaba leyendo
  // PDF por PDF.
  const laborales = versiones.filter(v => !v.anulado && v.empleadorRut);
  const rutsEmpleador = [...new Map(
    laborales.map(v => [v.empleadorRut!.replace(/[.\s-]/g, "").toUpperCase(), v]),
  ).values()];

  const cargoDelPapel = versiones
    .filter(v => !v.anulado && v.cargoContrato)
    .sort((a, b) => (b.fechaEmision?.getTime() ?? 0) - (a.fechaEmision?.getTime() ?? 0))[0] ?? null;

  const cargoAsignado = cargos.find(c => c.id === worker.cargoId)?.nombre ?? null;
  const normCargo = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  const cargoDiscrepa = Boolean(
    cargoAsignado && cargoDelPapel?.cargoContrato &&
    !normCargo(cargoDelPapel.cargoContrato).includes(normCargo(cargoAsignado)) &&
    !normCargo(cargoAsignado).includes(normCargo(cargoDelPapel.cargoContrato)),
  );

  const filasDocumentos: FilaDoc[] = docsAcreditacion.map(({ tipo, entry }) => {
    const delTipo = versiones.filter(v => v.tipoDocumentoId === tipo.id);
    const vigenteId = entry.documento?.id ?? null;
    return {
      tipoId: tipo.id,
      tipoNombre: tipo.nombre,
      estado: entry.estado,
      dias: entry.dias,
      actual: delTipo.filter(v => v.id === vigenteId).map(aVersion)[0] ?? null,
      historial: delTipo.filter(v => v.id !== vigenteId).map(aVersion),
    };
  });

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
    : status === "foto-ok" ? { type: "success", text: "Foto actualizada." }
    : status === "foto-formato" ? { type: "error", text: "La foto tiene que ser JPG, PNG o WEBP." }
    : status === "foto-pesada" ? { type: "error", text: "La foto supera los 6 MB." }
    : status === "foto-invalida" ? { type: "error", text: "No se recibió ninguna imagen." }
    : status === "doc-corregido" ? { type: "success", text: "Corrección guardada. La versión anterior quedó en el historial." }
    : status === "doc-anulado" ? { type: "success", text: "Documento anulado. Sigue en el historial." }
    : status === "doc-registrado" ? { type: "success", text: "Documento registrado sin archivo adjunto." }
    : status === "doc-sin-fecha" ? { type: "error", text: "Pon al menos una fecha, o marca que el documento no vence." }
    : status === "doc-sin-motivo" ? { type: "error", text: "Escribe el motivo de la anulación." }
    : status === "doc-no-encontrado" ? { type: "error", text: "Ese documento no es de este trabajador." }
    : status === "doc-invalido" ? { type: "error", text: "No se pudo procesar el documento." }
    : status === "calificaciones-ok" ? { type: "success", text: "Calificaciones actualizadas. Los documentos exigidos se recalcularon." }
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

        {/* Lo primero de la ficha: qué le falta para poder trabajar. */}
        <ExigenciaBanner exigencia={exigencia} editarHref={`/trabajadores/${worker.id}?tab=editar`} />
        <ExigenciaBanner exigencia={exigenciaInterna} informativo titulo="Contratación NOMADE" />

        {/* ── Header card ─────────────────────────────────────────────── */}
        <div className="card" style={{ padding: "20px 24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>

            {/* Left: identity */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                {worker.fotoArchivoId ? (
                  <img
                    src={`/api/archivo/${worker.fotoArchivoId}`}
                    alt={worker.fullName}
                    style={{ width: 52, height: 52, borderRadius: "50%", objectFit: "cover", flexShrink: 0, border: "2px solid var(--teal)" }}
                  />
                ) : (
                  <div style={{
                    width: 52, height: 52, borderRadius: "50%",
                    background: "var(--teal)", color: "white",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "1.3rem", fontWeight: 800, flexShrink: 0,
                  }}>
                    {worker.fullName.split(" ").map(w => w[0]).slice(0, 2).join("")}
                  </div>
                )}
                <div>
                  <h2 style={{ margin: 0, fontSize: "1.25rem", color: "var(--text)" }}>{worker.fullName}</h2>
                  <div style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: 2 }}>
                    {worker.role ?? "Sin cargo"} · {worker.camp?.name ?? "Sin asignar"}
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

            {/* Right: actions (sólo accesos directos que NO están en las pestañas) */}
            <div style={{ display: "flex", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
              {canEvaluar && (
                <Link href={`/evaluaciones/nueva?nombre=${encodeURIComponent(worker.fullName)}&cargo=${encodeURIComponent(worker.role ?? "")}`}>
                  <button type="button" style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 8, padding: "8px 14px", fontSize: "0.88rem", cursor: "pointer" }}>
                    📊 Evaluar
                  </button>
                </Link>
              )}
              <Link href={`/trabajadores/${worker.id}/documentos`}>
                <button type="button" style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 8, padding: "8px 14px", fontSize: "0.88rem", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                  📎 Adjuntos
                  {docCount > 0 && (
                    <span style={{ background: "var(--teal)", color: "#fff", borderRadius: "9999px", padding: "1px 7px", fontSize: "0.72rem", fontWeight: 700 }}>
                      {docCount}
                    </span>
                  )}
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
            { key: "contrato", label: `📋 Contrato${contractDays !== null && contractDays < 0 ? " ⚠️" : ""}` },
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
              <h3 style={{ margin: "0 0 16px", color: "var(--text)", fontSize: "1rem" }}>📋 Resumen del trabajador</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                {[
                  {
                    label: "Inicio de turno",
                    value: worker.shiftStartDate ? formatDisplayDate(worker.shiftStartDate) : "—",
                    sub: worker.shiftStartDate ? `Desde ${Math.floor((today.getTime() - worker.shiftStartDate.getTime()) / (86400000 * 30))} meses` : null,
                  },
                  {
                    label: "Vencimiento contrato",
                    value: worker.contractIsIndefinite
                      ? "∞ Indefinido"
                      : worker.contractEndDate ? formatDisplayDate(worker.contractEndDate) : "Sin fecha",
                    sub: worker.contractIsIndefinite
                      ? "Contrato sin fecha de término"
                      : worker.contractEndDate ? contractDaysLabel(worker.contractEndDate, false) : "Falta cargar fecha",
                    highlight: worker.contractIsIndefinite ? null : (contractDays !== null && contractDays <= 30 ? (contractDays < 0 ? "danger" : "warn") : null),
                  },
                  {
                    label: "Patrón de turno",
                    value: worker.shiftPattern,
                    sub: `${worker.shiftWorkDays} trabajo / ${worker.shiftOffDays} descanso`,
                  },
                  {
                    label: "Adjuntos cargados",
                    value: `${docCount}`,
                    sub: docCount === 0 ? "Sin archivos" : docCount === 1 ? "archivo" : "archivos",
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

            {/* Foto del trabajador */}
            <div className="card">
              <h3 style={{ margin: "0 0 12px", color: "var(--text)", fontSize: "1rem" }}>📷 Foto del trabajador</h3>
              <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
                {worker.fotoArchivoId ? (
                  <a href={`/api/archivo/${worker.fotoArchivoId}`} target="_blank" rel="noreferrer">
                    <img
                      src={`/api/archivo/${worker.fotoArchivoId}`}
                      alt={worker.fullName}
                      style={{ width: 110, height: 110, borderRadius: 12, objectFit: "cover", border: "1px solid var(--border)" }}
                    />
                  </a>
                ) : (
                  <div style={{
                    width: 110, height: 110, borderRadius: 12,
                    background: "#f1f5f9", border: "1px dashed var(--border)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "var(--muted)", fontSize: "0.8rem", textAlign: "center", padding: 8,
                  }}>
                    Sin foto
                  </div>
                )}
                <form action={subirFotoTrabajadorAction} style={{ display: "grid", gap: 8 }}>
                  <input type="hidden" name="workerId" value={worker.id} />
                  <input
                    type="file"
                    name="foto"
                    accept="image/jpeg,image/png,image/webp"
                    required
                    style={{ fontSize: "0.85rem" }}
                  />
                  <button type="submit" className="secondary" style={{ width: "auto", justifySelf: "start" }}>
                    {worker.fotoArchivoId ? "Reemplazar foto" : "Subir foto"}
                  </button>
                  <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>JPG, PNG o WEBP · hasta 6 MB</div>
                </form>
              </div>
            </div>

            {/* Subir documentos sin salir de la ficha. Es el mismo extractor
                de Control documental, fijado a esta persona: no hay a quién
                asignarle nada, ya se sabe de quién es. */}
            <div className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
                <h3 style={{ margin: 0, color: "var(--text)", fontSize: "1rem" }}>🤖 Subir documentos</h3>
                <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
                  Se leen con IA y quedan a nombre de {worker.fullName.split(" ")[0]}. Revisa antes de guardar.
                </span>
              </div>
              <ExtractClient
                fixedWorker={{ id: worker.id, fullName: worker.fullName }}
                workers={[{ id: worker.id, fullName: worker.fullName, nationalId: worker.nationalId }]}
                docTypes={tiposTodos.map(t => ({
                  id: t.id, codigo: t.codigo, nombre: t.nombre,
                  noVence: t.noVence, esFoto: t.esFoto, vigenciaDias: t.vigenciaDias,
                }))}
                apiKeyMissing={!process.env.OPENAI_API_KEY}
              />
            </div>

            {/* Estado de documentos con el detalle a la vista */}
            <div className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
                <h3 style={{ margin: 0, color: "var(--text)", fontSize: "1rem" }}>📄 Estado de documentos</h3>
                <Link href="/trabajadores/control-documental/extraer" style={{ fontSize: "0.85rem", color: "#7c3aed", fontWeight: 700, textDecoration: "none" }}>
                  🤖 Cargar con IA →
                </Link>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginBottom: 18 }}>
                {[
                  { count: docsAcreditacion.filter(d => d.entry.estado === "vencido").length,    label: "Vencidos",      bg: "#fce9e8", color: "#9e2f23", icon: "🔴" },
                  { count: docsAcreditacion.filter(d => d.entry.estado === "por_vencer").length, label: "Por vencer",    bg: "#fff4dc", color: "#9a6300", icon: "🟡" },
                  { count: docsAcreditacion.filter(d => d.entry.estado === "vigente" || d.entry.estado === "sin_vencimiento").length, label: "Vigentes", bg: "#e8f7ef", color: "#146c3d", icon: "🟢" },
                  { count: docsAcreditacion.filter(d => d.entry.estado === "sin_fecha").length,  label: "Sin cargar",    bg: "#f1f5f9", color: "#64748b", icon: "⚪" },
                ].map(stat => (
                  <div key={stat.label} style={{ background: stat.bg, border: `1px solid ${stat.color}33`, borderRadius: 10, padding: "10px 12px", textAlign: "center" }}>
                    <div style={{ fontSize: "1.4rem", fontWeight: 900, color: stat.color }}>{stat.count}</div>
                    <div style={{ fontSize: "0.75rem", color: stat.color, fontWeight: 600 }}>{stat.icon} {stat.label}</div>
                  </div>
                ))}
              </div>

              {/* Detalle de cada documento, sin tener que cambiar de pestaña.
                  La fila abre el panel para revisar el archivo y corregir. */}
              <DocumentosPanel workerId={worker.id} filas={filasDocumentos} variante="compacta" />

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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
              <h3 style={{ margin: 0, color: "var(--text)", fontSize: "1rem" }}>📄 Documentos y vencimientos</h3>
              <Link href="/trabajadores/control-documental/extraer">
                <button type="button" style={{ background: "linear-gradient(135deg, #7c3aed, #a855f7)", border: "none", color: "#fff", padding: "6px 12px", borderRadius: 8, fontWeight: 700, cursor: "pointer", fontSize: "0.82rem" }}>
                  🤖 Cargar con IA
                </button>
              </Link>
            </div>

              {(rutsEmpleador.length > 1 || cargoDiscrepa) && (
                <div style={{ padding: "14px 16px", borderRadius: 12, background: "#fff4dc", border: "1px solid #f5d98e" }}>
                  <strong style={{ fontSize: "0.9rem", color: "#9a6300" }}>
                    Revisa los papeles laborales
                  </strong>
                  {rutsEmpleador.length > 1 && (
                    <div style={{ marginTop: 6, fontSize: "0.86rem", color: "#7a4f00" }}>
                      Sus documentos vienen de <strong>{rutsEmpleador.length} razones sociales distintas</strong>:
                      <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>
                        {rutsEmpleador.map(v => (
                          <li key={v.id}>
                            {v.empleadorNombre ?? "Sin nombre"} — {v.empleadorRut}
                          </li>
                        ))}
                      </ul>
                      <p style={{ margin: "6px 0 0" }}>
                        Un anexo solo puede modificar un contrato del que la empresa es parte. Si hubo
                        cambio de empleador, falta el finiquito y el contrato nuevo.
                      </p>
                    </div>
                  )}
                  {cargoDiscrepa && (
                    <p style={{ margin: "6px 0 0", fontSize: "0.86rem", color: "#7a4f00" }}>
                      En la ficha está como <strong>{cargoAsignado}</strong>, pero su papel laboral más
                      reciente dice <strong>{cargoDelPapel?.cargoContrato}</strong>. Se acredita con el
                      cargo de la ficha: si el correcto es el otro, cámbialo antes de mandarlo a faena.
                    </p>
                  )}
                </div>
              )}

              {/* Calificaciones: habilitaciones que tiene además de su cargo.
                  De ellas depende qué documentos se le exigen. */}
              <div style={{ padding: "14px 16px", borderRadius: 12, background: "var(--bg)", border: "1px solid var(--border)" }}>
                <form action={asignarCalificacionesAction}>
                  <input type="hidden" name="workerId" value={worker.id} />
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                    <strong style={{ fontSize: "0.9rem" }}>Calificaciones</strong>
                    <Link href="/administracion/calificaciones" style={{ fontSize: "0.76rem" }}>
                      Administrar el catálogo
                    </Link>
                  </div>
                  <p style={{ margin: "2px 0 8px", color: "var(--muted)", fontSize: "0.78rem" }}>
                    Habilitaciones que tiene además de su cargo. Marcarlas cambia qué documentos se le exigen.
                  </p>
                  {calificaciones.length === 0 ? (
                    <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--muted)" }}>
                      Todavía no hay calificaciones en el catálogo.
                    </p>
                  ) : (
                    <>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px", marginBottom: 10 }}>
                        {calificaciones.map(c => (
                          <label key={c.id} title={c.descripcion ?? undefined}
                                 style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.86rem", fontWeight: 400, cursor: "pointer" }}>
                            <input type="checkbox" name="calificaciones" value={c.id}
                                   defaultChecked={susCalificaciones.includes(c.id)}
                                   style={{ width: "auto", margin: 0 }} />
                            {c.nombre}
                          </label>
                        ))}
                      </div>
                      <button type="submit" style={{ width: "auto", padding: "6px 14px", fontSize: "0.82rem" }}>
                        Guardar calificaciones
                      </button>
                    </>
                  )}
                </form>
              </div>

              <DocumentosPanel workerId={worker.id} filas={filasDocumentos} variante="detallada" />

            <div style={{ marginTop: 20, padding: "12px 16px", borderRadius: 10, background: "rgba(0,168,191,0.07)", border: "1px solid rgba(0,168,191,0.2)", fontSize: "0.85rem", color: "var(--muted)" }}>
              💡 Haz clic en cualquier documento para verlo, corregir sus fechas o anularlo.
              Nada se pisa: cada cambio queda como una versión nueva y la anterior sigue en el historial.
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

        {/* ══ TAB: CONTRATO ════════════════════════════════════════════ */}
        {tab === "contrato" && (
          <div className="page-stack">

            {/* Estado actual del contrato */}
            <div className="card">
              <h3 style={{ margin: "0 0 16px", fontSize: "1rem" }}>📋 Estado del contrato</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                {[
                  {
                    label: "Estado trabajador",
                    value: worker.isActive ? "Activo" : "Inactivo",
                    highlight: worker.isActive ? null : "danger" as const,
                  },
                  {
                    label: "Vencimiento contrato",
                    value: worker.contractIsIndefinite
                      ? "∞ Indefinido"
                      : worker.contractEndDate ? formatDisplayDate(worker.contractEndDate) : "Sin fecha",
                    highlight: worker.contractIsIndefinite
                      ? null
                      : contractDays !== null && contractDays < 0 ? "danger" as const : contractDays !== null && contractDays <= 30 ? "warn" as const : null,
                    sub: worker.contractIsIndefinite
                      ? "Sin fecha de término"
                      : worker.contractEndDate ? contractDaysLabel(worker.contractEndDate, false) : "Falta cargar fecha",
                  },
                  ...(worker.cierre ? [{
                    label: "Tipo de cierre",
                    value: ({ finiquito: "Finiquito", no_renovacion: "No renovación", renuncia: "Renuncia", mutuo_acuerdo: "Mutuo acuerdo", otro: "Otro" })[worker.cierre.tipo] ?? worker.cierre.tipo,
                    highlight: "danger" as const,
                  }] : []),
                ].map(item => (
                  <div key={item.label} style={{
                    padding: "14px 16px", borderRadius: 10,
                    background: item.highlight === "danger" ? "#fce9e8" : item.highlight === "warn" ? "#fff4dc" : "rgba(0,0,0,0.03)",
                    border: `1px solid ${item.highlight === "danger" ? "#f5c0bb" : item.highlight === "warn" ? "#f5d98e" : "var(--border)"}`,
                  }}>
                    <div style={{ fontSize: "0.75rem", color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>{item.label}</div>
                    <div style={{ fontWeight: 700, fontSize: "1rem", color: item.highlight === "danger" ? "#9e2f23" : item.highlight === "warn" ? "#9a6300" : "var(--text)" }}>{item.value}</div>
                    {"sub" in item && item.sub && <div style={{ fontSize: "0.78rem", color: "var(--muted)", marginTop: 2 }}>{item.sub}</div>}
                  </div>
                ))}
              </div>
            </div>

            {/* Evaluación de salida existente */}
            {worker.cierre && (
              <div className="card">
                <h3 style={{ margin: "0 0 16px", fontSize: "1rem" }}>📊 Evaluación de salida</h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 16 }}>
                  {([
                    ["Desempeño general",        worker.cierre.desempenoGeneral],
                    ["Puntualidad",               worker.cierre.puntualidad],
                    ["Trabajo en equipo",         worker.cierre.trabajoEnEquipo],
                    ["Calidad del trabajo",       worker.cierre.calidadTrabajo],
                    ["Actitud seguridad",         worker.cierre.actitudSeguridad],
                  ] as [string, string][]).map(([label, val]) => {
                    const isGood = ["excelente", "bueno", "buena"].includes(val);
                    const isBad  = ["malo", "mala"].includes(val);
                    return (
                      <div key={label} style={{ padding: "10px 14px", borderRadius: 8, background: isGood ? "#dcfce7" : isBad ? "#fee2e2" : "#fef9c3", border: `1px solid ${isGood ? "#bbf7d0" : isBad ? "#fecaca" : "#fef08a"}` }}>
                        <div style={{ fontSize: "0.72rem", color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", marginBottom: 3 }}>{label}</div>
                        <div style={{ fontWeight: 700, fontSize: "0.9rem", color: isGood ? "#166534" : isBad ? "#991b1b" : "#854d0e", textTransform: "capitalize" }}>{val}</div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: worker.cierre.observaciones ? 12 : 0 }}>
                  <span style={{ padding: "4px 14px", borderRadius: 20, fontWeight: 700, fontSize: "0.85rem", background: worker.cierre.recontratarRecomendado ? "#dcfce7" : "#fee2e2", color: worker.cierre.recontratarRecomendado ? "#166534" : "#991b1b" }}>
                    {worker.cierre.recontratarRecomendado ? "✅ Recontratar" : "❌ No recontratar"}
                  </span>
                  <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
                    Prioridad: <strong>{({ inmediata: "Inmediata", normal: "Normal", baja: "Baja", no_aplica: "No aplica" })[worker.cierre.prioridadRecontratacion] ?? worker.cierre.prioridadRecontratacion}</strong>
                  </span>
                  <span style={{ fontSize: "0.8rem", color: "var(--muted)", marginLeft: "auto" }}>
                    Evaluado por {worker.cierre.evaluadoPorNombre} · {formatDisplayDate(worker.cierre.fechaCierre)}
                  </span>
                </div>
                {worker.cierre.observaciones && (
                  <div style={{ padding: "10px 14px", background: "rgba(0,0,0,0.03)", borderRadius: 8, fontSize: "0.88rem", color: "var(--text)", borderLeft: "3px solid var(--teal)", marginTop: 4 }}>
                    <strong style={{ color: "var(--muted)", fontSize: "0.72rem", textTransform: "uppercase" }}>Observaciones</strong>
                    <p style={{ margin: "4px 0 0" }}>{worker.cierre.observaciones}</p>
                  </div>
                )}
                <div style={{ marginTop: 16 }}>
                  <Link href={`/trabajadores/${worker.id}/terminar-contrato`}>
                    <button type="button" className="secondary">✏️ Editar evaluación de salida</button>
                  </Link>
                </div>
              </div>
            )}

            {/* Acciones */}
            {worker.isActive ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>

                {/* Renovar contrato */}
                <div className="card">
                  <h3 style={{ margin: "0 0 4px", fontSize: "1rem" }}>🔄 Renovar contrato</h3>
                  <p style={{ margin: "0 0 16px", color: "var(--muted)", fontSize: "0.875rem" }}>
                    Actualiza la fecha de término. El trabajador continúa activo.
                  </p>
                  <form action={renovarContratoAction}>
                    <input type="hidden" name="staffMemberId" value={worker.id} />
                    <div style={{ marginBottom: 12 }}>
                      <label htmlFor="nuevaFechaContrato" style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: 4 }}>
                        Nueva fecha de término
                      </label>
                      <input
                        id="nuevaFechaContrato"
                        name="nuevaFechaContrato"
                        type="date"
                        required
                        defaultValue={worker.contractEndDate ? toInputDateValue(worker.contractEndDate) : ""}
                        style={{ width: "100%", boxSizing: "border-box" }}
                      />
                    </div>
                    <button type="submit">Renovar contrato</button>
                  </form>
                </div>

                {/* Terminar contrato */}
                <div className="card" style={{ border: "1px solid #fecaca" }}>
                  <h3 style={{ margin: "0 0 4px", fontSize: "1rem", color: "#991b1b" }}>🚪 Terminar contrato</h3>
                  <p style={{ margin: "0 0 16px", color: "var(--muted)", fontSize: "0.875rem" }}>
                    Marca al trabajador como inactivo y registra una evaluación de salida interna.
                  </p>
                  <Link href={`/trabajadores/${worker.id}/terminar-contrato`}>
                    <button type="button" className="danger">Iniciar proceso de cierre →</button>
                  </Link>
                </div>

              </div>
            ) : !worker.cierre ? (
              /* Inactivo sin evaluación */
              <div className="card" style={{ border: "1px solid #fef08a", background: "#fefce8" }}>
                <p style={{ margin: 0, color: "#854d0e", fontWeight: 600 }}>
                  ⚠️ Este trabajador está inactivo pero no tiene evaluación de salida registrada.
                </p>
                <div style={{ marginTop: 12 }}>
                  <Link href={`/trabajadores/${worker.id}/terminar-contrato`}>
                    <button type="button">Completar evaluación de salida</button>
                  </Link>
                </div>
              </div>
            ) : null}

          </div>
        )}

        {/* ══ TAB: EDITAR ═══════════════════════════════════════════════ */}
        {tab === "editar" && (
          <div className="card" style={{ maxWidth: 860 }}>
            <h3 style={{ margin: "0 0 16px", color: "var(--text)", fontSize: "1rem" }}>✏️ Editar ficha del trabajador</h3>
            <WorkerForm
              cargos={cargos}
              proyectos={proyectos}
              action={updateWorkerAction}
              workerId={worker.id}
              camps={camps.map(c => ({ id: c.id, name: c.name }))}
              fixedCampId={isSupervisorRole(user.role) ? (worker.campId ?? undefined) : undefined}
              fixedCampName={isSupervisorRole(user.role) ? worker.camp?.name ?? "Sin asignar" : undefined}
              successRedirectTo={`/trabajadores/${worker.id}?tab=perfil&status=updated`}
              errorRedirectTo={`/trabajadores/${worker.id}?tab=editar`}
              submitLabel="Guardar cambios"
              defaults={{
                campId: worker.campId ?? "",
                fullName: worker.fullName,
                role: worker.role ?? "",
                employerCompany: worker.employerCompany ?? "",
                nationalId: worker.nationalId ?? "",
                phone: worker.phone ?? "",
                personalEmail: worker.personalEmail ?? "",
                shiftPattern: worker.shiftPattern,
                shiftStartDate: toInputDateValue(worker.shiftStartDate),
                contractEndDate: worker.contractEndDate ? toInputDateValue(worker.contractEndDate) : "",
                contractIsIndefinite: worker.contractIsIndefinite ?? false,
                cargoId: worker.cargoId ?? "",
                proyectoId: worker.proyectoId ?? "",
                trabajoPrevioMandante: worker.trabajoPrevioMandante ?? false,
                altitudeExamDueDate: worker.altitudeExamDueDate ? toInputDateValue(worker.altitudeExamDueDate) : "",
                occupationalExamDueDate: worker.occupationalExamDueDate ? toInputDateValue(worker.occupationalExamDueDate) : "",
                inductionDueDate: worker.inductionDueDate ? toInputDateValue(worker.inductionDueDate) : "",
                accreditationDueDate: worker.accreditationDueDate ? toInputDateValue(worker.accreditationDueDate) : "",
                driversLicenseDueDate: worker.driversLicenseDueDate ? toInputDateValue(worker.driversLicenseDueDate) : "",
                cedulaExpiryDate: worker.cedulaExpiryDate ? toInputDateValue(worker.cedulaExpiryDate) : "",
                foodHandlingExamDueDate: worker.foodHandlingExamDueDate ? toInputDateValue(worker.foodHandlingExamDueDate) : "",
                vaccineDueDate: worker.vaccineDueDate ? toInputDateValue(worker.vaccineDueDate) : "",
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
