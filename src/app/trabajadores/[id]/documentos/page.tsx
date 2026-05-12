import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole, TRABAJADORES_ROLES } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { createDocumentoTrabajadorAction, deleteDocumentoTrabajadorAction } from "@/app/trabajadores/documentos/actions";

const TIPO_LABELS: Record<string, string> = {
  licencia_conducir: "Licencia de conducir",
  carnet_identidad: "Carnet de identidad",
  contrato: "Contrato de trabajo",
  anexo_contrato: "Anexo de contrato",
  examen_preocupacional: "Examen preocupacional",
  examen_periodico: "Examen periódico",
  odi_firmada: "ODI firmada",
  induccion: "Inducción de seguridad",
  capacitacion: "Certificado de capacitación",
  credencial: "Credencial / Acreditación de faena",
  altura_fisica: "Certificado altura física",
  altura_trabajos: "Trabajo en altura",
  espacios_confinados: "Espacios confinados",
  antecedentes: "Certificado de antecedentes",
  liquidacion: "Liquidación de sueldo",
  finiquito: "Finiquito",
  otro: "Otro",
};

export default async function DocumentosTrabajadorPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { status?: string };
}) {
  const user = await requireRole(TRABAJADORES_ROLES);

  const [worker, documentos] = await Promise.all([
    db.staffMember.findUnique({ where: { id: params.id }, include: { camp: true } }),
    db.documentoTrabajador.findMany({
      where: { staffMemberId: params.id },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  if (!worker) notFound();

  const status = searchParams?.status ?? "";

  const alert =
    status === "created"
      ? { type: "success", text: "Documento cargado correctamente." }
      : status === "deleted"
      ? { type: "success", text: "Documento eliminado." }
      : status === "invalid"
      ? { type: "error", text: "Revisa los campos obligatorios." }
      : null;

  return (
    <AppShell
      title={`Documentos — ${worker.fullName}`}
      user={user}
      activeNav="trabajadores"
      rightSlot={
        <Link href={`/trabajadores/${params.id}`}>
          <button type="button" className="secondary">← Volver</button>
        </Link>
      }
    >
      <div className="page-stack">
        {alert && <div className={`alert ${alert.type}`}>{alert.text}</div>}

        <div className="grid two" style={{ alignItems: "start", gap: "1.5rem" }}>
          {/* ── Upload form ───────────────────────────────────────────── */}
          <div className="card">
            <h2 style={{ marginTop: 0, fontSize: "1rem" }}>Cargar documento</h2>
            <form action={createDocumentoTrabajadorAction} encType="multipart/form-data" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <input type="hidden" name="staffMemberId" value={params.id} />

              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 4, color: "var(--muted)" }}>
                  Tipo de documento *
                </label>
                <select name="tipo" required className="input" style={{ width: "100%" }}>
                  <option value="">Seleccionar tipo…</option>
                  {Object.entries(TIPO_LABELS).map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 4, color: "var(--muted)" }}>
                  Nombre / descripción *
                </label>
                <input name="nombre" type="text" required className="input" placeholder="Ej: Licencia clase B vigente" style={{ width: "100%" }} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 4, color: "var(--muted)" }}>
                    Fecha de emisión
                  </label>
                  <input name="fechaEmision" type="date" className="input" style={{ width: "100%" }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 4, color: "var(--muted)" }}>
                    Vencimiento ⚠️
                  </label>
                  <input name="fechaVencimiento" type="date" className="input" style={{ width: "100%" }} />
                </div>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 4, color: "var(--muted)" }}>
                  Notas
                </label>
                <textarea name="notas" className="input" rows={3} placeholder="Observaciones opcionales…" style={{ width: "100%", resize: "vertical" }} />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 4, color: "var(--muted)" }}>
                  Archivo (PDF / imagen)
                </label>
                <input name="file" type="file" accept="application/pdf,image/*" className="input" style={{ width: "100%", padding: "6px 8px" }} />
              </div>

              <button type="submit" className="btn primary" style={{ alignSelf: "flex-start" }}>
                Guardar documento
              </button>
            </form>
          </div>

          {/* ── Document list ─────────────────────────────────────────── */}
          <div className="card" style={{ overflowX: "auto" }}>
            <h2 style={{ marginTop: 0, fontSize: "1rem" }}>
              Documentos cargados
              <span style={{ marginLeft: 8, fontWeight: 400, color: "var(--muted)", fontSize: "0.85rem" }}>
                ({documentos.length})
              </span>
            </h2>

            {documentos.length === 0 ? (
              <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>No hay documentos cargados aún.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Tipo</th>
                    <th>Nombre</th>
                    <th>Emisión</th>
                    <th>Vencimiento</th>
                    <th>Archivo</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {documentos.map((doc) => {
                    const tipoLabel = TIPO_LABELS[doc.tipo] ?? doc.tipo;

                    let expiryBadge: React.ReactNode = null;
                    if (doc.fechaVencimiento) {
                      const daysRemaining = Math.ceil(
                        (doc.fechaVencimiento.getTime() - Date.now()) / 86400000
                      );
                      const [bg, color, text] =
                        daysRemaining <= 0
                          ? ["#fce9e8", "#9e2f23", `Vencido (${Math.abs(daysRemaining)}d)`]
                          : daysRemaining <= 7
                          ? ["#fce9e8", "#ef4444", `${daysRemaining}d restantes`]
                          : daysRemaining <= 30
                          ? ["#fff4dc", "#f97316", `${daysRemaining}d restantes`]
                          : daysRemaining <= 60
                          ? ["#fefce8", "#ca8a04", `${daysRemaining}d restantes`]
                          : ["#e8f7ef", "#16a34a", `${daysRemaining}d restantes`];
                      expiryBadge = (
                        <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: "0.78rem", fontWeight: 600, background: bg, color }}>
                          {text}
                        </span>
                      );
                    }

                    return (
                      <tr key={doc.id}>
                        <td>
                          <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: "0.78rem", fontWeight: 600, background: "rgba(0,168,191,0.1)", color: "var(--teal)", whiteSpace: "nowrap" }}>
                            {tipoLabel}
                          </span>
                        </td>
                        <td style={{ fontWeight: 500 }}>{doc.nombre}</td>
                        <td style={{ fontSize: "0.875rem", color: "var(--muted)" }}>
                          {doc.fechaEmision
                            ? doc.fechaEmision.toLocaleDateString("es-CL")
                            : "—"}
                        </td>
                        <td style={{ fontSize: "0.875rem" }}>
                          {doc.fechaVencimiento ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                              <span>{doc.fechaVencimiento.toLocaleDateString("es-CL")}</span>
                              {expiryBadge}
                            </div>
                          ) : (
                            <span style={{ color: "var(--muted)" }}>—</span>
                          )}
                        </td>
                        <td>
                          {doc.contenido ? (
                            <a
                              href={`/trabajadores/${params.id}/documentos/${doc.id}/download`}
                              style={{ color: "var(--teal)", fontWeight: 600, fontSize: "0.85rem", textDecoration: "none" }}
                            >
                              Descargar
                            </a>
                          ) : (
                            <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>Sin archivo</span>
                          )}
                        </td>
                        <td>
                          <form action={deleteDocumentoTrabajadorAction}>
                            <input type="hidden" name="docId" value={doc.id} />
                            <input type="hidden" name="staffMemberId" value={params.id} />
                            <button
                              type="submit"
                              className="btn secondary"
                              style={{ fontSize: "0.8rem", padding: "4px 10px", color: "#ef4444", borderColor: "#ef4444" }}
                            >
                              Eliminar
                            </button>
                          </form>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
