import Link from "next/link";
import { db } from "@/lib/db";
import { OPERATION_ROLES, isAdminRole, requireRole } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { formatDisplayDate } from "@/lib/report-utils";
import { getProyectos } from "@/lib/requisitos-db";

/**
 * Informes diarios de avance, tal como llegan del formulario de Google.
 *
 * Una tarjeta por informe, los más nuevos arriba, filtrables por faena. Los
 * hallazgos van destacados: es lo único de la jornada que necesita que
 * alguien haga algo, y en el formulario queda enterrado al final.
 */
export default async function InformesAvancePage({
  searchParams,
}: {
  searchParams?: { proyecto?: string; desde?: string };
}) {
  const user = await requireRole(OPERATION_ROLES);
  const proyectos = await getProyectos();
  const proyectoSel = searchParams?.proyecto && proyectos.some(p => p.id === searchParams.proyecto)
    ? searchParams.proyecto : "";

  const informes = await db.informeAvance.findMany({
    where: proyectoSel ? { proyectoId: proyectoSel } : {},
    orderBy: [{ fecha: "desc" }, { createdAt: "desc" }],
    take: 60,
    include: { proyecto: { select: { nombre: true, mandante: { select: { nombre: true } } } } },
  });

  const fotos = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const idDrive = (url: string) => url.match(/\/d\/([^/]+)/)?.[1] ?? null;
  const conHallazgos = informes.filter(i => i.hallazgos).length;

  return (
    <AppShell title="Informes de avance" user={user} activeNav="operaciones" showAdminSections={isAdminRole(user.role)}>
      <div className="page-stack">
        <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <strong>{informes.length} informes</strong>
            <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
              {" "}· {conHallazgos} con hallazgos · llegan del formulario al cierre de cada jornada
            </span>
          </div>
          <form method="GET" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select name="proyecto" defaultValue={proyectoSel} style={{ width: "auto" }}>
              <option value="">Todas las faenas</option>
              {proyectos.filter(p => p.ambito !== "interno").map(p => (
                <option key={p.id} value={p.id}>{p.mandanteNombre} — {p.nombre}</option>
              ))}
            </select>
            <button type="submit" className="secondary" style={{ width: "auto" }}>Filtrar</button>
          </form>
        </div>

        {informes.length === 0 && (
          <div className="card" style={{ color: "var(--muted)" }}>
            Todavía no llega ningún informe. Cuando el formulario esté conectado, aparecen acá solos.
          </div>
        )}

        {informes.map(inf => (
          <div key={inf.id} className="card" style={{ borderLeft: inf.hallazgos ? "4px solid #dc2626" : "4px solid var(--border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
              <div>
                <strong style={{ fontSize: "1.02rem" }}>{formatDisplayDate(inf.fecha)}</strong>
                <span style={{ color: "var(--teal)", fontWeight: 700, marginLeft: 10 }}>
                  {inf.proyecto ? `${inf.proyecto.mandante?.nombre ?? ""} — ${inf.proyecto.nombre}` : inf.proyectoTexto}
                </span>
                {!inf.proyecto && (
                  <span style={{ marginLeft: 8, fontSize: "0.72rem", color: "#9a6300", fontWeight: 700 }}>
                    sin proyecto reconocido
                  </span>
                )}
              </div>
              <div style={{ fontSize: "0.82rem", color: "var(--muted)" }}>
                {inf.responsable}
                {inf.horaIngreso && inf.horaTermino && ` · ${inf.horaIngreso}–${inf.horaTermino}`}
                {inf.dotacionTotal != null && ` · ${inf.dotacionTotal} personas`}
              </div>
            </div>

            {inf.dotacionDetalle && (
              <div style={{ fontSize: "0.82rem", color: "var(--muted)", marginTop: 4 }}>{inf.dotacionDetalle}</div>
            )}

            <p style={{ margin: "10px 0 0", fontSize: "0.9rem", whiteSpace: "pre-wrap" }}>{inf.actividades}</p>

            {inf.hallazgos && (
              <div style={{ marginTop: 10, padding: "10px 12px", background: "#fce9e8", borderRadius: 8, fontSize: "0.88rem" }}>
                <strong style={{ color: "#9e2f23" }}>Hallazgos</strong>
                <p style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{inf.hallazgos}</p>
              </div>
            )}

            {inf.observaciones && (
              <p style={{ margin: "8px 0 0", fontSize: "0.84rem", color: "var(--muted)", whiteSpace: "pre-wrap" }}>{inf.observaciones}</p>
            )}

            {(fotos(inf.fotosDocumentacion).length > 0 || fotos(inf.fotosAvance).length > 0) && (
              <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 10 }}>
                {([["Documentación", fotos(inf.fotosDocumentacion)], ["Avance", fotos(inf.fotosAvance)]] as const)
                  .filter(([, lista]) => lista.length > 0)
                  .map(([titulo, lista]) => (
                    <div key={titulo}>
                      <div style={{ fontSize: "0.7rem", color: "var(--muted)", fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>{titulo}</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {lista.map((url, i) => {
                          const id = idDrive(url);
                          return (
                            <a key={i} href={url} target="_blank" rel="noreferrer" title="Abrir en Drive">
                              {id ? (
                                /* eslint-disable-next-line @next/next/no-img-element */
                                <img src={`https://drive.google.com/thumbnail?id=${id}&sz=w160`} alt="" loading="lazy"
                                     style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)", display: "block" }} />
                              ) : (
                                <span style={{ fontSize: "0.78rem" }}>foto {i + 1} ↗</span>
                              )}
                            </a>
                          );
                        })}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        ))}

        <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
          Las fotos se abren en Drive con la cuenta de Google de la empresa.{" "}
          <Link href="/operaciones?vista=campamentos">← Campamentos</Link>
        </div>
      </div>
    </AppShell>
  );
}
