import { isAdminRole, HSEC_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { crearIncidenteAction } from "./actions";

export default async function NuevoIncidentePage() {
  const user = await requireRole(HSEC_ROLES);
  const isAdmin = isAdminRole(user.role);

  const [usuarios, campamentos] = await Promise.all([
    db.user.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    isAdmin ? db.camp.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
  ]);

  return (
    <AppShell title="Registrar Incidente" user={user} activeNav="hsec">
      <div className="card" style={{ maxWidth: 720 }}>
        <form action={crearIncidenteAction} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div style={{ gridColumn: "1 / -1" }}>
              <label className="label">Título del incidente *</label>
              <input name="titulo" required className="input" placeholder="Ej: Caída de trabajador en altura" />
            </div>

            <div style={{ gridColumn: "1 / -1" }}>
              <label className="label">Descripción *</label>
              <textarea name="descripcion" required className="input" rows={4} placeholder="Describe lo ocurrido con detalle..." />
            </div>

            <div>
              <label className="label">Fecha de ocurrencia *</label>
              <input name="fechaOcurrencia" type="datetime-local" required className="input" />
            </div>

            <div>
              <label className="label">Lugar *</label>
              <input name="lugar" required className="input" placeholder="Ej: Área de bodega, Piso 2" />
            </div>

            <div>
              <label className="label">Área</label>
              <input name="area" className="input" placeholder="Ej: Operaciones, Mantención" />
            </div>

            <div>
              <label className="label">Criticidad *</label>
              <select name="criticidad" required className="input">
                <option value="">Seleccionar...</option>
                <option value="baja">Baja</option>
                <option value="media">Media</option>
                <option value="alta">Alta</option>
                <option value="critica">Crítica</option>
              </select>
            </div>

            <div>
              <label className="label">Responsable de investigación</label>
              <select name="responsableId" className="input">
                <option value="">Sin asignar</option>
                {usuarios.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>

            {isAdmin && campamentos.length > 0 && (
              <div>
                <label className="label">Campamento</label>
                <select name="campId" className="input">
                  <option value="">Sin asignar</option>
                  {campamentos.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div style={{ gridColumn: "1 / -1" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input name="incumplimientoLegal" type="checkbox" value="true" />
                <span>Involucra incumplimiento legal</span>
              </label>
            </div>

            <div style={{ gridColumn: "1 / -1" }}>
              <label className="label">Plan de acción inicial</label>
              <textarea name="planAccion" className="input" rows={3} placeholder="Medidas inmediatas tomadas o a tomar..." />
            </div>
          </div>

          <input type="hidden" name="reportadoPorId" value={user.id} />
          {!isAdmin && user.campId && <input type="hidden" name="campId" value={user.campId} />}

          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
            <a href="/hsec/incidentes" className="btn secondary">Cancelar</a>
            <button type="submit" className="btn primary">Registrar incidente</button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
