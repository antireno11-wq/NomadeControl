import { db } from "@/lib/db";
import { ADMIN_ROLES, TRABAJADORES_ROLES, isAdminRole, requireRole } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { formatDisplayDate } from "@/lib/report-utils";
import {
  cumplimientoALaFecha, diasAtraso, fechaEfectiva, semaforoDe,
  SEMAFORO_STYLE, aInputDate, type Semaforo,
} from "@/lib/ddd";
import { getCategorias, getResponsables } from "@/lib/ddd-db";
import { getProyectos } from "@/lib/requisitos-db";
import {
  crearCompromisoAction, cerrarCompromisoAction,
  reprogramarCompromisoAction, reabrirCompromisoAction,
} from "./actions";

type SearchParams = {
  status?: string; semaforo?: string; responsable?: string;
  contrato?: string; categoria?: string; estado?: string;
};

const SEMAFOROS: Semaforo[] = ["atrasado", "por_vencer", "en_plazo", "cerrado"];

export default async function CompromisosPage({ searchParams }: { searchParams?: SearchParams }) {
  const user = await requireRole(TRABAJADORES_ROLES);
  const puedeAdministrar = isAdminRole(user.role);
  const hoy = new Date();

  const alerta = {
    creado: { type: "success", text: "Compromiso registrado." },
    cerrado: { type: "success", text: "Compromiso cerrado." },
    reprogramado: { type: "success", text: "Fecha reprogramada. La original queda en el historial." },
    reabierto: { type: "success", text: "Compromiso reabierto." },
    ajeno: { type: "error", text: "Solo puedes cerrar los compromisos donde eres responsable." },
    invalido: { type: "error", text: "Revisa los datos del compromiso." },
    "no-encontrado": { type: "error", text: "Compromiso no encontrado." },
  }[searchParams?.status ?? ""] ?? null;

  const [categorias, responsables, proyectos, compromisos] = await Promise.all([
    getCategorias(),
    getResponsables(),
    getProyectos(),
    db.compromiso.findMany({
      select: {
        id: true, accion: true, oportunidad: true, responsable: true,
        fechaCaptura: true, fechaCierre: true, fecha2doCompromiso: true,
        fechaCierreReal: true, estado: true, observacion: true,
        requiereVerificacion: true, origen: true, contratoId: true,
        reunionOrigenId: true,
        contrato: { select: { nombre: true } },
        _count: { select: { reprogramaciones: true } },
      },
    }),
  ]);

  // Los contadores se calculan sobre TODO, no sobre lo filtrado: un
  // indicador que cambia al filtrar no sirve para decidir nada.
  const totales = cumplimientoALaFecha(compromisos, hoy);

  const filtrados = compromisos.filter(c => {
    if (searchParams?.semaforo && semaforoDe(c, hoy) !== searchParams.semaforo) return false;
    if (searchParams?.responsable && c.responsable !== searchParams.responsable) return false;
    if (searchParams?.contrato && c.contratoId !== searchParams.contrato) return false;
    if (searchParams?.categoria && c.oportunidad !== searchParams.categoria) return false;
    if (searchParams?.estado === "abiertos" && c.estado === 1) return false;
    if (searchParams?.estado === "cerrados" && c.estado !== 1) return false;
    return true;
  });

  // Lo más atrasado arriba, siempre. Es el orden con el que se trabaja.
  const orden = [...filtrados].sort((a, b) => {
    const da = diasAtraso(a, hoy), dbb = diasAtraso(b, hoy);
    if (da !== dbb) return dbb - da;
    return fechaEfectiva(a).getTime() - fechaEfectiva(b).getTime();
  });

  const kpi = (label: string, valor: number | string, color?: string, sub?: string) => (
    <div className="card" style={{ padding: "14px 16px" }}>
      <div style={{ fontSize: "0.72rem", color: "var(--muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </div>
      <div style={{ fontSize: "1.9rem", fontWeight: 800, lineHeight: 1.15, color: color ?? "var(--text)" }}>{valor}</div>
      {sub && <div style={{ fontSize: "0.72rem", color: "var(--muted)" }}>{sub}</div>}
    </div>
  );

  return (
    <AppShell
      title="Compromisos"
      user={user}
      activeNav="compromisos"
      showAdminSections={puedeAdministrar}
    >
      <div className="page-stack">
        {alerta && <div className={`alert ${alerta.type}`}>{alerta.text}</div>}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
          {kpi("Vivos", totales.vivos, undefined, "en el sistema")}
          {kpi("Abiertos", totales.abiertos, "#2563eb", "por cerrar")}
          {kpi("Atrasados", totales.atrasados, totales.atrasados > 0 ? "#dc2626" : undefined, "pasaron su fecha")}
          {kpi("Cerrados", totales.cerrados, "#16a34a", "cumplidos")}
          {kpi(
            "Cumplimiento a la fecha",
            `${totales.porcentaje}%`,
            totales.porcentaje >= 90 ? "#16a34a" : totales.porcentaje >= 60 ? "#eab308" : "#dc2626",
            "cerrados sobre cerrados + atrasados",
          )}
        </div>

        {/* ── Filtros ────────────────────────────────────────────────── */}
        <div className="card">
          <form method="GET" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, alignItems: "end" }}>
            <div>
              <label htmlFor="f-semaforo">Semáforo</label>
              <select id="f-semaforo" name="semaforo" defaultValue={searchParams?.semaforo ?? ""}>
                <option value="">Todos</option>
                {SEMAFOROS.map(s => (
                  <option key={s} value={s}>{SEMAFORO_STYLE[s].label}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="f-responsable">Responsable</label>
              <select id="f-responsable" name="responsable" defaultValue={searchParams?.responsable ?? ""}>
                <option value="">Todos</option>
                {responsables.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="f-categoria">Categoría</label>
              <select id="f-categoria" name="categoria" defaultValue={searchParams?.categoria ?? ""}>
                <option value="">Todas</option>
                {categorias.map(c => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="f-contrato">Contrato</label>
              <select id="f-contrato" name="contrato" defaultValue={searchParams?.contrato ?? ""}>
                <option value="">Todos</option>
                {proyectos.filter(p => p.ambito !== "interno").map(p => (
                  <option key={p.id} value={p.id}>{p.mandanteNombre} — {p.nombre}</option>
                ))}
              </select>
            </div>
            <button type="submit">Filtrar</button>
          </form>
        </div>

        {/* ── Tabla ──────────────────────────────────────────────────── */}
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid var(--border)" }}>
                  <th style={{ textAlign: "left", padding: "10px 12px", minWidth: 280 }}>Acción</th>
                  <th style={{ textAlign: "left", padding: "10px 12px" }}>Responsable</th>
                  <th style={{ textAlign: "left", padding: "10px 12px" }}>Categoría</th>
                  <th style={{ textAlign: "left", padding: "10px 12px" }}>Fecha efectiva</th>
                  <th style={{ textAlign: "right", padding: "10px 12px" }}>Atraso</th>
                  <th style={{ textAlign: "center", padding: "10px 12px" }}>Reprog.</th>
                  <th style={{ textAlign: "left", padding: "10px 12px" }}>Estado</th>
                  <th style={{ textAlign: "right", padding: "10px 12px" }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {orden.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: "center", padding: 32, color: "var(--muted)" }}>
                      No hay compromisos con estos filtros.
                    </td>
                  </tr>
                ) : orden.map(c => {
                  const sem = semaforoDe(c, hoy);
                  const st = SEMAFORO_STYLE[sem];
                  const atraso = diasAtraso(c, hoy);
                  const puedeCerrar = c.estado !== 1 && (puedeAdministrar || c.responsable === user.name);
                  return (
                    <tr key={c.id} style={{ borderBottom: "1px solid #f1f5f9", background: sem === "atrasado" ? "#fff5f5" : undefined }}>
                      <td style={{ padding: "10px 12px" }}>
                        <div style={{ fontWeight: 600 }}>
                          {c.accion}
                          {c.requiereVerificacion && (
                            <span title="El extractor no leyó este dato con claridad. Verifícalo." style={{ color: "#f59e0b", marginLeft: 6 }}>●</span>
                          )}
                        </div>
                        <div style={{ fontSize: "0.72rem", color: "var(--muted)", marginTop: 2 }}>
                          Capturado {formatDisplayDate(c.fechaCaptura)}
                          {c.contrato?.nombre && ` · ${c.contrato.nombre}`}
                          {c.observacion && ` · ${c.observacion}`}
                        </div>
                      </td>
                      <td style={{ padding: "10px 12px" }}>{c.responsable}</td>
                      <td style={{ padding: "10px 12px", color: "var(--muted)" }}>{c.oportunidad}</td>
                      <td style={{ padding: "10px 12px" }}>
                        {formatDisplayDate(fechaEfectiva(c))}
                        {c.fecha2doCompromiso && (
                          <div style={{ fontSize: "0.7rem", color: "#9a6300" }}>
                            original {formatDisplayDate(c.fechaCierre)}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 800, color: atraso > 0 ? "#dc2626" : "var(--muted)" }}>
                        {atraso > 0 ? `${atraso} d` : "—"}
                      </td>
                      <td style={{ padding: "10px 12px", textAlign: "center", color: c._count.reprogramaciones > 0 ? "#9a6300" : "var(--muted)", fontWeight: c._count.reprogramaciones > 0 ? 700 : 400 }}>
                        {c._count.reprogramaciones || "—"}
                      </td>
                      <td style={{ padding: "10px 12px" }}>
                        <span style={{ background: st.bg, color: st.color, border: `1px solid ${st.border}`, borderRadius: 6, padding: "2px 9px", fontSize: "0.74rem", fontWeight: 700, whiteSpace: "nowrap" }}>
                          {st.label}
                        </span>
                      </td>
                      <td style={{ padding: "8px 12px" }}>
                        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                          {puedeCerrar && (
                            <form action={cerrarCompromisoAction}>
                              <input type="hidden" name="compromisoId" value={c.id} />
                              <button type="submit" style={{ background: "#16a34a", color: "white", border: "none", borderRadius: 6, padding: "3px 10px", fontSize: "0.74rem", fontWeight: 700, cursor: "pointer" }}>
                                Cerrar
                              </button>
                            </form>
                          )}
                          {puedeAdministrar && c.estado !== 1 && (
                            <details>
                              <summary style={{ cursor: "pointer", fontSize: "0.74rem", color: "var(--muted)", listStyle: "none" }}>Reprogramar</summary>
                              <form action={reprogramarCompromisoAction} style={{ display: "grid", gap: 4, marginTop: 6, padding: 8, background: "var(--surface, #f8fafc)", borderRadius: 8, minWidth: 200 }}>
                                <input type="hidden" name="compromisoId" value={c.id} />
                                <input name="fechaNueva" type="date" required defaultValue={aInputDate(fechaEfectiva(c))} style={{ fontSize: "0.78rem" }} />
                                <input name="motivo" placeholder="Motivo" style={{ fontSize: "0.78rem" }} />
                                <button type="submit" style={{ fontSize: "0.74rem", padding: "3px 8px" }}>Guardar</button>
                              </form>
                            </details>
                          )}
                          {puedeAdministrar && c.estado === 1 && (
                            <form action={reabrirCompromisoAction}>
                              <input type="hidden" name="compromisoId" value={c.id} />
                              <button type="submit" className="secondary" style={{ fontSize: "0.74rem", padding: "3px 10px" }}>Reabrir</button>
                            </form>
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

        {/* ── Alta manual ────────────────────────────────────────────── */}
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Registrar un compromiso</h2>
          <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: "0 0 1rem" }}>
            Para lo que sale fuera de una reunión. La acción se escribe en infinitivo y empezando
            por el verbo: «Cotizar un segundo camión de combustible».
          </p>
          <form action={crearCompromisoAction} className="grid two">
            <div style={{ gridColumn: "1 / -1" }}>
              <label htmlFor="c-accion">Acción</label>
              <input id="c-accion" name="accion" required placeholder="Cotizar un segundo camión de combustible" />
            </div>
            <div>
              <label htmlFor="c-responsable">Responsable</label>
              <input id="c-responsable" name="responsable" required list="responsables-existentes" />
              <datalist id="responsables-existentes">
                {responsables.map(r => <option key={r} value={r} />)}
              </datalist>
            </div>
            <div>
              <label htmlFor="c-oportunidad">Categoría</label>
              <select id="c-oportunidad" name="oportunidad" defaultValue="Otro">
                {categorias.map(c => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="c-captura">Fecha de captura</label>
              <input id="c-captura" name="fechaCaptura" type="date" defaultValue={aInputDate(hoy)} />
            </div>
            <div>
              <label htmlFor="c-cierre">Fecha de cierre</label>
              <input id="c-cierre" name="fechaCierre" type="date" required />
              <span style={{ color: "var(--muted)", fontSize: "0.76rem" }}>
                No se puede editar después: reprogramar deja rastro aparte.
              </span>
            </div>
            <div>
              <label htmlFor="c-contrato">Contrato</label>
              <select id="c-contrato" name="contratoId" defaultValue="">
                <option value="">Sin contrato</option>
                {proyectos.filter(p => p.ambito !== "interno").map(p => (
                  <option key={p.id} value={p.id}>{p.mandanteNombre} — {p.nombre}</option>
                ))}
              </select>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label htmlFor="c-obs">Observación</label>
              <input id="c-obs" name="observacion" />
            </div>
            <div>
              <button type="submit">Registrar</button>
            </div>
          </form>
        </div>
      </div>
    </AppShell>
  );
}
