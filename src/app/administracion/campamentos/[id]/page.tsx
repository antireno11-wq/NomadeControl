import Link from "next/link";
import { notFound } from "next/navigation";
import { ADMIN_ROLES, isFullAdminRole, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { deleteCampAction, updateCampAction, updateCampShiftAction, cerrarCampamentoAction, reabrirCampamentoAction } from "@/app/administracion/actions";

export default async function EditarCampamentoPage({
  params,
  searchParams
}: {
  params: { id: string };
  searchParams?: { shiftStatus?: string | string[] };
}) {
  const user = await requireRole(ADMIN_ROLES);
  const canDeleteData = isFullAdminRole(user.role);

  const [camp, supervisors] = await Promise.all([
    db.camp.findUnique({
      where: { id: params.id },
      include: {
        _count: {
          select: {
            users: true,
            reports: true,
            dailyTaskControls: true
          }
        }
      }
    }),
    db.user.findMany({
      where: {
        isActive: true,
        campId: params.id,
        role: { in: ["SUPERVISOR", "OPERADOR"] }
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true, shiftPattern: true, shiftStartDate: true }
    })
  ]);

  if (!camp) {
    notFound();
  }

  const shiftStatusRaw = searchParams?.shiftStatus;
  const shiftStatus = typeof shiftStatusRaw === "string" ? shiftStatusRaw : "";

  const workersCount = await db.staffMember.count({ where: { campId: params.id, isActive: true } });

  return (
    <AppShell
      title="Editar campamento"
      user={user}
      activeNav="administracion"
      showAdminSections
      rightSlot={
        <Link href="/administracion">
          <button type="button" className="secondary">Volver</button>
        </Link>
      }
    >
      <div className="page-stack">
        {shiftStatus === "updated" && <div className="alert success">Nuevo turno iniciado correctamente.</div>}
        {shiftStatus === "closed" && <div className="alert success">Campamento cerrado. Los trabajadores quedaron sin campamento asignado.</div>}

        {!camp.isActive && (
          <div style={{ padding: "12px 16px", borderRadius: 10, background: "#fef9c3", border: "1px solid #fde047", color: "#854d0e", fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
            <span>🔒 Campamento cerrado el {camp.closedAt ? new Date(camp.closedAt).toLocaleDateString("es-CL") : "—"} · Solo lectura</span>
            <form action={reabrirCampamentoAction}>
              <input type="hidden" name="campId" value={camp.id} />
              <button type="submit" style={{ background: "#854d0e", color: "#fff", border: "none", padding: "6px 16px", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: "0.85rem" }}>
                Reabrir campamento
              </button>
            </form>
          </div>
        )}

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Resumen</h2>
          <div className="summary-grid">
            <div className="metric">
              <div className="label">Usuarios</div>
              <div className="value">{camp._count.users}</div>
            </div>
            <div className="metric">
              <div className="label">Informes diarios</div>
              <div className="value">{camp._count.reports}</div>
            </div>
            <div className="metric">
              <div className="label">Controles tareas</div>
              <div className="value">{camp._count.dailyTaskControls}</div>
            </div>
            <div className="metric">
              <div className="label">Turno actual</div>
              <div className="value" style={{ fontSize: "1rem" }}>{camp.currentShiftSupervisorName ?? "Sin definir"}</div>
            </div>
          </div>
        </div>

        <div className="card" style={{ maxWidth: 760 }}>
          <h2 style={{ marginTop: 0 }}>Datos del campamento</h2>
          <form action={updateCampAction} className="grid two">
            <input type="hidden" name="campId" value={camp.id} />
            <div>
              <label htmlFor="camp-name-edit">Nombre</label>
              <input id="camp-name-edit" name="name" defaultValue={camp.name} required />
            </div>
            <div>
              <label htmlFor="camp-location-edit">Ubicación</label>
              <input id="camp-location-edit" name="location" defaultValue={camp.location ?? ""} />
            </div>
            <div>
              <label htmlFor="camp-capacity-edit">Capacidad de personas</label>
              <input id="camp-capacity-edit" name="capacityPeople" type="number" min={0} defaultValue={camp.capacityPeople} required />
            </div>
            <div>
              <label htmlFor="camp-potable-capacity-edit">Capacidad estanque agua potable (m3)</label>
              <input
                id="camp-potable-capacity-edit"
                name="potableWaterTankCapacityM3"
                type="number"
                min={0}
                step="0.1"
                defaultValue={camp.potableWaterTankCapacityM3 ?? ""}
              />
            </div>
            <div>
              <label htmlFor="camp-black-capacity-edit">Capacidad estanque aguas negras (m3)</label>
              <input
                id="camp-black-capacity-edit"
                name="blackWaterTankCapacityM3"
                type="number"
                min={0}
                step="0.1"
                defaultValue={camp.blackWaterTankCapacityM3 ?? ""}
              />
            </div>
            <div>
              <label htmlFor="camp-grey-capacity-edit">Capacidad estanque aguas grises (m3)</label>
              <input
                id="camp-grey-capacity-edit"
                name="greyWaterTankCapacityM3"
                type="number"
                min={0}
                step="0.1"
                defaultValue={camp.greyWaterTankCapacityM3 ?? ""}
              />
            </div>
            <div>
              <label htmlFor="camp-latitude-edit">Latitud</label>
              <input
                id="camp-latitude-edit"
                name="latitude"
                type="number"
                step="0.000001"
                defaultValue={camp.latitude ?? ""}
                placeholder="-22.334455"
              />
            </div>
            <div>
              <label htmlFor="camp-longitude-edit">Longitud</label>
              <input
                id="camp-longitude-edit"
                name="longitude"
                type="number"
                step="0.000001"
                defaultValue={camp.longitude ?? ""}
                placeholder="-68.778899"
              />
            </div>
            <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "end" }}>
              <button type="submit">Guardar cambios</button>
            </div>
          </form>
        </div>

        <div className="card" style={{ maxWidth: 760 }}>
          <h2 style={{ marginTop: 0 }}>Iniciar nuevo turno</h2>
          <div className="section-caption" style={{ marginBottom: 12 }}>
            Esto reinicia las estadísticas del turno actual para este campamento, sin borrar ningún dato histórico.
          </div>
          <form action={updateCampShiftAction} className="grid two">
            <input type="hidden" name="campId" value={camp.id} />
            <div>
              <label htmlFor="shift-supervisor">Supervisor que entra</label>
              <select
                id="shift-supervisor"
                name="supervisorId"
                defaultValue={camp.currentShiftSupervisorId ?? supervisors[0]?.id ?? ""}
                required
              >
                {supervisors.map((supervisor) => (
                  <option key={supervisor.id} value={supervisor.id}>
                    {supervisor.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="shift-pattern">Tipo de turno</label>
              <select id="shift-pattern" name="shiftPattern" defaultValue={camp.currentShiftPattern ?? "14x14"} required>
                <option value="14x14">14x14</option>
                <option value="10x10">10x10</option>
                <option value="7x7">7x7</option>
                <option value="4x3">4x3</option>
              </select>
            </div>
            <div>
              <label htmlFor="shift-start-date">Fecha de inicio</label>
              <input
                id="shift-start-date"
                name="shiftStartDate"
                type="date"
                defaultValue={camp.currentShiftStartDate ? camp.currentShiftStartDate.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)}
                required
              />
            </div>
            <div style={{ display: "flex", alignItems: "end" }}>
              <button type="submit">Iniciar nuevo turno</button>
            </div>
          </form>
          {supervisors.length === 0 ? <div className="alert error" style={{ marginTop: 12 }}>No hay supervisores activos asignados a este campamento.</div> : null}
        </div>

        {camp.isActive && (
          <div className="card" style={{ maxWidth: 760 }}>
            <h2 style={{ marginTop: 0 }}>Cerrar campamento</h2>
            <div className="section-caption" style={{ marginBottom: 12 }}>
              Al cerrar el campamento, los <strong>{workersCount}</strong> trabajador{workersCount !== 1 ? "es" : ""} activo{workersCount !== 1 ? "s" : ""} quedarán sin campamento asignado (siguen activos en la plataforma). Todo el historial se conserva y puede consultarse en Operaciones.
            </div>
            <form action={cerrarCampamentoAction}>
              <input type="hidden" name="campId" value={camp.id} />
              <button
                type="submit"
                style={{ background: "#92400e", color: "#fff", border: "none", padding: "8px 20px", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: "0.9rem" }}
              >
                Cerrar campamento{workersCount > 0 ? ` · ${workersCount} trabajador${workersCount !== 1 ? "es" : ""} serán desvinculados` : ""}
              </button>
            </form>
          </div>
        )}

        {canDeleteData ? (
          <div className="card" style={{ maxWidth: 760 }}>
            <h2 style={{ marginTop: 0 }}>Eliminar campamento</h2>
            <div className="section-caption" style={{ marginBottom: 12 }}>
              Solo se elimina si no tiene usuarios ni registros asociados.
            </div>
            <form action={deleteCampAction}>
              <input type="hidden" name="campId" value={camp.id} />
              <button type="submit" className="danger">Eliminar campamento</button>
            </form>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
