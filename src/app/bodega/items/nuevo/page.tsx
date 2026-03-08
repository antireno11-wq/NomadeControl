import Link from "next/link";
import Image from "next/image";
import { isAdminRole, OPERATION_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { logoutAction } from "@/app/dashboard/actions";
import { OpsNav } from "@/components/ops-nav";
import { NewItemForm } from "./new-item-form";

export default async function NewBodegaItemPage() {
  const user = await requireRole(OPERATION_ROLES);
  const canSeeAdminSections = isAdminRole(user.role);
  const campFilter = !canSeeAdminSections ? user.campId ?? "__none__" : undefined;

  const [camps, categories] = await Promise.all([
    db.camp.findMany({
      where: {
        isActive: true,
        ...(campFilter ? { id: campFilter } : {})
      },
      orderBy: { name: "asc" }
    }),
    db.inventoryItem.findMany({
      where: {
        isActive: true,
        ...(campFilter
          ? {
              OR: [{ campId: null }, { campId: campFilter }]
            }
          : {})
      },
      distinct: ["category"],
      select: { category: true },
      orderBy: { category: "asc" }
    })
  ]);

  return (
    <main>
      <div className="header">
        <div>
          <div className="brand-inline">
            <Link href="/" aria-label="Ir al inicio">
              <Image src="/nomade-logo-v2.png" alt="Logo Nomade" width={120} height={120} priority />
            </Link>
          </div>
          <h1>Nuevo item de bodega</h1>
          <div style={{ color: "var(--muted)", fontSize: "0.92rem" }}>
            Sesion: {user.name} ({user.role})
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Link href="/bodega" className="menu-item">
            Volver a bodega
          </Link>
          <form action={logoutAction}>
            <button className="danger" type="submit">
              Cerrar sesion
            </button>
          </form>
        </div>
      </div>

      <OpsNav active="bodega" showAdminSections={canSeeAdminSections} showLoadSection={!canSeeAdminSections} />

      {camps.length === 0 ? (
        <div className="alert error">No hay campamento activo disponible.</div>
      ) : (
        <NewItemForm
          camps={camps.map((camp) => ({ id: camp.id, name: camp.name }))}
          categories={categories.map((row) => row.category)}
          defaultCampId={user.campId ?? camps[0].id}
          allowGlobal={canSeeAdminSections}
        />
      )}
    </main>
  );
}
