import Link from "next/link";
import { notFound } from "next/navigation";
import { ADMIN_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { updateCampAction, deleteCampAction } from "@/app/administracion/actions";

export default async function EditarCampamentoPage({ params }: { params: { id: string } }) {
  const user = await requireRole(ADMIN_ROLES);

  const camp = await db.camp.findUnique({
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
  });

  if (!camp) {
    notFound();
  }

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
            <div style={{ display: "flex", alignItems: "end" }}>
              <label className="admin-inline-checkbox">
                <input type="checkbox" name="isActive" defaultChecked={camp.isActive} style={{ width: "auto", padding: 0 }} />
                Activo
              </label>
            </div>
            <div style={{ display: "flex", alignItems: "end" }}>
              <button type="submit">Guardar cambios</button>
            </div>
          </form>
        </div>

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
      </div>
    </AppShell>
  );
}
