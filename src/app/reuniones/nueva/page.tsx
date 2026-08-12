import Link from "next/link";
import { requireDdd, isAdminRole } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { getProyectos } from "@/lib/requisitos-db";
import { TIPOS_REUNION, aInputDate } from "@/lib/ddd";
import { crearReunionAction } from "../actions";

export default async function NuevaReunionPage({
  searchParams,
}: {
  searchParams?: { status?: string };
}) {
  const user = await requireDdd();
  const proyectos = await getProyectos();

  return (
    <AppShell
      title="Nueva reunión"
      user={user}
      activeNav="reuniones"
      showAdminSections={isAdminRole(user.role)}
      rightSlot={<Link href="/reuniones"><button type="button" className="secondary">← Reuniones</button></Link>}
    >
      <div className="page-stack">
        {searchParams?.status === "corta" && (
          <div className="alert error">La transcripción es muy corta. Pega el texto completo de la reunión.</div>
        )}

        <div className="card">
          <form action={crearReunionAction} className="page-stack" style={{ gap: "1rem" }}>
            <div className="grid two">
              <div>
                <label htmlFor="r-tipo">Tipo de reunión</label>
                <select id="r-tipo" name="tipo" defaultValue="daily">
                  {TIPOS_REUNION.map(t => <option key={t.valor} value={t.valor}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="r-fecha">Fecha de la reunión</label>
                <input id="r-fecha" name="fecha" type="date" required defaultValue={aInputDate(new Date())} />
                <span style={{ color: "var(--muted)", fontSize: "0.76rem" }}>
                  La de la reunión, no la de hoy. De acá se resuelven «mañana» y «el jueves».
                </span>
              </div>
              <div>
                <label htmlFor="r-ref">Referencia</label>
                <input id="r-ref" name="referencia" placeholder="DAILY DE OPERACIONES — NÓMADE CHILE" />
              </div>
              <div>
                <label htmlFor="r-contrato">Contrato</label>
                <select id="r-contrato" name="contratoId" defaultValue="">
                  <option value="">Sin contrato específico</option>
                  {proyectos.filter(p => p.ambito !== "interno").map(p => (
                    <option key={p.id} value={p.id}>{p.mandanteNombre} — {p.nombre}</option>
                  ))}
                </select>
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label htmlFor="r-part">Participantes</label>
                <input id="r-part" name="participantes" placeholder="Rody Olivares, Cristian Sandoval, Manuel Candia" />
                <span style={{ color: "var(--muted)", fontSize: "0.76rem" }}>
                  Separados por coma. Ayudan a asignar bien los responsables.
                </span>
              </div>
            </div>

            <div>
              <label htmlFor="r-trans">Transcripción</label>
              <textarea
                id="r-trans" name="transcripcion" required rows={18}
                placeholder="Pega acá la transcripción completa de la reunión…"
                style={{ width: "100%", fontFamily: "inherit", fontSize: "0.88rem", lineHeight: 1.5 }}
              />
              <span style={{ color: "var(--muted)", fontSize: "0.76rem" }}>
                Se guarda tal cual, aunque después edites la minuta: es la fuente. No hace falta
                limpiarla — el extractor está hecho para texto de reconocimiento de voz.
              </span>
            </div>

            <div>
              <button type="submit">Procesar</button>
              <span style={{ color: "var(--muted)", fontSize: "0.8rem", marginLeft: 12 }}>
                Tarda entre 20 y 60 segundos. Nada se escribe hasta que revises y publiques.
              </span>
            </div>
          </form>
        </div>
      </div>
    </AppShell>
  );
}
