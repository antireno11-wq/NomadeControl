import Link from "next/link";
import { isAdminRole, TRABAJADORES_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { SectionTabs } from "@/components/section-tabs";
import { buildTrabajadoresTabs } from "@/lib/section-nav";
import { formatDisplayDate } from "@/lib/report-utils";
import { getTiposDocumento, getEstadoDocumental } from "@/lib/acreditacion-db";
import {
  getCargos, getProyectos, getRequisitosPorTrabajador,
  resumirExigencia, tieneBloqueos, type ResumenExigencia,
} from "@/lib/requisitos-db";
import {
  BarraApilada, BarraAvance, BarrasVerticales, Dona,
  colorAvance, etiquetaSemaforo,
} from "@/components/charts-acreditacion";

const C = {
  ok:        "#16a34a",
  porVencer: "#eab308",
  vencido:   "#dc2626",
  faltante:  "#94a3b8",
  info:      "#2563eb",
};

/** COMPLETO / EN PROCESO / CON VENCIDOS / NO INICIADO, como en la planilla. */
function estadoGeneral(e: ResumenExigencia): "completo" | "con_vencidos" | "en_proceso" | "no_iniciado" | "sin_matriz" {
  if (e.sinMatriz) return "sin_matriz";
  if (e.vencidos.length > 0) return "con_vencidos";
  if (e.obligatorios > 0 && e.cumplidos === e.obligatorios) return "completo";
  if (e.cumplidos === 0) return "no_iniciado";
  return "en_proceso";
}

const ESTADO_GENERAL_META = {
  completo:     { label: "Completo",     color: C.ok },
  en_proceso:   { label: "En proceso",   color: C.info },
  con_vencidos: { label: "Con vencidos", color: C.vencido },
  no_iniciado:  { label: "No iniciado",  color: C.faltante },
  sin_matriz:   { label: "Sin matriz",   color: "#f59e0b" },
} as const;

export default async function DashboardAcreditacionPage({
  searchParams,
}: {
  searchParams?: { proyecto?: string | string[] };
}) {
  const user = await requireRole(TRABAJADORES_ROLES);
  const canSeeAdmin = isAdminRole(user.role);
  const today = new Date();

  const proyectoParam = typeof searchParams?.proyecto === "string" ? searchParams.proyecto : "";

  const [proyectos, cargos, tipos] = await Promise.all([
    getProyectos(),
    getCargos(),
    getTiposDocumento(),
  ]);

  const proyectoSel = proyectos.find(p => p.id === proyectoParam) ?? null;

  const staff = await db.staffMember.findMany({
    where: { isActive: true, ...(proyectoSel ? { proyectoId: proyectoSel.id } : {}) },
    select: {
      id: true, fullName: true, nationalId: true, cargoId: true, proyectoId: true,
      contractIsIndefinite: true, trabajoPrevioMandante: true, contractEndDate: true,
    },
    orderBy: { fullName: "asc" },
  });

  const [estados, requisitos] = await Promise.all([
    getEstadoDocumental(staff.map(w => w.id), tipos, today),
    getRequisitosPorTrabajador(staff.map(w => ({
      id: w.id,
      proyectoId: w.proyectoId,
      cargoId: w.cargoId,
      contractIsIndefinite: w.contractIsIndefinite,
      trabajoPrevioMandante: w.trabajoPrevioMandante,
      contractEndDate: w.contractEndDate,
    }))),
  ]);

  const nombrePorTipo = new Map(tipos.map(t => [t.id, t.nombre]));
  const nombreCargo = new Map(cargos.map(c => [c.id, c.nombre]));

  const filas = staff.map(w => ({
    worker: w,
    estado: estados.get(w.id),
    reqs: requisitos.get(w.id) ?? null,
    exigencia: resumirExigencia(requisitos.get(w.id) ?? null, estados.get(w.id), nombrePorTipo),
  }));

  // ── KPIs globales ────────────────────────────────────────────────────
  // El denominador son los obligatorios de cada cargo, no el catálogo
  // completo: es la diferencia entre medir el avance real y castigar a un
  // maestro de cocina por no tener curso 4x4.
  const aplicables   = filas.reduce((s, f) => s + f.exigencia.obligatorios, 0);
  const cumplidos    = filas.reduce((s, f) => s + f.exigencia.cumplidos, 0);
  const vencidos     = filas.reduce((s, f) => s + f.exigencia.vencidos.length, 0);
  const sinCargar    = filas.reduce((s, f) => s + f.exigencia.faltantes.length, 0);
  const porVencer    = filas.reduce((s, f) => s + f.exigencia.porVencer.length, 0);
  const porGestionar = vencidos + sinCargar;
  const avance       = aplicables === 0 ? 0 : Math.round((cumplidos / aplicables) * 100);
  const bloqueados   = filas.filter(f => tieneBloqueos(f.exigencia));

  // ── Distribución por estado general ──────────────────────────────────
  const conteoEstado = new Map<keyof typeof ESTADO_GENERAL_META, number>();
  for (const f of filas) {
    const k = estadoGeneral(f.exigencia);
    conteoEstado.set(k, (conteoEstado.get(k) ?? 0) + 1);
  }

  // ── Aging: cuánto le queda a cada obligatorio ya cargado ─────────────
  const tramos = [
    { label: "Vencidos",   sub: "acción hoy",  color: C.vencido,   test: (d: number) => d < 0 },
    { label: "≤ 7 días",   sub: "crítico",     color: "#f97316",   test: (d: number) => d >= 0 && d <= 7 },
    { label: "8 a 30",     sub: "urgente",     color: C.porVencer, test: (d: number) => d > 7 && d <= 30 },
    { label: "31 a 60",    sub: "planificar",  color: "#38bdf8",   test: (d: number) => d > 30 && d <= 60 },
    { label: "> 60 días",  sub: "al día",      color: C.ok,        test: (d: number) => d > 60 },
  ];
  const conteoTramo = tramos.map(() => 0);
  for (const f of filas) {
    if (!f.reqs) continue;
    for (const req of f.reqs) {
      if (req.nivel !== "obligatorio") continue;
      const dias = f.estado?.porTipo.get(req.tipoId)?.dias;
      if (dias == null) continue;
      const i = tramos.findIndex(t => t.test(dias));
      if (i >= 0) conteoTramo[i]++;
    }
  }

  // ── Avance por cargo ─────────────────────────────────────────────────
  const porCargo = [...cargos]
    .map(c => {
      const suyas = filas.filter(f => f.worker.cargoId === c.id);
      const obl = suyas.reduce((s, f) => s + f.exigencia.obligatorios, 0);
      const ok  = suyas.reduce((s, f) => s + f.exigencia.cumplidos, 0);
      const ven = suyas.reduce((s, f) => s + f.exigencia.vencidos.length, 0);
      const fal = suyas.reduce((s, f) => s + f.exigencia.faltantes.length, 0);
      return {
        cargo: c.nombre, personas: suyas.length,
        obligatorios: obl, ok, vencidos: ven, faltantes: fal,
        pct: obl === 0 ? 0 : Math.round((ok / obl) * 100),
      };
    })
    .filter(c => c.personas > 0)
    .sort((a, b) => a.pct - b.pct);

  const sinCargo = filas.filter(f => !f.worker.cargoId || !f.worker.proyectoId);

  // ── Estado por documento, los más atrasados primero ──────────────────
  const porDocumento = tipos
    .map(t => {
      let exigido = 0, ok = 0, ven = 0, fal = 0;
      for (const f of filas) {
        const req = f.reqs?.find(r => r.tipoId === t.id && r.nivel === "obligatorio");
        if (!req) continue;
        exigido++;
        if (f.exigencia.vencidos.some(d => d.tipoId === t.id)) ven++;
        else if (f.exigencia.faltantes.some(d => d.tipoId === t.id)) fal++;
        else ok++;
      }
      return {
        nombre: t.nombre, exigido, ok, vencidos: ven, faltantes: fal,
        pct: exigido === 0 ? 100 : Math.round((ok / exigido) * 100),
      };
    })
    .filter(d => d.exigido > 0)
    .sort((a, b) => a.pct - b.pct);

  // ── Trabajadores con más pendientes ──────────────────────────────────
  const topPendientes = [...filas]
    .filter(f => !f.exigencia.sinMatriz)
    .map(f => ({
      ...f,
      pendientes: f.exigencia.faltantes.length + f.exigencia.vencidos.length,
    }))
    .filter(f => f.pendientes > 0)
    .sort((a, b) => b.pendientes - a.pendientes)
    .slice(0, 12);

  const card: React.CSSProperties = { padding: "18px 20px" };
  const tituloCard: React.CSSProperties = {
    margin: "0 0 14px", fontSize: "0.8rem", fontWeight: 800,
    textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)",
  };

  return (
    <AppShell
      title="Dashboard de acreditación"
      user={user}
      activeNav="trabajadores"
      showAdminSections={canSeeAdmin}
      rightSlot={
        <Link href="/trabajadores/control-documental">
          <button type="button" className="secondary">Ver matriz</button>
        </Link>
      }
    >
      <div className="page-stack">
        <SectionTabs items={buildTrabajadoresTabs("dashboard")} />

        {/* ── Encabezado ─────────────────────────────────────────────── */}
        <div className="card" style={{ ...card, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 14 }}>
          <div>
            <div style={{ fontSize: "1.15rem", fontWeight: 800, color: "var(--text)" }}>
              {proyectoSel
                ? `${proyectoSel.mandanteNombre} — ${proyectoSel.nombre}`
                : "Todos los proyectos"}
              {proyectoSel?.faena && (
                <span style={{ color: "var(--muted)", fontWeight: 500 }}> · {proyectoSel.faena}</span>
              )}
            </div>
            <div style={{ color: "var(--muted)", fontSize: "0.82rem", marginTop: 2 }}>
              Reporte al {formatDisplayDate(today)} · {staff.length} trabajador{staff.length === 1 ? "" : "es"} en dotación
            </div>
          </div>
          {proyectos.length > 0 && (
            <form method="GET" style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <select name="proyecto" defaultValue={proyectoSel?.id ?? ""} style={{ padding: "6px 10px", fontSize: "0.85rem" }}>
                <option value="">Todos los proyectos</option>
                {proyectos.map(p => (
                  <option key={p.id} value={p.id}>{p.mandanteNombre} — {p.nombre}</option>
                ))}
              </select>
              <button type="submit" className="secondary">Filtrar</button>
            </form>
          )}
        </div>

        {sinCargo.length > 0 && (
          <div style={{ border: "2px dashed #f59e0b", background: "#fffbeb", borderRadius: 12, padding: "14px 20px" }}>
            <strong style={{ color: "#92400e" }}>
              {sinCargo.length} trabajador{sinCargo.length === 1 ? "" : "es"} queda{sinCargo.length === 1 ? "" : "n"} fuera de este tablero
            </strong>
            <div style={{ color: "#92400e", fontSize: "0.85rem", marginTop: 4 }}>
              No tienen proyecto o grupo de dotación asignado, así que no se les puede calcular qué
              documentos les corresponden. Los números de abajo NO los incluyen.
            </div>
          </div>
        )}

        {/* ── Fila 1: estado global, aging, no habilitables ──────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 300px) 1fr", gap: 16, alignItems: "stretch" }}>
          <div className="card" style={card}>
            <h3 style={tituloCard}>Estado documental</h3>
            <Dona
              total={aplicables}
              titulo="documentos exigidos por cargo"
              segmentos={[
                { label: "Al día",        valor: cumplidos - porVencer, color: C.ok },
                { label: "Por vencer",    valor: porVencer,             color: C.porVencer },
                { label: "Vencidos",      valor: vencidos,              color: C.vencido },
                { label: "Sin cargar",    valor: sinCargar,             color: C.faltante },
              ]}
            />
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Avance global</span>
                <strong style={{ fontSize: "1.35rem", color: colorAvance(avance) }}>{avance}%</strong>
              </div>
              <div style={{ marginTop: 6 }}>
                <BarraAvance porcentaje={avance} color={colorAvance(avance)} alto={10} />
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: 6 }}>
                {porGestionar.toLocaleString("es-CL")} por gestionar
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
              {[
                { label: "No habilitables", valor: bloqueados.length, color: C.vencido, sub: "les falta un obligatorio", href: "/trabajadores/control-documental?estado=bloqueado" },
                { label: "Vencidos",        valor: vencidos,          color: C.vencido, sub: "acción inmediata",        href: "/trabajadores/control-documental?estado=vencido" },
                { label: "Por vencer",      valor: porVencer,         color: C.porVencer, sub: "próximos 30 días",      href: "/trabajadores/control-documental?estado=por_vencer" },
                { label: "Sin cargar",      valor: sinCargar,         color: C.faltante, sub: "nunca se subieron",      href: "/trabajadores/control-documental?estado=sin_fecha" },
              ].map(k => (
                <Link key={k.label} href={k.href} style={{ textDecoration: "none" }}>
                  <div className="card" style={{ padding: "14px 16px", height: "100%" }}>
                    <div style={{ fontSize: "0.72rem", color: "var(--muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                      {k.label}
                    </div>
                    <div style={{ fontSize: "1.9rem", fontWeight: 800, color: k.valor > 0 ? k.color : "var(--muted)", lineHeight: 1.15 }}>
                      {k.valor}
                    </div>
                    <div style={{ fontSize: "0.72rem", color: "var(--muted)" }}>{k.sub}</div>
                  </div>
                </Link>
              ))}
            </div>

            <div className="card" style={{ ...card, flex: 1 }}>
              <h3 style={tituloCard}>Vencimientos por tramo</h3>
              <BarrasVerticales
                datos={tramos.map((t, i) => ({ label: t.label, sub: t.sub, color: t.color, valor: conteoTramo[i] }))}
              />
              <p style={{ fontSize: "0.75rem", color: "var(--muted)", margin: "10px 0 0" }}>
                Solo documentos obligatorios ya cargados y con fecha. Los que nunca se subieron no
                tienen tramo: están en «sin cargar».
              </p>
            </div>
          </div>
        </div>

        {/* ── Fila 2: dotación por estado + avance por cargo ─────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 300px) 1fr", gap: 16, alignItems: "start" }}>
          <div className="card" style={card}>
            <h3 style={tituloCard}>Dotación por estado</h3>
            <Dona
              size={170} grosor={24}
              total={staff.length}
              titulo="trabajadores activos"
              segmentos={(Object.keys(ESTADO_GENERAL_META) as Array<keyof typeof ESTADO_GENERAL_META>)
                .map(k => ({
                  label: ESTADO_GENERAL_META[k].label,
                  color: ESTADO_GENERAL_META[k].color,
                  valor: conteoEstado.get(k) ?? 0,
                }))}
            />
          </div>

          <div className="card" style={card}>
            <h3 style={tituloCard}>Avance por cargo</h3>
            {porCargo.length === 0 ? (
              <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: 0 }}>
                Todavía no hay trabajadores con grupo de dotación asignado.
              </p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid var(--border)" }}>
                      <th style={{ textAlign: "left", padding: "6px 8px", color: "var(--muted)", fontSize: "0.72rem" }}>Cargo</th>
                      <th style={{ textAlign: "right", padding: "6px 8px", color: "var(--muted)", fontSize: "0.72rem" }}>Personas</th>
                      <th style={{ textAlign: "right", padding: "6px 8px", color: "var(--muted)", fontSize: "0.72rem" }}>Al día</th>
                      <th style={{ textAlign: "right", padding: "6px 8px", color: "var(--muted)", fontSize: "0.72rem" }}>Por gestionar</th>
                      <th style={{ textAlign: "left", padding: "6px 8px", color: "var(--muted)", fontSize: "0.72rem", minWidth: 130 }}>Avance</th>
                      <th style={{ textAlign: "center", padding: "6px 8px", color: "var(--muted)", fontSize: "0.72rem" }}>Semáforo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {porCargo.map(c => {
                      const sem = etiquetaSemaforo(c.pct);
                      return (
                        <tr key={c.cargo} style={{ borderBottom: "1px solid #f1f5f9" }}>
                          <td style={{ padding: "7px 8px", fontWeight: 600 }}>{c.cargo}</td>
                          <td style={{ padding: "7px 8px", textAlign: "right" }}>{c.personas}</td>
                          <td style={{ padding: "7px 8px", textAlign: "right", color: C.ok, fontWeight: 700 }}>{c.ok}</td>
                          <td style={{ padding: "7px 8px", textAlign: "right", color: c.vencidos + c.faltantes > 0 ? C.vencido : "var(--muted)", fontWeight: 700 }}>
                            {c.vencidos + c.faltantes}
                          </td>
                          <td style={{ padding: "7px 8px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <BarraAvance porcentaje={c.pct} color={colorAvance(c.pct)} />
                              <span style={{ fontWeight: 700, minWidth: 34, textAlign: "right" }}>{c.pct}%</span>
                            </div>
                          </td>
                          <td style={{ padding: "7px 8px", textAlign: "center" }}>
                            <span style={{ background: sem.bg, color: sem.color, borderRadius: 5, padding: "2px 8px", fontSize: "0.68rem", fontWeight: 800 }}>
                              {sem.texto}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* ── Fila 3: por documento + top pendientes ─────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: 16, alignItems: "start" }}>
          <div className="card" style={card}>
            <h3 style={tituloCard}>Estado por documento · los más atrasados primero</h3>
            {porDocumento.length === 0 ? (
              <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: 0 }}>
                Sin matriz de requisitos definida todavía.
              </p>
            ) : (
              <div style={{ display: "grid", gap: 9, maxHeight: 460, overflowY: "auto" }}>
                {porDocumento.map(d => (
                  <div key={d.nombre}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem", marginBottom: 3 }}>
                      <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: 8 }}>
                        {d.nombre}
                      </span>
                      <span style={{ color: colorAvance(d.pct), fontWeight: 800, flexShrink: 0 }}>{d.pct}%</span>
                    </div>
                    <BarraApilada
                      alto={16}
                      partes={[
                        { valor: d.ok,        color: C.ok,       label: "Al día" },
                        { valor: d.vencidos,  color: C.vencido,  label: "Vencidos" },
                        { valor: d.faltantes, color: C.faltante, label: "Sin cargar" },
                      ]}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card" style={card}>
            <h3 style={tituloCard}>Trabajadores con más documentos por gestionar</h3>
            {topPendientes.length === 0 ? (
              <p style={{ color: C.ok, fontSize: "0.85rem", margin: 0, fontWeight: 600 }}>
                Nadie tiene obligatorios pendientes.
              </p>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {topPendientes.map(f => (
                  <Link
                    key={f.worker.id}
                    href={`/trabajadores/${f.worker.id}?tab=documentos`}
                    style={{ textDecoration: "none", color: "inherit" }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{
                        background: C.vencido, color: "white", borderRadius: 5,
                        padding: "2px 8px", fontSize: "0.72rem", fontWeight: 800, minWidth: 30, textAlign: "center",
                      }}>
                        {f.pendientes}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "0.82rem", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {f.worker.fullName}
                        </div>
                        <div style={{ fontSize: "0.7rem", color: "var(--muted)" }}>
                          {nombreCargo.get(f.worker.cargoId ?? "") ?? "Sin cargo"}
                          {" · "}{f.exigencia.cumplidos}/{f.exigencia.obligatorios} al día
                        </div>
                      </div>
                      <div style={{ width: 90, flexShrink: 0 }}>
                        <BarraAvance
                          porcentaje={f.exigencia.porcentaje ?? 0}
                          color={colorAvance(f.exigencia.porcentaje ?? 0)}
                        />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
