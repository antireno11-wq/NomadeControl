import { isAdminRole, TRABAJADORES_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { registrarEntregaEPPAction } from "./actions";

export default async function NuevaEntregaEPPPage() {
  const user = await requireRole(TRABAJADORES_ROLES);
  const isAdmin = isAdminRole(user.role);

  const campFilter = isAdmin ? { isActive: true } : { isActive: true, campId: user.campId ?? undefined };

  const [trabajadores, tiposEPP, campamentos] = await Promise.all([
    db.staffMember.findMany({ where: campFilter, select: { id: true, fullName: true, camp: { select: { name: true } } }, orderBy: { fullName: "asc" } }),
    db.tipoEPP.findMany({ where: { isActive: true }, orderBy: { nombre: "asc" } }),
    isAdmin ? db.camp.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
  ]);

  const hoy = new Date().toISOString().split("T")[0];

  return (
    <AppShell title="Registrar Entrega EPP" user={user} activeNav="trabajadores">
      <div className="card" style={{ maxWidth: 640 }}>
        {tiposEPP.length === 0 && (
          <div style={{ padding: "0.75rem 1rem", borderRadius: 8, background: "#fef3c7", color: "#92400e", marginBottom: "1rem", fontSize: "0.875rem" }}>
            No hay tipos de EPP configurados. Pide al administrador que los agregue.
          </div>
        )}
        <form action={registrarEntregaEPPAction} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div style={{ gridColumn: "1 / -1" }}>
              <label className="label">Trabajador *</label>
              <select name="staffMemberId" required className="input">
                <option value="">Seleccionar trabajador...</option>
                {trabajadores.map((t) => <option key={t.id} value={t.id}>{t.fullName} — {t.camp?.name ?? "Sin asignar"}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Tipo de EPP *</label>
              <select name="tipoEppId" required className="input">
                <option value="">Seleccionar EPP...</option>
                {tiposEPP.map((t) => <option key={t.id} value={t.id}>{t.nombre} ({t.vigenciaDias}d vigencia)</option>)}
              </select>
            </div>
            <div>
              <label className="label">Cantidad</label>
              <input name="cantidad" type="number" min="1" defaultValue="1" required className="input" />
            </div>
            <div>
              <label className="label">Fecha de entrega *</label>
              <input name="fechaEntrega" type="date" defaultValue={hoy} required className="input" />
            </div>
            <div>
              <label className="label">Fecha de vencimiento *</label>
              <input name="fechaVencimiento" type="date" required className="input" />
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
            <div style={{ gridColumn: "1 / -1" }}>
              <label className="label">Observaciones</label>
              <textarea name="observaciones" className="input" rows={3} placeholder="Talla, condición, número de serie..." />
            </div>
          </div>

          <input type="hidden" name="entregadoPorId" value={user.id} />
          {!isAdmin && user.campId && <input type="hidden" name="campId" value={user.campId} />}

          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
            <a href="/trabajadores/epp" className="btn secondary">Cancelar</a>
            <button type="submit" className="btn primary">Registrar entrega</button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
