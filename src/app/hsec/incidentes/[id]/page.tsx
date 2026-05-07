import Link from "next/link";
import { isAdminRole, HSEC_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { notFound } from "next/navigation";
import { actualizarIncidenteAction } from "./actions";

const criticidadColor: Record<string, string> = {
  baja: "#16a34a", media: "#f59e0b", alta: "#f97316", critica: "#ef4444",
};

export default async function IncidenteDetallePage({ params, searchParams }: { params: { id: string }; searchParams?: { status?: string } }) {
  const user = await requireRole(HSEC_ROLES);
  const isAdmin = isAdminRole(user.role);

  const incidente = await db.incidente.findUnique({
    where: { id: params.id },
    include: {
      reportadoPor: { select: { name: true } },
      responsable: { select: { name: true } },
      camp: { select: { name: true } },
    },
  });

  if (!incidente) notFound();

  const usuarios = await db.user.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const msg = searchParams?.status === "created" ? "Incidente registrado correctamente." :
              searchParams?.status === "updated" ? "Incidente actualizado." : null;

  const estadoLabel: Record<string, string> = {
    abierto: "Abierto", en_investigacion: "En investigación", cerrado: "Cerrado",
  };

  return (
    <AppShell title="Detalle Incidente" user={user} activeNav="hsec">
      <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", maxWidth: 800 }}>

        {msg && <div className="alert success">{msg}</div>}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
          <div>
            <Link href="/hsec/incidentes" style={{ fontSize: "0.875rem", color: "var(--muted)" }}>← Volver a incidentes</Link>
            <h2 style={{ margin: "0.5rem 0 0.25rem" }}>{incidente.titulo}</h2>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <span style={{ padding: "2px 10px", borderRadius: 4, fontSize: "0.82rem", background: criticidadColor[incidente.criticidad] + "20", color: criticidadColor[incidente.criticidad], fontWeight: 600 }}>
                {incidente.criticidad.charAt(0).toUpperCase() + incidente.criticidad.slice(1)}
              </span>
              <span style={{ padding: "2px 10px", borderRadius: 4, fontSize: "0.82rem", background: "#e2e8f0", color: "#475569", fontWeight: 600 }}>
                {estadoLabel[incidente.estado]}
              </span>
              {incidente.incumplimientoLegal && (
                <span style={{ padding: "2px 10px", borderRadius: 4, fontSize: "0.82rem", background: "#fef3c7", color: "#92400e", fontWeight: 600 }}>
                  ⚠️ Incumplimiento legal
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Info principal */}
        <div className="card">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div><span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Fecha ocurrencia</span><div>{new Date(incidente.fechaOcurrencia).toLocaleString("es-CL")}</div></div>
            <div><span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Lugar</span><div>{incidente.lugar}</div></div>
            {incidente.area && <div><span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Área</span><div>{incidente.area}</div></div>}
            <div><span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Reportado por</span><div>{incidente.reportadoPor.name}</div></div>
            {incidente.responsable && <div><span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Responsable</span><div>{incidente.responsable.name}</div></div>}
            {incidente.camp && <div><span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Campamento</span><div>{incidente.camp.name}</div></div>}
          </div>
          <div style={{ marginTop: "1rem" }}>
            <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Descripción</span>
            <p style={{ margin: "0.25rem 0 0", whiteSpace: "pre-wrap" }}>{incidente.descripcion}</p>
          </div>
          {incidente.planAccion && (
            <div style={{ marginTop: "1rem" }}>
              <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Plan de acción</span>
              <p style={{ margin: "0.25rem 0 0", whiteSpace: "pre-wrap" }}>{incidente.planAccion}</p>
            </div>
          )}
        </div>

        {/* Formulario de actualización */}
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Actualizar incidente</h3>
          <form action={actualizarIncidenteAction} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <input type="hidden" name="id" value={incidente.id} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
              <div>
                <label className="label">Estado</label>
                <select name="estado" defaultValue={incidente.estado} className="input">
                  <option value="abierto">Abierto</option>
                  <option value="en_investigacion">En investigación</option>
                  <option value="cerrado">Cerrado</option>
                </select>
              </div>
              <div>
                <label className="label">Responsable</label>
                <select name="responsableId" defaultValue={incidente.responsableId ?? ""} className="input">
                  <option value="">Sin asignar</option>
                  {usuarios.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label className="label">Plan de acción</label>
                <textarea name="planAccion" defaultValue={incidente.planAccion ?? ""} className="input" rows={4} />
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button type="submit" className="btn primary">Guardar cambios</button>
            </div>
          </form>
        </div>
      </div>
    </AppShell>
  );
}
