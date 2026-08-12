import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireDdd, isAdminRole } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { formatDisplayDate } from "@/lib/report-utils";
import { aInputDate, etiquetaTipoReunion, fechaEfectiva } from "@/lib/ddd";
import { getCategorias } from "@/lib/ddd-db";
import type { PropuestaMinuta } from "@/lib/minuta-extractor";
import { RevisionMinuta } from "./revision-client";
import { publicarReunionAction, reprocesarReunionAction } from "../actions";

export default async function RevisionReunionPage({
  params, searchParams,
}: {
  params: { id: string };
  searchParams?: { status?: string };
}) {
  const user = await requireDdd();
  const puedePublicar = isAdminRole(user.role);

  const reunion = await db.reunion.findUnique({
    where: { id: params.id },
    select: {
      id: true, tipo: true, fecha: true, semanaIso: true, referencia: true,
      estado: true, propuesta: true, transcripcion: true, modeloUsado: true,
      participantes: true,
    },
  });
  if (!reunion) notFound();
  if (reunion.estado === "publicada") redirect(`/reuniones/${reunion.id}/minuta`);

  const [categorias, abiertos] = await Promise.all([
    getCategorias(),
    db.compromiso.findMany({
      where: { estado: 0 },
      select: { id: true, accion: true, responsable: true, fechaCierre: true, fecha2doCompromiso: true },
    }),
  ]);

  const propuesta = (reunion.propuesta ?? {
    resumen: "", compromisos_nuevos: [], amenazas_nuevas: [], rdp_nuevos: [],
    gemba_nuevos: [], cierres: [], cierres_dudosos: [], reprogramaciones: [], fuera_de_alcance: [],
  }) as PropuestaMinuta;

  const sinPropuesta = (propuesta.compromisos_nuevos?.length ?? 0) === 0
    && (propuesta.amenazas_nuevas?.length ?? 0) === 0
    && !propuesta.resumen;

  return (
    <AppShell
      title={`${etiquetaTipoReunion(reunion.tipo)} · ${formatDisplayDate(reunion.fecha)}`}
      user={user}
      activeNav="reuniones"
      showAdminSections={puedePublicar}
      rightSlot={<Link href="/reuniones"><button type="button" className="secondary">← Reuniones</button></Link>}
    >
      <div className="page-stack">
        {searchParams?.status === "reprocesada" && (
          <div className="alert success">Se volvió a procesar la transcripción.</div>
        )}

        <div className="card" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <strong>Borrador</strong>
            <div style={{ color: "var(--muted)", fontSize: "0.82rem" }}>
              Semana {reunion.semanaIso}
              {reunion.referencia && ` · ${reunion.referencia}`}
              {reunion.participantes.length > 0 && ` · ${reunion.participantes.join(", ")}`}
            </div>
            <div style={{ color: "var(--muted)", fontSize: "0.76rem" }}>
              Nada está escrito todavía. Los registros se crean al publicar.
              {reunion.modeloUsado && ` · Extraído con ${reunion.modeloUsado}`}
            </div>
          </div>
          <form action={reprocesarReunionAction} style={{ marginLeft: "auto" }}>
            <input type="hidden" name="reunionId" value={reunion.id} />
            <button type="submit" className="secondary">Volver a procesar</button>
          </form>
        </div>

        {sinPropuesta && (
          <div className="alert error">
            La extracción no devolvió resultados. Puede ser que falte la variable OPENAI_API_KEY, o
            que la transcripción no tenga compromisos identificables. La transcripción quedó
            guardada: puedes volver a procesar o agregar los compromisos a mano.
          </div>
        )}

        <RevisionMinuta
          reunionId={reunion.id}
          inicial={propuesta}
          categorias={categorias.map(c => c.nombre)}
          abiertos={abiertos.map(a => ({
            id: a.id, accion: a.accion, responsable: a.responsable,
            vence: aInputDate(fechaEfectiva(a as never)),
          }))}
          puedePublicar={puedePublicar}
        />

        {puedePublicar && (
          <div className="card" style={{ display: "flex", justifyContent: "flex-end" }}>
            <form action={publicarReunionAction}>
              <input type="hidden" name="reunionId" value={reunion.id} />
              <button type="submit" style={{ padding: "10px 26px", fontSize: "0.95rem", fontWeight: 700 }}>
                Publicar minuta
              </button>
            </form>
          </div>
        )}

        <details className="card">
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Transcripción original</summary>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: "0.8rem", color: "var(--muted)", marginTop: 12, fontFamily: "inherit" }}>
            {reunion.transcripcion}
          </pre>
        </details>
      </div>
    </AppShell>
  );
}
