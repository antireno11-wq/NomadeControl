import { requireRole, OPERATION_ROLES, isAdminRole, isSupervisorRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { NewItemForm } from "./new-item-form";
import Link from "next/link";

export default async function NewBodegaItemPage() {
  const user = await requireRole(OPERATION_ROLES);

  const isAdmin = isAdminRole(user.role);
  const isSupervisor = isSupervisorRole(user.role);

  const camps = await db.camp.findMany({
    where: { isActive: true, ...(isSupervisor && user.campId ? { id: user.campId } : {}) },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const existingCategories = await db.inventoryItem.findMany({
    where: { isActive: true },
    select: { category: true },
    distinct: ["category"],
    orderBy: { category: "asc" },
  });

  const categories = existingCategories.map((c) => c.category).filter(Boolean);

  const defaultCampId = isSupervisor && user.campId ? user.campId : (camps[0]?.id ?? "");

  // List all active items for the catalog view
  const allItems = await db.inventoryItem.findMany({
    where: {
      isActive: true,
      ...(isSupervisor && user.campId
        ? { OR: [{ campId: null }, { campId: user.campId }] }
        : {}),
    },
    orderBy: [{ category: "asc" }, { name: "asc" }],
    include: { camp: { select: { name: true } } },
  });

  return (
    <AppShell title="Catálogo de bodega" user={user} activeNav="trabajadores">
      <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", maxWidth: 1000 }}>

        <div>
          <Link href="/bodega" style={{ fontSize: "0.875rem", color: "var(--muted)" }}>← Volver a Bodega</Link>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem", alignItems: "start" }}>

          {/* Create form */}
          <NewItemForm
            camps={camps}
            categories={categories}
            defaultCampId={defaultCampId}
            allowGlobal={isAdmin}
          />

          {/* Items list */}
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #e2e8f0" }}>
              <h3 style={{ margin: 0 }}>Ítems registrados ({allItems.length})</h3>
            </div>
            {allItems.length === 0 ? (
              <p style={{ padding: "1.5rem", color: "var(--muted)", textAlign: "center", margin: 0 }}>No hay ítems aún.</p>
            ) : (
              <div style={{ maxHeight: 500, overflowY: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                  <thead>
                    <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                      <th style={{ padding: "0.5rem 1rem", textAlign: "left", fontWeight: 600 }}>Nombre</th>
                      <th style={{ padding: "0.5rem 1rem", textAlign: "left", fontWeight: 600 }}>Categoría</th>
                      <th style={{ padding: "0.5rem 1rem", textAlign: "left", fontWeight: 600 }}>Unidad</th>
                      <th style={{ padding: "0.5rem 1rem", textAlign: "left", fontWeight: 600 }}>Campamento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allItems.map((item) => (
                      <tr key={item.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "0.5rem 1rem" }}>{item.name}</td>
                        <td style={{ padding: "0.5rem 1rem", color: "var(--muted)" }}>{item.category}</td>
                        <td style={{ padding: "0.5rem 1rem" }}>{item.unit}</td>
                        <td style={{ padding: "0.5rem 1rem", color: "var(--muted)" }}>
                          {item.camp?.name ?? <span style={{ fontStyle: "italic" }}>General</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        </div>
      </div>
    </AppShell>
  );
}
