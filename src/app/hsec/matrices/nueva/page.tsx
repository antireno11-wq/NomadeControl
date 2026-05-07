import { isAdminRole, HSEC_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { crearMatrizAction } from "./actions";

export default async function NuevaMatrizPage() {
  const user = await requireRole(HSEC_ROLES);
  const isAdmin = isAdminRole(user.role);

  const [usuarios, campamentos] = await Promise.all([
    db.user.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    isAdmin ? db.camp.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
  ]);

  return (
    <AppShell title="Nueva Matriz de Riesgo" user={user} activeNav="hsec">
      <div className="card" style={{ maxWidth: 720 }}>
        <p style={{ margin: "0 0 1rem", fontSize: "0.875rem", color: "var(--muted)" }}>
          El nivel de riesgo se calcula automáticamente: <strong>Probabilidad × Impacto</strong> (1-5 cada uno).
          Score 1-5 = Bajo · 6-11 = Medio · 12-19 = Alto · 20-25 = Crítico
        </p>
        <form action={crearMatrizAction} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div style={{ gridColumn: "1 / -1" }}>
              <label className="label">Tarea / Actividad *</label>
              <input name="tarea" required className="input" placeholder="Ej: Trabajo en altura sobre 1.8m" />
            </div>

            <div>
              <label className="label">Área *</label>
              <input name="area" required className="input" placeholder="Ej: Mantención, Operaciones" />
            </div>

            <div>
              <label className="label">Peligro identificado *</label>
              <input name="peligro" required className="input" placeholder="Ej: Caída al vacío" />
            </div>

            <div>
              <label className="label">Probabilidad (1-5) *</label>
              <select name="probabilidad" required className="input">
                <option value="">Seleccionar...</option>
                <option value="1">1 - Muy poco probable</option>
                <option value="2">2 - Poco probable</option>
                <option value="3">3 - Posible</option>
                <option value="4">4 - Probable</option>
                <option value="5">5 - Casi seguro</option>
              </select>
            </div>

            <div>
              <label className="label">Impacto (1-5) *</label>
              <select name="impacto" required className="input">
                <option value="">Seleccionar...</option>
                <option value="1">1 - Insignificante</option>
                <option value="2">2 - Menor</option>
                <option value="3">3 - Moderado</option>
                <option value="4">4 - Mayor</option>
                <option value="5">5 - Catastrófico</option>
              </select>
            </div>

            <div style={{ gridColumn: "1 / -1" }}>
              <label className="label">Medidas de control</label>
              <textarea name="medidasControl" className="input" rows={3} placeholder="Descripción de las medidas preventivas y correctivas..." />
            </div>

            <div>
              <label className="label">Responsable *</label>
              <select name="responsableId" required className="input">
                <option value="">Seleccionar...</option>
                {usuarios.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>

            <div>
              <label className="label">Fecha de revisión</label>
              <input name="fechaRevision" type="date" className="input" />
            </div>

            {isAdmin && campamentos.length > 0 && (
              <div>
                <label className="label">Campamento</label>
                <select name="campId" className="input">
                  <option value="">Sin asignar</option>
                  {campamentos.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
          </div>

          {!isAdmin && user.campId && <input type="hidden" name="campId" value={user.campId} />}

          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
            <a href="/hsec/matrices" className="btn secondary">Cancelar</a>
            <button type="submit" className="btn primary">Guardar matriz</button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
