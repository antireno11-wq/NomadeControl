import Link from "next/link";
import { requireRequerimientos } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { getCargos, getProyectos } from "@/lib/requisitos-db";
import { crearRequerimientoAction } from "../actions";
import { CamposSolicitud } from "../campos-solicitud";

const ALERTAS: Record<string, string> = {
  invalida: "Revisa los datos: cargo, vacantes, proyecto, fecha, turno y prioridad son obligatorios.",
  "fecha-pasada": "La fecha requerida ya pasó. Revisa el día y el año.",
};

export default async function NuevaSolicitudPage({ searchParams }: { searchParams?: { status?: string } }) {
  const { user, gerencia, rrhh } = await requireRequerimientos();
  const [cargos, proyectos] = await Promise.all([getCargos(), getProyectos()]);
  const error = ALERTAS[searchParams?.status ?? ""] ?? null;

  return (
    <AppShell title="Nueva solicitud de cargo" user={user} activeNav="requerimientos" showAdminSections={gerencia}
              rightSlot={<Link href="/requerimientos"><button type="button" className="secondary">Volver al tablero</button></Link>}>
      <div className="page-stack">
        {error && <div className="alert error">{error}</div>}
        <div className="card">
          <p style={{ color: "var(--muted)", fontSize: "0.88rem", margin: "0 0 1rem" }}>
            La solicitud queda a tu nombre, con la fecha de hoy.
            {rrhh ? " RRHH recibe un correo al enviarla." : " RRHH recibe un correo al enviarla y te avisa cuando cargue postulantes o cambie el estado."}
          </p>
          <form action={crearRequerimientoAction} className="grid two">
            <CamposSolicitud cargos={cargos} proyectos={proyectos} prefijo="nueva" />
            <div>
              <button type="submit">Enviar solicitud</button>
            </div>
          </form>
        </div>
      </div>
    </AppShell>
  );
}
