import { requireRole, OPERATION_ROLES, isAdminRole, isSupervisorRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { MovementForm } from "./movement-form";
import Link from "next/link";

export default async function BodegaPage() {
  const user = await requireRole(OPERATION_ROLES);

  const isAdmin = isAdminRole(user.role);
  const isSupervisor = isSupervisorRole(user.role);

  // Camps visible for this user
  const camps = await db.camp.findMany({
    where: { isActive: true, ...(isSupervisor && user.campId ? { id: user.campId } : {}) },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  // Inventory items available for this user
  const inventoryItems = await db.inventoryItem.findMany({
    where: {
      isActive: true,
      ...(isSupervisor && user.campId
        ? { OR: [{ campId: null }, { campId: user.campId }] }
        : {}),
    },
    orderBy: [{ category: "asc" }, { name: "asc" }],
    select: { id: true, name: true, unit: true, category: true },
  });

  // Recent movements (last 50)
  const movements = await db.stockMovement.findMany({
    where: isSupervisor && user.campId ? { campId: user.campId } : {},
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 50,
    include: { camp: { select: { name: true } }, createdBy: { select: { name: true } } },
  });

  // Build stock summary per item per camp
  const allMovements = await db.stockMovement.findMany({
    where: isSupervisor && user.campId ? { campId: user.campId } : {},
    select: { itemName: true, movementType: true, quantity: true, unit: true, campId: true },
  });

  const campNameMap: Record<string, string> = {};
  for (const c of camps) campNameMap[c.id] = c.name;

  const stockMap: Record<string, { itemName: string; unit: string; campName: string; stock: number }> = {};
  for (const m of allMovements) {
    const key = `${m.campId}|${m.itemName}|${m.unit}`;
    if (!stockMap[key]) {
      stockMap[key] = {
        itemName: m.itemName,
        unit: m.unit,
        campName: campNameMap[m.campId] ?? m.campId,
        stock: 0,
      };
    }
    if (m.movementType === "INGRESO") stockMap[key].stock += m.quantity;
    else stockMap[key].stock -= m.quantity;
  }

  const stockRows = Object.values(stockMap)
    .sort((a, b) => a.campName.localeCompare(b.campName, "es") || a.itemName.localeCompare(b.itemName, "es"))
    .filter((r) => r.stock !== 0);

  const today = new Date().toISOString().slice(0, 10);
  const totalIngresos = movements.filter((m) => m.movementType === "INGRESO").length;
  const totalSalidas = movements.filter((m) => m.movementType === "SALIDA").length;

  return (
    <AppShell title="Bodega" user={user} activeNav="trabajadores">
      <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", maxWidth: 1100 }}>

        {/* KPIs */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem" }}>
          <div className="card" style={{ textAlign: "center", padding: "1rem" }}>
            <div style={{ fontSize: "1.75rem", fontWeight: 700 }}>{inventoryItems.length}</div>
            <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Ítems en catálogo</div>
          </div>
          <div className="card" style={{ textAlign: "center", padding: "1rem" }}>
            <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#16a34a" }}>{totalIngresos}</div>
            <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Ingresos registrados</div>
          </div>
          <div className="card" style={{ textAlign: "center", padding: "1rem" }}>
            <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#dc2626" }}>{totalSalidas}</div>
            <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Salidas registradas</div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem", alignItems: "start" }}>

          {/* Movement form */}
          <MovementForm camps={camps} inventoryItems={inventoryItems} defaultDate={today} />

          {/* Stock summary */}
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>Stock actual</h3>
              {isAdmin && (
                <Link href="/bodega/items/nuevo" style={{ fontSize: "0.85rem" }}>+ Agregar ítem</Link>
              )}
            </div>
            {stockRows.length === 0 ? (
              <p style={{ padding: "1.5rem", color: "var(--muted)", textAlign: "center", margin: 0 }}>
                Sin movimientos registrados aún.
              </p>
            ) : (
              <div style={{ maxHeight: 400, overflowY: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                  <thead>
                    <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                      <th style={{ padding: "0.5rem 1rem", textAlign: "left", fontWeight: 600 }}>Ítem</th>
                      <th style={{ padding: "0.5rem 1rem", textAlign: "left", fontWeight: 600 }}>Campamento</th>
                      <th style={{ padding: "0.5rem 1rem", textAlign: "right", fontWeight: 600 }}>Stock neto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stockRows.map((r, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "0.5rem 1rem" }}>{r.itemName}</td>
                        <td style={{ padding: "0.5rem 1rem", color: "var(--muted)" }}>{r.campName}</td>
                        <td style={{ padding: "0.5rem 1rem", textAlign: "right", fontWeight: 600, color: r.stock < 0 ? "#dc2626" : "#166534" }}>
                          {r.stock % 1 === 0 ? r.stock : r.stock.toFixed(2)} {r.unit}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Recent movements table */}
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0 }}>Últimos movimientos</h3>
            <Link href="/bodega/items/nuevo" style={{ fontSize: "0.85rem" }}>Administrar catálogo →</Link>
          </div>
          {movements.length === 0 ? (
            <p style={{ padding: "1.5rem", color: "var(--muted)", textAlign: "center", margin: 0 }}>No hay movimientos aún.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                <thead>
                  <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                    <th style={{ padding: "0.5rem 1rem", textAlign: "left", fontWeight: 600 }}>Fecha</th>
                    <th style={{ padding: "0.5rem 1rem", textAlign: "left", fontWeight: 600 }}>Tipo</th>
                    <th style={{ padding: "0.5rem 1rem", textAlign: "left", fontWeight: 600 }}>Ítem</th>
                    <th style={{ padding: "0.5rem 1rem", textAlign: "left", fontWeight: 600 }}>Campamento</th>
                    <th style={{ padding: "0.5rem 1rem", textAlign: "right", fontWeight: 600 }}>Cantidad</th>
                    <th style={{ padding: "0.5rem 1rem", textAlign: "left", fontWeight: 600 }}>Registrado por</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map((m) => (
                    <tr key={m.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "0.5rem 1rem", whiteSpace: "nowrap" }}>
                        {new Date(m.date).toLocaleDateString("es-CL")}
                      </td>
                      <td style={{ padding: "0.5rem 1rem" }}>
                        <span style={{
                          fontSize: "0.75rem", padding: "2px 7px", borderRadius: 4,
                          background: m.movementType === "INGRESO" ? "#dcfce7" : "#fee2e2",
                          color: m.movementType === "INGRESO" ? "#166534" : "#991b1b",
                          fontWeight: 600,
                        }}>
                          {m.movementType}
                        </span>
                      </td>
                      <td style={{ padding: "0.5rem 1rem" }}>{m.itemName}</td>
                      <td style={{ padding: "0.5rem 1rem", color: "var(--muted)" }}>{m.camp?.name ?? "-"}</td>
                      <td style={{ padding: "0.5rem 1rem", textAlign: "right", fontWeight: 500 }}>
                        {m.quantity % 1 === 0 ? m.quantity : m.quantity.toFixed(2)} {m.unit}
                      </td>
                      <td style={{ padding: "0.5rem 1rem", color: "var(--muted)" }}>{m.createdBy?.name ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </AppShell>
  );
}
