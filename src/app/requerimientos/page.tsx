import Link from "next/link";
import { db } from "@/lib/db";
import { requireRequerimientos } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { formatDisplayDate } from "@/lib/report-utils";
import { getCargos, getProyectos } from "@/lib/requisitos-db";
import {
  COLUMNAS_TABLERO, FILTROS_ESTADO, PRIORIDADES, SEMAFORO_REQ_STYLE,
  codigoReq, estaTerminada, etiquetaSolicitud, filtrarRequerimientos, indicadores,
  ordenUrgencia, prioridadDe, queryDeFiltros, semaforoDe, textoPlazo, vacantesCubiertas,
  type FiltrosReq,
} from "@/lib/requerimientos";

type SearchParams = FiltrosReq & { vista?: string; status?: string };

const ALERTAS: Record<string, { type: string; text: string }> = {
  ajena: { type: "error", text: "Esa solicitud no es tuya. Solo ves las que pediste." },
  "no-encontrada": { type: "error", text: "Solicitud no encontrada." },
};

export default async function RequerimientosPage({ searchParams }: { searchParams?: SearchParams }) {
  const { user, gerencia, gestiona } = await requireRequerimientos();
  const hoy = new Date();
  const vista = searchParams?.vista === "tabla" ? "tabla" : "tablero";
  const filtros: FiltrosReq = {
    proyecto: searchParams?.proyecto, cargo: searchParams?.cargo,
    solicitante: searchParams?.solicitante, estado: searchParams?.estado,
    prioridad: searchParams?.prioridad, desde: searchParams?.desde, hasta: searchParams?.hasta,
  };
  const alerta = ALERTAS[searchParams?.status ?? ""] ?? null;

  const [cargos, proyectos, filas] = await Promise.all([
    getCargos(),
    getProyectos(),
    db.requerimiento.findMany({
      // El solicitante ve solo lo suyo; RRHH y gerencia, todo.
      where: gestiona ? {} : { solicitanteId: user.id },
      select: {
        id: true, numero: true, cargoId: true, proyectoId: true, vacantes: true,
        fechaRequerida: true, solicitanteNombre: true, prioridad: true, estado: true,
        createdAt: true, contratadoEn: true, turno: true,
        cargo: { select: { nombre: true } },
        proyecto: { select: { nombre: true } },
        postulantes: { select: { estado: true } },
      },
    }),
  ]);

  const conConteo = filas.map(r => ({
    ...r,
    cubiertas: vacantesCubiertas(r.postulantes),
    nPostulantes: r.postulantes.length,
  }));
  const filtradas = filtrarRequerimientos(conConteo, filtros);
  const kpi = indicadores(filtradas, hoy);
  const solicitantes = Array.from(new Set(filas.map(r => r.solicitanteNombre))).sort((a, b) => a.localeCompare(b, "es"));

  // Lo más urgente arriba; lo terminado al final de la tabla.
  const orden = [...filtradas].sort((a, b) => {
    const ta = estaTerminada(a.estado) ? 1 : 0, tb = estaTerminada(b.estado) ? 1 : 0;
    return ta !== tb ? ta - tb : ordenUrgencia(a, b);
  });
  const terminadasOcultas = vista === "tablero" ? orden.filter(r => estaTerminada(r.estado)).length : 0;

  const tarjetaKpi = (label: string, valor: number | string, color?: string, sub?: string) => (
    <div className="card" style={{ padding: "14px 16px" }}>
      <div style={{ fontSize: "0.72rem", color: "var(--muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </div>
      <div style={{ fontSize: "1.9rem", fontWeight: 800, lineHeight: 1.15, color: color ?? "var(--text)" }}>{valor}</div>
      {sub && <div style={{ fontSize: "0.72rem", color: "var(--muted)" }}>{sub}</div>}
    </div>
  );

  const plazo = (r: { estado: string; fechaRequerida: Date }) => {
    const st = SEMAFORO_REQ_STYLE[semaforoDe(r, hoy)];
    return (
      <span style={{ background: st.bg, color: st.color, border: `1px solid ${st.border}`, borderRadius: 6, padding: "1px 8px", fontSize: "0.72rem", fontWeight: 700, whiteSpace: "nowrap" }}>
        {textoPlazo(r, hoy)}
      </span>
    );
  };

  const vistaHref = (v: string) => `/requerimientos${queryDeFiltros(filtros, v === "tabla" ? { vista: "tabla" } : {})}`;
  const estadoFiltro = filtros.estado || "en-curso";

  return (
    <AppShell
      title="Requerimientos de personal"
      user={user}
      activeNav="requerimientos"
      showAdminSections={gerencia}
      rightSlot={<Link href="/requerimientos/nueva"><button type="button">+ Nueva solicitud</button></Link>}
    >
      <div className="page-stack">
        {alerta && <div className={`alert ${alerta.type}`}>{alerta.text}</div>}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
          {tarjetaKpi("Solicitudes abiertas", kpi.abiertas, "#2563eb", "buscando gente")}
          {tarjetaKpi("Atrasadas", kpi.atrasadas, kpi.atrasadas > 0 ? "#dc2626" : undefined, "pasó la fecha sin contratar")}
          {tarjetaKpi("Vacantes por cubrir", kpi.porCubrir, undefined, `de ${kpi.vacantesPedidas} pedidas en las abiertas`)}
          {tarjetaKpi(
            "Tiempo promedio de contratación",
            kpi.promedio == null ? "—" : `${kpi.promedio} d`,
            undefined,
            kpi.contratadas > 0 ? `de la solicitud a la última vacante, en ${kpi.contratadas} solicitud${kpi.contratadas === 1 ? "" : "es"}` : "aún no hay solicitudes cubiertas",
          )}
        </div>

        {/* ── Filtros ────────────────────────────────────────────────── */}
        <div className="card">
          <form method="GET" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, alignItems: "end" }}>
            {vista === "tabla" && <input type="hidden" name="vista" value="tabla" />}
            <div>
              <label htmlFor="f-proyecto">Proyecto</label>
              <select id="f-proyecto" name="proyecto" defaultValue={filtros.proyecto ?? ""}>
                <option value="">Todos</option>
                {proyectos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="f-cargo">Cargo</label>
              <select id="f-cargo" name="cargo" defaultValue={filtros.cargo ?? ""}>
                <option value="">Todos</option>
                {cargos.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
            {gestiona && (
              <div>
                <label htmlFor="f-solicitante">Solicitante</label>
                <select id="f-solicitante" name="solicitante" defaultValue={filtros.solicitante ?? ""}>
                  <option value="">Todos</option>
                  {solicitantes.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            )}
            <div>
              <label htmlFor="f-estado">Estado</label>
              <select id="f-estado" name="estado" defaultValue={estadoFiltro}>
                {FILTROS_ESTADO.map(e => <option key={e.valor} value={e.valor}>{e.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="f-prioridad">Prioridad</label>
              <select id="f-prioridad" name="prioridad" defaultValue={filtros.prioridad ?? ""}>
                <option value="">Todas</option>
                {PRIORIDADES.map(p => <option key={p.valor} value={p.valor}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="f-desde">Requerida desde</label>
              <input id="f-desde" name="desde" type="date" defaultValue={filtros.desde ?? ""} />
            </div>
            <div>
              <label htmlFor="f-hasta">Requerida hasta</label>
              <input id="f-hasta" name="hasta" type="date" defaultValue={filtros.hasta ?? ""} />
            </div>
            <button type="submit">Filtrar</button>
          </form>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", background: "var(--surface)" }}>
            {(["tablero", "tabla"] as const).map(v => (
              <Link key={v} href={vistaHref(v)} style={{
                padding: "6px 14px", fontWeight: 700, fontSize: "0.85rem", textDecoration: "none",
                background: vista === v ? "var(--teal)" : "transparent",
                color: vista === v ? "#fff" : "var(--muted)",
              }}>
                {v === "tablero" ? "Tablero" : "Tabla"}
              </Link>
            ))}
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
              {filtradas.length} solicitud{filtradas.length === 1 ? "" : "es"}
              {!gestiona && " tuyas"}
            </span>
            <a href={`/api/requerimientos/exportar${queryDeFiltros(filtros)}`}>
              <button type="button" className="secondary">Exportar Excel</button>
            </a>
          </div>
        </div>

        {vista === "tablero" ? (
          <>
            <div style={{ overflowX: "auto", paddingBottom: 4 }}>
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${COLUMNAS_TABLERO.length}, minmax(210px, 1fr))`, gap: 10, alignItems: "start", minWidth: COLUMNAS_TABLERO.length * 215 }}>
                {COLUMNAS_TABLERO.map(col => {
                  const tarjetas = orden.filter(r => r.estado === col);
                  return (
                    <div key={col} style={{ background: "#e2eef0", borderRadius: 12, padding: 8, display: "grid", gap: 8 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "2px 4px", fontSize: "0.72rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.03em", color: "var(--muted)" }}>
                        <span>{etiquetaSolicitud(col)}</span>
                        <span style={{ background: "#fff", borderRadius: 99, padding: "0 8px", color: "var(--text)" }}>{tarjetas.length}</span>
                      </div>
                      {tarjetas.length === 0 && (
                        <div style={{ fontSize: "0.75rem", color: "var(--muted)", padding: "6px 4px" }}>Sin solicitudes</div>
                      )}
                      {tarjetas.map(r => {
                        const sem = SEMAFORO_REQ_STYLE[semaforoDe(r, hoy)];
                        const prio = prioridadDe(r.prioridad);
                        const avance = r.vacantes > 0 ? Math.min(100, Math.round((r.cubiertas / r.vacantes) * 100)) : 0;
                        return (
                          <Link key={r.id} href={`/requerimientos/${r.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                            <div style={{
                              background: "#fff", border: "1px solid var(--border)", borderLeft: `4px solid ${sem.barra}`,
                              borderRadius: 9, padding: "8px 10px", display: "grid", gap: 4, fontSize: "0.8rem",
                            }}>
                              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.7rem", fontWeight: 700, color: "var(--muted)" }}>
                                <span>{codigoReq(r.numero)}</span>
                                <span style={{ color: prio.color, textTransform: "uppercase" }}>{prio.label}</span>
                              </div>
                              <div style={{ fontWeight: 800, fontSize: "0.9rem", lineHeight: 1.2 }}>{r.cargo.nombre}</div>
                              <div style={{ color: "var(--muted)" }}>{r.proyecto.nombre} · {r.solicitanteNombre}</div>
                              <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
                                <strong style={{ fontVariantNumeric: "tabular-nums" }}>{r.cubiertas}/{r.vacantes} vacante{r.vacantes === 1 ? "" : "s"}</strong>
                                <span style={{ color: "var(--muted)" }}>{r.nPostulantes} postulante{r.nPostulantes === 1 ? "" : "s"}</span>
                              </div>
                              <div style={{ height: 4, background: "#e2e8f0", borderRadius: 99, overflow: "hidden" }}>
                                <div style={{ width: `${avance}%`, height: "100%", background: "var(--teal)" }} />
                              </div>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                                <span style={{ color: "var(--muted)" }}>requerida {formatDisplayDate(r.fechaRequerida)}</span>
                                {plazo(r)}
                              </div>
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
            {terminadasOcultas > 0 && (
              <p style={{ color: "var(--muted)", fontSize: "0.82rem", margin: 0 }}>
                {terminadasOcultas} cerrada{terminadasOcultas === 1 ? "" : "s"} o desistida{terminadasOcultas === 1 ? "" : "s"} no
                aparece{terminadasOcultas === 1 ? "" : "n"} en el tablero. <Link href={vistaHref("tabla")}>Verlas en la tabla</Link>.
              </p>
            )}
          </>
        ) : (
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid var(--border)" }}>
                    {["N°", "Cargo", "Proyecto", "Solicitante", "Prioridad", "Estado", "Vacantes", "Postulantes", "Fecha requerida", "Plazo"].map(h => (
                      <th key={h} style={{ textAlign: h === "Vacantes" || h === "Postulantes" ? "right" : "left", padding: "10px 12px", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {orden.length === 0 ? (
                    <tr>
                      <td colSpan={10} style={{ textAlign: "center", padding: 32, color: "var(--muted)" }}>
                        No hay solicitudes con estos filtros.
                      </td>
                    </tr>
                  ) : orden.map(r => {
                    const prio = prioridadDe(r.prioridad);
                    const roja = semaforoDe(r, hoy) === "rojo";
                    return (
                      <tr key={r.id} style={{ borderBottom: "1px solid #f1f5f9", background: roja ? "#fff5f5" : undefined }}>
                        <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                          <Link href={`/requerimientos/${r.id}`} style={{ fontWeight: 700 }}>{codigoReq(r.numero)}</Link>
                        </td>
                        <td style={{ padding: "10px 12px", fontWeight: 600 }}>{r.cargo.nombre}</td>
                        <td style={{ padding: "10px 12px" }}>{r.proyecto.nombre}</td>
                        <td style={{ padding: "10px 12px" }}>{r.solicitanteNombre}</td>
                        <td style={{ padding: "10px 12px", color: prio.color, fontWeight: 700 }}>{prio.label}</td>
                        <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>{etiquetaSolicitud(r.estado)}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.cubiertas}/{r.vacantes}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.nPostulantes}</td>
                        <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>{formatDisplayDate(r.fechaRequerida)}</td>
                        <td style={{ padding: "10px 12px" }}>{plazo(r)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {filas.length === 0 && (
          <div className="card" style={{ textAlign: "center", color: "var(--muted)" }}>
            {gestiona
              ? "Todavía no hay solicitudes. Cuando un líder de proyecto pida un cargo, aparece acá y te llega un correo."
              : "Todavía no has pedido ningún cargo. Usa «+ Nueva solicitud» y RRHH recibe el aviso."}
          </div>
        )}
      </div>
    </AppShell>
  );
}
