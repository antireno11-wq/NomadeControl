import Link from "next/link";
import { ADMIN_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { VehicleForm } from "../vehicle-form";

export default async function NuevoVehiculoPage() {
  const user = await requireRole(ADMIN_ROLES);
  const [camps, projects] = await Promise.all([
    db.camp.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    db.project.findMany({ where: { isActive: true }, orderBy: { name: "asc" } })
  ]);

  return (
    <AppShell
      title="Nuevo vehículo"
      user={user}
      activeNav="vehiculos"
      showAdminSections
      rightSlot={
        <Link href="/vehiculos">
          <button type="button" className="secondary">Volver</button>
        </Link>
      }
    >
      <div className="page-stack">
        <div className="hero-panel">
          <span className="hero-kicker">Modulo Vehículos</span>
          <h2 style={{ margin: "0 0 8px" }}>Alta inicial de la flota</h2>
          <p className="section-caption" style={{ margin: 0 }}>
            Registra la ficha base del vehículo con campamento, kilometraje y vencimientos principales.
          </p>
        </div>

        <div className="card">
          <VehicleForm
            camps={camps.map((camp) => ({ id: camp.id, name: camp.name }))}
            projects={projects.map((project) => ({ id: project.id, name: project.name }))}
          />
        </div>
      </div>
    </AppShell>
  );
}
