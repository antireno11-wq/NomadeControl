import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireDdd, isAdminRole } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { formatDisplayDate } from "@/lib/report-utils";
import { etiquetaTipoReunion, fechaEfectiva } from "@/lib/ddd";
import { BotonesMinuta } from "./acciones-client";

export default async function MinutaPage({
  params, searchParams,
}: {
  params: { id: string };
  searchParams?: { status?: string };
}) {
  const user = await requireDdd();

  const reunion = await db.reunion.findUnique({
    where: { id: params.id },
    select: {
      id: true, tipo: true, fecha: true, semanaIso: true, anio: true,
      referencia: true, estado: true, resumen: true, participantes: true,
      publicadaPorNombre: true, publicadaEn: true, transcripcion: true,
      contrato: { select: { nombre: true, mandante: { select: { nombre: true } } } },
      compromisosOrigen: {
        select: {
          id: true, accion: true, responsable: true, oportunidad: true,
          fechaCierre: true, fecha2doCompromiso: true, observacion: true, estado: true,
        },
        orderBy: { fechaCierre: "asc" },
      },
      compromisosCierre: {
        select: { id: true, accion: true, responsable: true, fechaCierreReal: true },
      },
      amenazasOrigen: {
        select: { id: true, area: true, descripcion: true, responsable: true, fechaCierre: true },
        orderBy: { fechaCierre: "asc" },
      },
      rdps: {
        select: { id: true, problema: true, causaRaiz: true, accionCorrectiva: true, lider: true, fechaCierre: true },
      },
      reprogramaciones: {
        select: {
          id: true, fechaAnterior: true, fechaNueva: true, motivo: true,
          compromiso: { select: { accion: true, responsable: true } },
        },
      },
    },
  });
  if (!reunion) notFound();

  const titulo = reunion.referencia || `${etiquetaTipoReunion(reunion.tipo)} — Nómade Chile`;

  const seccion = (t: string) => (
    <h2 style={{ fontSize: "0.95rem", textTransform: "uppercase", letterSpacing: "0.05em",
                 color: "var(--muted)", borderBottom: "2px solid var(--border)",
                 paddingBottom: 6, marginTop: 28, marginBottom: 12 }}>{t}</h2>
  );

  return (
    <AppShell
      title="Minuta"
      user={user}
      activeNav="reuniones"
      showAdminSections={isAdminRole(user.role)}
      rightSlot={<Link href="/reuniones"><button type="button" className="secondary">← Reuniones</button></Link>}
    >
      <div className="page-stack">
        {searchParams?.status === "publicada" && (
          <div className="alert success no-imprimir">
            Minuta publicada. Los compromisos ya están vivos en el tablero.
          </div>
        )}

        <BotonesMinuta />

        <div className="card" id="minuta" style={{ padding: "28px 32px" }}>
          <div style={{ borderBottom: "3px solid var(--teal)", paddingBottom: 12, marginBottom: 18 }}>
            <h1 style={{ margin: 0, fontSize: "1.3rem" }}>{titulo}</h1>
            <div style={{ color: "var(--muted)", fontSize: "0.86rem", marginTop: 4 }}>
              {formatDisplayDate(reunion.fecha)} · Semana {reunion.semanaIso} del {reunion.anio}
              {reunion.contrato && ` · ${reunion.contrato.mandante.nombre} — ${reunion.contrato.nombre}`}
            </div>
            {reunion.participantes.length > 0 && (
              <div style={{ color: "var(--muted)", fontSize: "0.82rem", marginTop: 2 }}>
                Participantes: {reunion.participantes.join(", ")}
              </div>
            )}
          </div>

          {reunion.resumen && (
            <>
              {seccion("Resumen")}
              <p style={{ margin: 0, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{reunion.resumen}</p>
            </>
          )}

          {reunion.compromisosCierre.length > 0 && (
            <>
              {seccion(`Compromisos cerrados (${reunion.compromisosCierre.length})`)}
              <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
                {reunion.compromisosCierre.map(c => (
                  <li key={c.id}>
                    {c.accion} <span style={{ color: "var(--muted)" }}>— {c.responsable}
                    {c.fechaCierreReal && ` · cerrado ${formatDisplayDate(c.fechaCierreReal)}`}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {reunion.reprogramaciones.length > 0 && (
            <>
              {seccion(`Compromisos reprogramados (${reunion.reprogramaciones.length})`)}
              <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
                {reunion.reprogramaciones.map(r => (
                  <li key={r.id}>
                    {r.compromiso.accion} <span style={{ color: "var(--muted)" }}>
                      — {r.compromiso.responsable} · de {formatDisplayDate(r.fechaAnterior)} a {formatDisplayDate(r.fechaNueva)}
                      {r.motivo && ` · ${r.motivo}`}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {reunion.compromisosOrigen.length > 0 && (
            <>
              {seccion(`Compromisos nuevos (${reunion.compromisosOrigen.length})`)}
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <th style={{ textAlign: "left", padding: "6px 8px" }}>Acción</th>
                    <th style={{ textAlign: "left", padding: "6px 8px" }}>Responsable</th>
                    <th style={{ textAlign: "left", padding: "6px 8px" }}>Categoría</th>
                    <th style={{ textAlign: "left", padding: "6px 8px" }}>Cierre</th>
                  </tr>
                </thead>
                <tbody>
                  {reunion.compromisosOrigen.map(c => (
                    <tr key={c.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "6px 8px" }}>
                        {c.accion}
                        {c.observacion && <div style={{ color: "var(--muted)", fontSize: "0.78rem" }}>{c.observacion}</div>}
                      </td>
                      <td style={{ padding: "6px 8px" }}>{c.responsable}</td>
                      <td style={{ padding: "6px 8px", color: "var(--muted)" }}>{c.oportunidad}</td>
                      <td style={{ padding: "6px 8px" }}>{formatDisplayDate(fechaEfectiva(c))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {reunion.amenazasOrigen.length > 0 && (
            <>
              {seccion(`Amenazas (${reunion.amenazasOrigen.length})`)}
              <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
                {reunion.amenazasOrigen.map(a => (
                  <li key={a.id}>
                    <strong>{a.area}:</strong> {a.descripcion}{" "}
                    <span style={{ color: "var(--muted)" }}>— {a.responsable} · {formatDisplayDate(a.fechaCierre)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {reunion.rdps.length > 0 && (
            <>
              {seccion(`Resolución de problemas (${reunion.rdps.length})`)}
              {reunion.rdps.map(r => (
                <div key={r.id} style={{ marginBottom: 12 }}>
                  <div style={{ fontWeight: 600 }}>{r.problema}</div>
                  {r.causaRaiz && <div style={{ fontSize: "0.85rem" }}><em>Causa raíz:</em> {r.causaRaiz}</div>}
                  {r.accionCorrectiva && <div style={{ fontSize: "0.85rem" }}><em>Acción correctiva:</em> {r.accionCorrectiva}</div>}
                  <div style={{ color: "var(--muted)", fontSize: "0.82rem" }}>
                    {r.lider} · {formatDisplayDate(r.fechaCierre)}
                  </div>
                </div>
              ))}
            </>
          )}

          <div style={{ borderTop: "1px solid var(--border)", marginTop: 28, paddingTop: 10,
                        color: "var(--muted)", fontSize: "0.76rem" }}>
            {reunion.publicadaPorNombre && reunion.publicadaEn
              ? `Publicada por ${reunion.publicadaPorNombre} el ${formatDisplayDate(reunion.publicadaEn)}.`
              : "Borrador sin publicar."}
            {" "}Documento generado por Nomade Control.
          </div>
        </div>

        <details className="card no-imprimir">
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Transcripción original</summary>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: "0.8rem", color: "var(--muted)", marginTop: 12, fontFamily: "inherit" }}>
            {reunion.transcripcion}
          </pre>
        </details>
      </div>
    </AppShell>
  );
}
