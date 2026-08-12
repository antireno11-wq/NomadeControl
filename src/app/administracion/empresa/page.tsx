import Link from "next/link";
import { ADMIN_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { formatDisplayDate } from "@/lib/report-utils";
import { calcularEstado, ESTADO_STYLE, esEstadoOk } from "@/lib/acreditacion";
import { getTiposDocumento } from "@/lib/acreditacion-db";
import { subirDocumentoEmpresaAction, anularDocumentoEmpresaAction } from "./actions";

export default async function DocumentosEmpresaPage({
  searchParams,
}: {
  searchParams?: { status?: string | string[] };
}) {
  const user = await requireRole(ADMIN_ROLES);
  const today = new Date();

  const status = typeof searchParams?.status === "string" ? searchParams.status : "";
  const alerta =
    status === "ok" ? { type: "success", text: "Documento cargado." }
    : status === "anulado" ? { type: "success", text: "Documento anulado." }
    : status === "sin-fecha" ? { type: "error", text: "Falta la fecha de vencimiento, o marca que no vence." }
    : status === "pesado" ? { type: "error", text: "El archivo supera los 18 MB." }
    : status === "invalido" ? { type: "error", text: "Revisa los datos del documento." }
    : null;

  const tipos = await getTiposDocumento(false, "empresa");
  const documentos = await db.documentoEmpresa.findMany({
    where: { anulado: false },
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true, tipoDocumentoId: true, fechaEmision: true, fechaVencimiento: true,
      sinVencimiento: true, vencimientoCalculado: true, archivoId: true,
      originalFilename: true, subidoPorNombre: true, createdAt: true,
    },
  });

  // El vigente por tipo: el de emisión más reciente, igual que en la ficha.
  const vigentePorTipo = new Map<string, (typeof documentos)[number]>();
  for (const doc of documentos) {
    const actual = vigentePorTipo.get(doc.tipoDocumentoId);
    if (!actual) { vigentePorTipo.set(doc.tipoDocumentoId, doc); continue; }
    const ec = doc.fechaEmision?.getTime() ?? 0;
    const ea = actual.fechaEmision?.getTime() ?? 0;
    if (ec > ea || (ec === ea && doc.createdAt > actual.createdAt)) {
      vigentePorTipo.set(doc.tipoDocumentoId, doc);
    }
  }

  const filas = tipos.map(tipo => {
    const doc = vigentePorTipo.get(tipo.id) ?? null;
    const { estado, dias } = calcularEstado(doc, today, 30, tipo.noVence);
    return { tipo, doc, estado, dias };
  });

  const pendientes = filas.filter(f => !esEstadoOk(f.estado));

  return (
    <AppShell
      title="Documentos de la empresa"
      user={user}
      activeNav="administracion"
      showAdminSections
      rightSlot={
        <Link href="/administracion?seccion=requisitos">
          <button type="button" className="secondary">← Administración</button>
        </Link>
      }
    >
      <div className="page-stack">
        {alerta && <div className={`alert ${alerta.type}`}>{alerta.text}</div>}

        <div className="card" style={{ padding: "16px 20px" }}>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.88rem" }}>
            Documentos de la razón social, no de una persona. El mandante los exige igual que los
            del trabajador, pero valen para toda la dotación: cargarlos por ficha sería multiplicar
            el mismo papel por cada trabajador.
          </p>
        </div>

        {pendientes.length > 0 && (
          <div style={{
            border: "2px solid #dc2626", background: "#fef2f2", borderRadius: 12,
            padding: "16px 20px",
          }}>
            <strong style={{ color: "#991b1b", fontSize: "1.05rem" }}>
              {pendientes.length} documento{pendientes.length === 1 ? "" : "s"} de la empresa sin cargar o vencido{pendientes.length === 1 ? "" : "s"}
            </strong>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
              {pendientes.map(f => (
                <span key={f.tipo.id} style={{
                  background: f.estado === "vencido" ? "#dc2626" : "white",
                  color: f.estado === "vencido" ? "white" : "#991b1b",
                  border: "1px solid #fca5a5", borderRadius: 6,
                  padding: "4px 10px", fontSize: "0.8rem", fontWeight: 600,
                }}>
                  {f.tipo.nombre}{f.estado === "vencido" ? " · vencido" : ""}
                </span>
              ))}
            </div>
            <div style={{ color: "#991b1b", fontSize: "0.82rem", marginTop: 10 }}>
              Esto no bloquea a ningún trabajador en particular: bloquea el contrato completo.
            </div>
          </div>
        )}

        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.86rem" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid var(--border)" }}>
                  <th style={{ textAlign: "left", padding: "10px 14px" }}>Documento</th>
                  <th style={{ textAlign: "left", padding: "10px 14px" }}>Estado</th>
                  <th style={{ textAlign: "left", padding: "10px 14px" }}>Emisión</th>
                  <th style={{ textAlign: "left", padding: "10px 14px" }}>Vencimiento</th>
                  <th style={{ textAlign: "left", padding: "10px 14px" }}>Archivo</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filas.map(({ tipo, doc, estado, dias }) => {
                  const st = ESTADO_STYLE[estado];
                  return (
                    <tr key={tipo.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "10px 14px", fontWeight: 600 }}>{tipo.nombre}</td>
                      <td style={{ padding: "10px 14px" }}>
                        <span style={{
                          background: st.bg, color: st.color, border: `1px solid ${st.border}`,
                          borderRadius: 6, padding: "2px 10px", fontSize: "0.76rem", fontWeight: 700,
                          // Borde punteado = vigencia inferida, no impresa.
                          borderStyle: doc?.vencimientoCalculado ? "dashed" : "solid",
                        }}>
                          {st.label}
                        </span>
                        {dias !== null && estado !== "vigente" && (
                          <span style={{ color: "var(--muted)", fontSize: "0.75rem", marginLeft: 8 }}>
                            {dias < 0 ? `hace ${Math.abs(dias)} d` : `en ${dias} d`}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "10px 14px", color: "var(--muted)" }}>
                        {doc?.fechaEmision ? formatDisplayDate(doc.fechaEmision) : "—"}
                      </td>
                      <td style={{ padding: "10px 14px" }}>
                        {doc?.sinVencimiento ? "∞ No vence"
                          : doc?.fechaVencimiento ? formatDisplayDate(doc.fechaVencimiento) : "—"}
                      </td>
                      <td style={{ padding: "10px 14px" }}>
                        {doc?.archivoId ? (
                          <a href={`/api/archivo/${doc.archivoId}`} target="_blank" rel="noreferrer"
                             style={{ color: "var(--teal)", fontWeight: 600 }}>
                            📎 {doc.originalFilename ?? "Ver"}
                          </a>
                        ) : <span style={{ color: "var(--muted)" }}>—</span>}
                      </td>
                      <td style={{ padding: "10px 14px", textAlign: "right" }}>
                        {doc && (
                          <form action={anularDocumentoEmpresaAction}>
                            <input type="hidden" name="documentoId" value={doc.id} />
                            <button type="submit" className="secondary" style={{ fontSize: "0.75rem", padding: "3px 10px" }}>
                              Anular
                            </button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Cargar documento</h2>
          <form action={subirDocumentoEmpresaAction} className="grid two">
            <div>
              <label htmlFor="de-tipo">Documento</label>
              <select id="de-tipo" name="tipoDocumentoId" required>
                {tipos.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="de-archivo">Archivo</label>
              <input id="de-archivo" name="archivo" type="file" accept=".pdf,.docx,image/*" />
            </div>
            <div>
              <label htmlFor="de-emision">Fecha de emisión</label>
              <input id="de-emision" name="fechaEmision" type="date" />
            </div>
            <div>
              <label htmlFor="de-vencimiento">Fecha de vencimiento</label>
              <input id="de-vencimiento" name="fechaVencimiento" type="date" />
            </div>
            <div>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <input type="checkbox" name="sinVencimiento" />
                No vence
              </label>
              <span style={{ color: "var(--muted)", fontSize: "0.78rem" }}>
                Márcalo cuando el documento no traiga vencimiento, como el inicio de actividades.
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <button type="submit">Cargar</button>
            </div>
          </form>
          <p style={{ color: "var(--muted)", fontSize: "0.78rem", marginTop: 12 }}>
            Cargar de nuevo un documento no reemplaza al anterior: queda la versión nueva como
            vigente y la anterior en el historial. Ante un reclamo del mandante hay que poder
            mostrar qué se tenía cargado en cada momento.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
