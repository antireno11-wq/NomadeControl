import Link from "next/link";
import { redirect } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import { db } from "@/lib/db";
import { requireRequerimientos } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { aInputDate } from "@/lib/ddd";
import { formatDisplayDate } from "@/lib/report-utils";
import { normalizarRut } from "@/lib/acreditacion";
import { getCargos, getProyectos } from "@/lib/requisitos-db";
import {
  APROBABLE_DESDE, ESTADOS_ABIERTOS, ESTADOS_POSTULANTE, REQUIEREN_APROBACION, SEMAFORO_REQ_STYLE,
  codigoReq, estaAbierta, estaTerminada, etiquetaPostulante, etiquetaSolicitud,
  postulanteEnProceso, prioridadDe, semaforoDe, textoPlazo, vacantesCubiertas,
} from "@/lib/requerimientos";
import {
  agregarPostulanteAction, cambiarEstadoPostulanteAction, cambiarEstadoRequerimientoAction,
  cerrarRequerimientoAction, comentarAction, crearFichaTrabajadorAction, decidirPostulanteAction,
  editarPostulanteAction, editarRequerimientoAction, reabrirRequerimientoAction,
} from "../actions";
import { CamposSolicitud } from "../campos-solicitud";

const ALERTAS: Record<string, { type: "success" | "error"; text: string }> = {
  creada: { type: "success", text: "Solicitud enviada. RRHH recibe el aviso por correo." },
  editada: { type: "success", text: "Solicitud editada. El cambio quedó en el historial." },
  "estado-cambiado": { type: "success", text: "Estado actualizado." },
  cerrada: { type: "success", text: "Solicitud cerrada." },
  desistida: { type: "success", text: "Solicitud desistida." },
  reabierta: { type: "success", text: "Solicitud reabierta." },
  "postulante-agregado": { type: "success", text: "Postulante cargado. Se le avisa por correo al solicitante." },
  "postulante-editado": { type: "success", text: "Postulante actualizado." },
  "postulante-movido": { type: "success", text: "Estado del postulante actualizado." },
  aprobado: { type: "success", text: "Candidato aprobado. Se le avisa por correo a RRHH." },
  rechazado: { type: "success", text: "Candidato rechazado. Se le avisa por correo a RRHH." },
  comentado: { type: "success", text: "Comentario publicado." },
  "ficha-creada": { type: "success", text: "Ficha de trabajador creada. Complétala en Personal: contrato y documentos." },
  "ficha-reactivada": { type: "success", text: "Ya tenía una ficha de baja: se reactivó con el cargo y el proyecto de esta solicitud." },
  "ficha-vinculada": { type: "success", text: "Ya tenía una ficha activa: quedó vinculada, sin crear otra." },
  "sin-cambios": { type: "error", text: "No había nada distinto que guardar." },
  "sin-permiso": { type: "error", text: "Tu perfil no puede hacer ese cambio en esta solicitud." },
  invalida: { type: "error", text: "Revisa los datos de la solicitud." },
  "estado-invalido": { type: "error", text: "Ese cambio de estado no corresponde." },
  "sin-motivo": { type: "error", text: "Escribe el motivo. Sin eso no se puede hacer este cambio." },
  pendientes: { type: "error", text: "Hay postulantes en proceso. Confirma que se descartan para poder cerrar." },
  "no-abierta": { type: "error", text: "La solicitud ya no está abierta." },
  "postulante-invalido": { type: "error", text: "El nombre y el RUT del postulante son obligatorios." },
  "rut-invalido": { type: "error", text: "El RUT no es válido: revisa el dígito verificador." },
  "rut-repetido": { type: "error", text: "Ese RUT ya está cargado en esta solicitud." },
  "cv-grande": { type: "error", text: "El CV supera los 10 MB." },
  "cv-no-pdf": { type: "error", text: "El CV tiene que ser un PDF." },
  "sin-aprobacion": { type: "error", text: "Para pasar a exámenes o a contratado, el solicitante tiene que aprobar primero al candidato." },
  "no-aprobable": { type: "error", text: "Solo se aprueba o rechaza a un candidato preseleccionado o entrevistado." },
  "comentario-vacio": { type: "error", text: "El comentario está vacío." },
  "no-contratado": { type: "error", text: "La ficha se crea cuando el postulante está contratado." },
  "no-encontrada": { type: "error", text: "No se encontró lo que buscabas en esta solicitud." },
};

const PILL_POSTULANTE: Record<string, { bg: string; color: string; border: string }> = {
  descartado: SEMAFORO_REQ_STYLE.rojo,
  contratado: SEMAFORO_REQ_STYLE.verde,
  aprobado: SEMAFORO_REQ_STYLE.verde,
  examenes: SEMAFORO_REQ_STYLE.amarillo,
};
const PILL_NEUTRO = { bg: "#e3f1f3", color: "#00505c", border: "#b9dde2" };

function fechaHora(d: Date): string {
  // 24 h y sin "p. m.": cabe en una línea de la columna del historial.
  return d.toLocaleString("es-CL", {
    timeZone: "America/Santiago", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).replace(",", "");
}

function Pill({ estilo, children }: { estilo: { bg: string; color: string; border: string }; children: ReactNode }) {
  return (
    <span style={{ background: estilo.bg, color: estilo.color, border: `1px solid ${estilo.border}`, borderRadius: 6, padding: "2px 9px", fontSize: "0.74rem", fontWeight: 700, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

const summaryBtn: CSSProperties = {
  cursor: "pointer", listStyle: "none", border: "1px solid var(--border)", background: "var(--surface, #fff)",
  color: "var(--teal)", borderRadius: 7, padding: "5px 12px", fontSize: "0.82rem", fontWeight: 700,
};
const summaryChico: CSSProperties = { cursor: "pointer", fontSize: "0.76rem", color: "var(--muted)", listStyle: "none", fontWeight: 600 };
const panel: CSSProperties = {
  display: "grid", gap: 6, marginTop: 6, padding: 10, background: "#f4f9fa", borderRadius: 8,
  border: "1px solid var(--border)", minWidth: 240,
};
const mini: CSSProperties = { fontSize: "0.72rem", color: "var(--muted)" };
const inputChico: CSSProperties = { fontSize: "0.8rem" };

export default async function RequerimientoDetallePage({
  params, searchParams,
}: {
  params: { id: string };
  searchParams?: { status?: string };
}) {
  const { user, gerencia, gestiona } = await requireRequerimientos();
  const hoy = new Date();

  const req = await db.requerimiento.findUnique({
    where: { id: params.id },
    select: {
      id: true, numero: true, cargoId: true, proyectoId: true, vacantes: true, fechaRequerida: true,
      solicitanteId: true, solicitanteNombre: true, turno: true, requisitos: true, prioridad: true,
      estado: true, motivoCierre: true, observaciones: true, contratadoEn: true, cerradoEn: true, createdAt: true,
      updatedAt: true,
      cargo: { select: { nombre: true } },
      proyecto: { select: { nombre: true, mandante: { select: { nombre: true } } } },
      postulantes: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true, nombre: true, rut: true, telefono: true, email: true, fechaPostulacion: true,
          estado: true, motivoDescarte: true, aprobadoEn: true, aprobadoPorNombre: true,
          contratadoEn: true, staffMemberId: true, cargadoPorNombre: true, cvArchivoId: true, updatedAt: true,
        },
      },
      comentarios: {
        orderBy: { createdAt: "asc" },
        select: { id: true, texto: true, autorNombre: true, createdAt: true, postulante: { select: { nombre: true } } },
      },
      eventos: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true, tipo: true, estadoAnterior: true, estadoNuevo: true, detalle: true,
          autorNombre: true, createdAt: true, postulanteId: true,
        },
      },
    },
  });
  if (!req) redirect("/requerimientos?status=no-encontrada");

  const esSolicitante = req.solicitanteId === user.id;
  if (!gestiona && !esSolicitante) redirect("/requerimientos?status=ajena");

  const abierta = estaAbierta(req.estado);
  const terminada = estaTerminada(req.estado);
  const cubiertas = vacantesCubiertas(req.postulantes);
  const pendientes = req.postulantes.filter(p => postulanteEnProceso(p.estado));
  const puedeEditar = gerencia || (esSolicitante && req.estado === "solicitado");
  const puedeAprobar = gerencia || esSolicitante;
  const puedeDesistir = !terminada && (gestiona || esSolicitante);

  // ── Cruces por RUT: ¿ya trabaja o trabajó con nosotros? ¿postula a otra? ──
  const claves = new Set(req.postulantes.map(p => normalizarRut(p.rut)));
  const [fichas, otras, cargos, proyectos] = await Promise.all([
    req.postulantes.length === 0 ? [] : db.staffMember.findMany({
      where: { nationalId: { not: null } },
      select: { id: true, nationalId: true, isActive: true },
    }),
    req.postulantes.length === 0 ? [] : db.postulante.findMany({
      where: { rut: { in: req.postulantes.map(p => p.rut) }, requerimientoId: { not: req.id } },
      select: { rut: true, requerimiento: { select: { id: true, numero: true } } },
    }),
    puedeEditar ? getCargos() : Promise.resolve([]),
    puedeEditar ? getProyectos() : Promise.resolve([]),
  ]);
  const fichaPorRut = new Map<string, { id: string; isActive: boolean }>();
  for (const f of fichas) {
    const k = normalizarRut(f.nationalId);
    if (claves.has(k)) fichaPorRut.set(k, { id: f.id, isActive: f.isActive });
  }
  const otrasPorRut = new Map<string, Array<{ id: string; numero: number }>>();
  for (const o of otras) {
    const lista = otrasPorRut.get(o.rut) ?? [];
    lista.push(o.requerimiento);
    otrasPorRut.set(o.rut, lista);
  }

  const alerta = ALERTAS[searchParams?.status ?? ""] ?? null;
  const sem = semaforoDe(req, hoy);
  const prio = prioridadDe(req.prioridad);
  const nombrePorPostulante = new Map(req.postulantes.map(p => [p.id, p.nombre]));

  const describirEvento = (e: typeof req.eventos[number]): string => {
    if (e.tipo === "creacion") return `creó la solicitud${e.detalle ? `: ${e.detalle}` : ""}`;
    if (e.tipo === "estado" && e.postulanteId) {
      const nombre = nombrePorPostulante.get(e.postulanteId) ?? "Postulante";
      const motivo = e.detalle && e.detalle.includes(": ") ? ` (${e.detalle.split(": ").slice(1).join(": ")})` : "";
      return `${nombre}: ${etiquetaPostulante(e.estadoAnterior ?? "")} → ${etiquetaPostulante(e.estadoNuevo ?? "")}${motivo}`;
    }
    if (e.tipo === "estado") {
      return `${etiquetaSolicitud(e.estadoAnterior ?? "")} → ${etiquetaSolicitud(e.estadoNuevo ?? "")}${e.detalle ? ` (${e.detalle})` : ""}`;
    }
    return e.detalle ?? e.tipo;
  };

  const dato = (k: string, v: ReactNode, ancho = false) => (
    <div style={ancho ? { gridColumn: "1 / -1" } : undefined}>
      <div style={{ fontSize: "0.7rem", textTransform: "uppercase", color: "var(--muted)", fontWeight: 700, letterSpacing: "0.03em" }}>{k}</div>
      <div style={{ fontWeight: 600, whiteSpace: ancho ? "pre-wrap" : undefined }}>{v}</div>
    </div>
  );

  const avisoPendientes = pendientes.length > 0 && (
    <label style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: "0.78rem", fontWeight: 400 }}>
      <input type="checkbox" name="confirmarDescarte" required style={{ width: "auto", marginTop: 2 }} />
      <span>
        Descartar a {pendientes.length === 1 ? "quien sigue" : `los ${pendientes.length} que siguen`} en proceso:{" "}
        <strong>{pendientes.map(p => p.nombre).join(", ")}</strong>
      </span>
    </label>
  );

  return (
    <AppShell
      title={`${codigoReq(req.numero)} · ${req.cargo.nombre}`}
      user={user}
      activeNav="requerimientos"
      showAdminSections={gerencia}
      rightSlot={<Link href="/requerimientos"><button type="button" className="secondary">Volver al tablero</button></Link>}
    >
      <div className="page-stack">
        {alerta && <div className={`alert ${alerta.type}`}>{alerta.text}</div>}

        {/* ── Ficha ──────────────────────────────────────────────────── */}
        <div className="card" style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <Pill estilo={PILL_NEUTRO}>{etiquetaSolicitud(req.estado)}</Pill>
              <Pill estilo={SEMAFORO_REQ_STYLE[sem]}>{textoPlazo(req, hoy)}</Pill>
              <span style={{ color: prio.color, fontWeight: 800, fontSize: "0.78rem", textTransform: "uppercase" }}>Prioridad {prio.label}</span>
            </div>
            {/* Los formularios se vuelven a montar cuando la solicitud cambia: React 18 no
                los limpia solo después de una acción, y el siguiente que se abriera
                traería escrito el motivo o los datos del anterior. */}
            <div key={req.updatedAt.getTime()} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
              {gestiona && abierta && (
                <details className="req-accion">
                  <summary style={summaryBtn}>Cambiar estado</summary>
                  <form action={cambiarEstadoRequerimientoAction} className="req-pop" style={{ ...panel, width: 280 }}>
                    <input type="hidden" name="requerimientoId" value={req.id} />
                    <select name="estado" defaultValue={req.estado} style={inputChico}>
                      {ESTADOS_ABIERTOS.map(e => <option key={e} value={e}>{etiquetaSolicitud(e)}</option>)}
                    </select>
                    <span style={mini}>Contratado se marca solo al cubrir las vacantes.</span>
                    <button type="submit" style={inputChico}>Guardar</button>
                  </form>
                </details>
              )}
              {puedeEditar && !terminada && (
                <details className="req-accion">
                  <summary style={summaryBtn}>Editar</summary>
                  <form action={editarRequerimientoAction} className="grid two req-pop" style={{ ...panel, width: "min(640px, 88vw)" }}>
                    <input type="hidden" name="requerimientoId" value={req.id} />
                    <CamposSolicitud cargos={cargos} proyectos={proyectos} prefijo="editar" valores={req} />
                    <div><button type="submit">Guardar cambios</button></div>
                  </form>
                </details>
              )}
              {gestiona && !terminada && (
                <details className="req-accion">
                  <summary style={{ ...summaryBtn, background: "#16a34a", color: "#fff", borderColor: "#16a34a" }}>Cerrar</summary>
                  <form action={cerrarRequerimientoAction} className="req-pop" style={{ ...panel, width: 340 }}>
                    <input type="hidden" name="requerimientoId" value={req.id} />
                    <input type="hidden" name="accion" value="cerrar" />
                    <span style={mini}>
                      {cubiertas < req.vacantes
                        ? `Quedan ${req.vacantes - cubiertas} vacante${req.vacantes - cubiertas === 1 ? "" : "s"} sin cubrir: explica por qué se cierra igual.`
                        : "Todas las vacantes están cubiertas. Ciérrala cuando el personal haya ingresado."}
                    </span>
                    <textarea name="motivo" rows={2} required={cubiertas < req.vacantes} minLength={cubiertas < req.vacantes ? 4 : undefined}
                              placeholder={cubiertas < req.vacantes ? "Motivo (obligatorio)" : "Comentario (opcional)"}
                              style={{ ...inputChico, fontFamily: "inherit", minHeight: 0 }} />
                    {avisoPendientes}
                    <button type="submit" style={{ ...inputChico, background: "#16a34a" }}>Cerrar solicitud</button>
                  </form>
                </details>
              )}
              {puedeDesistir && (
                <details className="req-accion">
                  <summary style={{ ...summaryBtn, color: "#b42318", borderColor: "#f5c0bb" }}>Desistir</summary>
                  <form action={cerrarRequerimientoAction} className="req-pop" style={{ ...panel, width: 340 }}>
                    <input type="hidden" name="requerimientoId" value={req.id} />
                    <input type="hidden" name="accion" value="desistir" />
                    <span style={mini}>La solicitud se cancela y no se busca a nadie más.</span>
                    <textarea name="motivo" rows={2} required minLength={4} placeholder="Motivo (obligatorio)"
                              style={{ ...inputChico, fontFamily: "inherit", minHeight: 0 }} />
                    {avisoPendientes}
                    <button type="submit" className="danger" style={inputChico}>Desistir de la solicitud</button>
                  </form>
                </details>
              )}
              {gerencia && terminada && (
                <form action={reabrirRequerimientoAction}>
                  <input type="hidden" name="requerimientoId" value={req.id} />
                  <button type="submit" className="secondary">Reabrir</button>
                </form>
              )}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "10px 18px" }}>
            {dato("Proyecto", `${req.proyecto.mandante.nombre} — ${req.proyecto.nombre}`)}
            {dato("Vacantes", `${cubiertas} de ${req.vacantes} cubierta${req.vacantes === 1 ? "" : "s"}`)}
            {dato("Fecha requerida", formatDisplayDate(req.fechaRequerida))}
            {dato("Turno", req.turno)}
            {dato("Solicitante", req.solicitanteNombre)}
            {dato("Solicitada", formatDisplayDate(req.createdAt))}
            {dato("Postulantes", `${req.postulantes.length} (${pendientes.length} en proceso)`)}
            {req.contratadoEn && dato("Vacantes cubiertas el", formatDisplayDate(req.contratadoEn))}
            {req.cerradoEn && dato(req.estado === "desistido" ? "Desistida el" : "Cerrada el", formatDisplayDate(req.cerradoEn))}
            {dato("Requisitos específicos", req.requisitos || "—", true)}
            {req.observaciones && dato("Observaciones", req.observaciones, true)}
            {req.motivoCierre && dato(req.estado === "desistido" ? "Motivo del desistimiento" : "Motivo del cierre", req.motivoCierre, true)}
          </div>
        </div>

        {/* ── Postulantes ───────────────────────────────────────────── */}
        <div className="card" style={{ padding: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "14px 16px 6px", flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontSize: "1.05rem" }}>Postulantes</h2>
            {gestiona && abierta && (
              <details key={`agregar-${req.postulantes.length}`} className="req-accion">
                <summary style={{ ...summaryBtn, background: "var(--accent)", color: "#fff", borderColor: "var(--accent)" }}>+ Agregar postulante</summary>
                <form action={agregarPostulanteAction} className="grid two req-pop" style={{ ...panel, width: "min(560px, 88vw)" }}>
                  <input type="hidden" name="requerimientoId" value={req.id} />
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label htmlFor="np-nombre">Nombre completo</label>
                    <input id="np-nombre" name="nombre" required minLength={3} />
                  </div>
                  <div>
                    <label htmlFor="np-rut">RUT</label>
                    <input id="np-rut" name="rut" required placeholder="12.345.678-5" />
                  </div>
                  <div>
                    <label htmlFor="np-fecha">Fecha de postulación</label>
                    <input id="np-fecha" name="fechaPostulacion" type="date" defaultValue={aInputDate(hoy)} />
                  </div>
                  <div>
                    <label htmlFor="np-telefono">Teléfono</label>
                    <input id="np-telefono" name="telefono" type="tel" />
                  </div>
                  <div>
                    <label htmlFor="np-email">Correo</label>
                    <input id="np-email" name="email" type="email" />
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label htmlFor="np-cv">CV (PDF, hasta 10 MB)</label>
                    <input id="np-cv" name="cv" type="file" accept="application/pdf,.pdf" />
                  </div>
                  <div style={{ gridColumn: "1 / -1", ...mini }}>El solicitante recibe un correo con el nuevo postulante.</div>
                  <div><button type="submit">Agregar</button></div>
                </form>
              </details>
            )}
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid var(--border)" }}>
                  <th style={{ textAlign: "left", padding: "10px 12px", minWidth: 220 }}>Postulante</th>
                  <th style={{ textAlign: "left", padding: "10px 12px" }}>RUT</th>
                  <th style={{ textAlign: "left", padding: "10px 12px" }}>Estado</th>
                  <th style={{ textAlign: "left", padding: "10px 12px" }}>CV</th>
                  <th style={{ textAlign: "right", padding: "10px 12px" }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {req.postulantes.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center", padding: 28, color: "var(--muted)" }}>
                      {gestiona ? "Todavía no hay postulantes. Cárgalos con «+ Agregar postulante»." : "RRHH todavía no carga postulantes. Te llega un correo cuando lo haga."}
                    </td>
                  </tr>
                ) : req.postulantes.map(p => {
                  const clave = normalizarRut(p.rut);
                  const ficha = fichaPorRut.get(clave);
                  const otrasSol = otrasPorRut.get(p.rut) ?? [];
                  const aprobable = (APROBABLE_DESDE as string[]).includes(p.estado) && !terminada;
                  return (
                    <tr key={p.id} style={{ borderBottom: "1px solid #f1f5f9", verticalAlign: "top", opacity: p.estado === "descartado" ? 0.75 : 1 }}>
                      <td style={{ padding: "10px 12px" }}>
                        <div style={{ fontWeight: 700 }}>{p.nombre}</div>
                        <div style={mini}>
                          {[p.telefono, p.email, `postuló ${formatDisplayDate(p.fechaPostulacion)}`].filter(Boolean).join(" · ")}
                        </div>
                        {p.aprobadoEn && (
                          <div style={{ ...mini, color: "#146c3d" }}>Aprobado por {p.aprobadoPorNombre} el {formatDisplayDate(p.aprobadoEn)}</div>
                        )}
                        {p.estado === "descartado" && p.motivoDescarte && (
                          <div style={{ ...mini, color: "#9e2f23" }}>«{p.motivoDescarte}»</div>
                        )}
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 3 }}>
                          {ficha && ficha.id !== p.staffMemberId && (
                            <Pill estilo={SEMAFORO_REQ_STYLE.amarillo}>{ficha.isActive ? "Ya es trabajador" : "Ex trabajador"}</Pill>
                          )}
                          {otrasSol.map(o => (
                            <Pill key={o.id} estilo={SEMAFORO_REQ_STYLE.ninguno}>
                              {gestiona ? <Link href={`/requerimientos/${o.id}`}>También en {codigoReq(o.numero)}</Link> : `También en ${codigoReq(o.numero)}`}
                            </Pill>
                          ))}
                        </div>
                      </td>
                      <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>{p.rut}</td>
                      <td style={{ padding: "10px 12px" }}>
                        <Pill estilo={PILL_POSTULANTE[p.estado] ?? PILL_NEUTRO}>{etiquetaPostulante(p.estado)}</Pill>
                      </td>
                      <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                        {p.cvArchivoId ? (
                          <span style={{ display: "inline-flex", gap: 8 }}>
                            <a href={`/api/requerimientos/cv/${p.id}`} target="_blank" rel="noreferrer" style={{ fontWeight: 700 }}>Ver</a>
                            <a href={`/api/requerimientos/cv/${p.id}?download=1`} style={{ fontWeight: 700 }}>Descargar ↓</a>
                          </span>
                        ) : <span style={{ color: "var(--muted)" }}>Sin CV</span>}
                      </td>
                      <td style={{ padding: "8px 12px" }}>
                        <div key={p.updatedAt.getTime()} style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap", alignItems: "flex-start" }}>
                          {puedeAprobar && aprobable && (
                            <>
                              <details>
                                <summary style={{ ...summaryChico, background: "#16a34a", color: "#fff", borderRadius: 6, padding: "3px 10px" }}>Aprobar</summary>
                                <form action={decidirPostulanteAction} style={panel}>
                                  <input type="hidden" name="requerimientoId" value={req.id} />
                                  <input type="hidden" name="postulanteId" value={p.id} />
                                  <input type="hidden" name="decision" value="aprobar" />
                                  <textarea name="motivo" rows={2} placeholder="Comentario para RRHH (opcional)"
                                            style={{ ...inputChico, fontFamily: "inherit", minHeight: 0 }} />
                                  <button type="submit" style={{ ...inputChico, background: "#16a34a" }}>Aprobar a {p.nombre.split(" ")[0]}</button>
                                </form>
                              </details>
                              <details>
                                <summary style={{ ...summaryChico, color: "#b42318" }}>Rechazar</summary>
                                <form action={decidirPostulanteAction} style={panel}>
                                  <input type="hidden" name="requerimientoId" value={req.id} />
                                  <input type="hidden" name="postulanteId" value={p.id} />
                                  <input type="hidden" name="decision" value="rechazar" />
                                  <textarea name="motivo" rows={2} required minLength={4} placeholder="Por qué no (obligatorio)"
                                            style={{ ...inputChico, fontFamily: "inherit", minHeight: 0 }} />
                                  <button type="submit" className="danger" style={inputChico}>Rechazar</button>
                                </form>
                              </details>
                            </>
                          )}
                          {gestiona && !terminada && (
                            <details>
                              <summary style={summaryChico}>Mover a ▾</summary>
                              <form action={cambiarEstadoPostulanteAction} style={panel}>
                                <input type="hidden" name="requerimientoId" value={req.id} />
                                <input type="hidden" name="postulanteId" value={p.id} />
                                <select name="estado" required defaultValue="" style={inputChico}>
                                  <option value="" disabled>Elige el estado</option>
                                  {ESTADOS_POSTULANTE.filter(e => e !== "aprobado" && e !== p.estado).map(e => {
                                    const bloqueado = REQUIEREN_APROBACION.includes(e) && !p.aprobadoEn;
                                    return (
                                      <option key={e} value={e} disabled={bloqueado}>
                                        {etiquetaPostulante(e)}{bloqueado ? " (falta aprobación)" : ""}
                                      </option>
                                    );
                                  })}
                                </select>
                                <input name="motivo" placeholder="Motivo (obligatorio si descartas)" style={inputChico} />
                                <span style={mini}>«Aprobado por solicitante» lo marca quien pidió el cargo.</span>
                                <button type="submit" style={inputChico}>Guardar</button>
                              </form>
                            </details>
                          )}
                          {gestiona && (
                            <details>
                              <summary style={summaryChico}>Editar</summary>
                              <form action={editarPostulanteAction} style={{ ...panel, minWidth: 280 }}>
                                <input type="hidden" name="requerimientoId" value={req.id} />
                                <input type="hidden" name="postulanteId" value={p.id} />
                                <label style={mini} htmlFor={`ep-nombre-${p.id}`}>Nombre</label>
                                <input id={`ep-nombre-${p.id}`} name="nombre" required minLength={3} defaultValue={p.nombre} style={inputChico} />
                                <label style={mini} htmlFor={`ep-rut-${p.id}`}>RUT</label>
                                <input id={`ep-rut-${p.id}`} name="rut" required defaultValue={p.rut} style={inputChico} />
                                <label style={mini} htmlFor={`ep-tel-${p.id}`}>Teléfono</label>
                                <input id={`ep-tel-${p.id}`} name="telefono" type="tel" defaultValue={p.telefono ?? ""} style={inputChico} />
                                <label style={mini} htmlFor={`ep-email-${p.id}`}>Correo</label>
                                <input id={`ep-email-${p.id}`} name="email" type="email" defaultValue={p.email ?? ""} style={inputChico} />
                                <label style={mini} htmlFor={`ep-fecha-${p.id}`}>Fecha de postulación</label>
                                <input id={`ep-fecha-${p.id}`} name="fechaPostulacion" type="date" defaultValue={aInputDate(p.fechaPostulacion)} style={inputChico} />
                                <label style={mini} htmlFor={`ep-cv-${p.id}`}>{p.cvArchivoId ? "Reemplazar CV (PDF)" : "Adjuntar CV (PDF)"}</label>
                                <input id={`ep-cv-${p.id}`} name="cv" type="file" accept="application/pdf,.pdf" style={inputChico} />
                                <button type="submit" style={inputChico}>Guardar</button>
                              </form>
                            </details>
                          )}
                          {gestiona && p.estado === "contratado" && (
                            p.staffMemberId ? (
                              <Link href={`/trabajadores/${p.staffMemberId}`} style={{ fontSize: "0.78rem", fontWeight: 700 }}>Ver ficha →</Link>
                            ) : (
                              <form action={crearFichaTrabajadorAction}>
                                <input type="hidden" name="requerimientoId" value={req.id} />
                                <input type="hidden" name="postulanteId" value={p.id} />
                                <button type="submit" style={{ fontSize: "0.76rem", padding: "3px 10px" }}>Crear ficha de trabajador</button>
                              </form>
                            )
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16, alignItems: "start" }}>
          {/* ── Comentarios ─────────────────────────────────────────── */}
          <div className="card" style={{ display: "grid", gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: "1.05rem" }}>Comentarios</h2>
            {req.comentarios.length === 0 && (
              <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: 0 }}>
                Sin comentarios. Lo que escribas acá le llega por correo a la otra parte.
              </p>
            )}
            {req.comentarios.map(c => (
              <div key={c.id} style={{ background: "#f4f9fa", borderRadius: 8, padding: "8px 10px", display: "grid", gap: 2 }}>
                <div style={{ fontSize: "0.72rem", color: "var(--muted)", fontWeight: 700 }}>
                  {c.autorNombre} · {fechaHora(c.createdAt)}{c.postulante ? ` · sobre ${c.postulante.nombre}` : ""}
                </div>
                <div style={{ fontSize: "0.88rem", whiteSpace: "pre-wrap" }}>{c.texto}</div>
              </div>
            ))}
            <form key={`comentar-${req.comentarios.length}`} action={comentarAction} style={{ display: "grid", gap: 6 }}>
              <input type="hidden" name="requerimientoId" value={req.id} />
              <textarea name="texto" rows={2} required minLength={2} placeholder="Escribe un comentario…" style={{ fontFamily: "inherit" }} />
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {req.postulantes.length > 0 && (
                  <select name="postulanteId" defaultValue="" style={{ flex: "1 1 180px", ...inputChico }} aria-label="Sobre qué es el comentario">
                    <option value="">Sobre la solicitud</option>
                    {req.postulantes.map(p => <option key={p.id} value={p.id}>Sobre {p.nombre}</option>)}
                  </select>
                )}
                <button type="submit">Comentar</button>
              </div>
            </form>
          </div>

          {/* ── Historial ───────────────────────────────────────────── */}
          <div className="card" style={{ display: "grid", gap: 8 }}>
            <h2 style={{ margin: 0, fontSize: "1.05rem" }}>Historial</h2>
            <div style={{ display: "grid", gap: 8 }}>
              {req.eventos.map(e => (
                <div key={e.id} style={{ display: "grid", gridTemplateColumns: "122px 1fr", gap: 8, fontSize: "0.82rem", borderBottom: "1px solid #f1f5f9", paddingBottom: 6 }}>
                  <span style={{ color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{fechaHora(e.createdAt)}</span>
                  <span style={{ color: e.tipo === "alerta" ? "#9a6300" : undefined }}>
                    <strong>{e.autorNombre}</strong> {describirEvento(e)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
