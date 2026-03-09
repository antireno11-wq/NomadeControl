import Image from "next/image";
import Link from "next/link";
import { isAdminRole, OPERATION_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { toInputDateValue } from "@/lib/report-utils";
import { logoutAction } from "@/app/dashboard/actions";
import { OpsNav } from "@/components/ops-nav";
import { NotificationBell } from "@/components/notification-bell";
import { MovementForm } from "./movement-form";

export default async function BodegaPage() {
  const user = await requireRole(OPERATION_ROLES);
  const canSeeAdminSections = isAdminRole(user.role);
  const campFilter = !canSeeAdminSections ? user.campId ?? "__none__" : undefined;

  const [camps, inventoryItems, recentMovements] = await Promise.all([
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
      orderBy: [{ category: "asc" }, { name: "asc" }]
    }),
    db.stockMovement.findMany({
      where: campFilter ? { campId: campFilter } : undefined,
      take: 30,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      include: { camp: true, createdBy: true }
    })
  ]);

  const stockMap = new Map<string, { itemName: string; unit: string; stock: number }>();
  for (const row of recentMovements) {
    const key = `${row.campId}::${row.itemName.toLowerCase()}::${row.unit.toLowerCase()}`;
    const current = stockMap.get(key) ?? { itemName: row.itemName, unit: row.unit, stock: 0 };
    current.stock += row.movementType === "INGRESO" ? row.quantity : -row.quantity;
    stockMap.set(key, current);
  }

  const LOW_STOCK_THRESHOLD = 10;
  const lowStockRows = Array.from(stockMap.values()).filter((row) => row.stock <= LOW_STOCK_THRESHOLD);
  const notificationItems = lowStockRows.map((row) => ({
    text: `${row.itemName}: stock bajo (${row.stock.toFixed(2)} ${row.unit})`,
    severity: row.stock <= 0 ? ("error" as const) : ("warning" as const)
  }));

  return (
    <main>
      <div className="header">
        <div>
          <div className="brand-inline">
            <Link href="/" aria-label="Ir al inicio">
              <Image src="/nomade-logo-v2.png" alt="Logo Nomade" width={120} height={120} priority />
            </Link>
          </div>
          <h1>Bodega</h1>
          <div style={{ color: "var(--muted)", fontSize: "0.92rem" }}>
            Sesión: {user.name} ({user.role})
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Link href="/mi-perfil" className="menu-item">
            Mi perfil
          </Link>
          <NotificationBell items={notificationItems} />
          <form action={logoutAction}>
            <button className="danger" type="submit">
              Cerrar sesión
            </button>
          </form>
        </div>
      </div>

      <OpsNav active="bodega" showAdminSections={canSeeAdminSections} showLoadSection={!canSeeAdminSections} />

      {!canSeeAdminSections && !user.campId ? (
        <div className="alert error" style={{ marginBottom: 16 }}>
          Tu usuario supervisor no tiene campamento asignado. Pide al administrador que lo configure.
        </div>
      ) : null}

      {lowStockRows.length > 0 ? (
        <div className="alert error" style={{ marginBottom: 16 }}>
          Alertas de bodega: {lowStockRows.map((row) => `${row.itemName} (${row.stock.toFixed(2)} ${row.unit})`).join(", ")}
        </div>
      ) : null}

      <div className="grid two">
        {camps.length > 0 && inventoryItems.length > 0 ? (
          <MovementForm
            camps={camps.map((camp) => ({ id: camp.id, name: camp.name }))}
            inventoryItems={inventoryItems.map((item) => ({
              id: item.id,
              name: item.name,
              unit: item.unit,
              category: item.category
            }))}
            defaultDate={toInputDateValue(new Date())}
          />
        ) : (
          <div className="card">
            <div className="alert error">
              {camps.length === 0
                ? "No hay campamento disponible para registrar bodega."
                : "No hay items de inventario cargados todavia. Importa el inventario primero."}
            </div>
          </div>
        )}

        <div className="card" style={{ overflowX: "auto" }}>
          <h2 style={{ marginTop: 0 }}>Stock acumulado (últimos movimientos)</h2>
          <table>
            <thead>
              <tr>
                <th>Ítem</th>
                <th>Unidad</th>
                <th>Stock estimado</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {Array.from(stockMap.values()).map((row) => (
                <tr key={`${row.itemName}-${row.unit}`}>
                  <td>{row.itemName}</td>
                  <td>{row.unit}</td>
                  <td className={row.stock < 0 ? "warn" : ""}>{row.stock.toFixed(2)}</td>
                  <td className={row.stock <= LOW_STOCK_THRESHOLD ? "warn" : "up"}>
                    {row.stock <= 0 ? "CRITICO" : row.stock <= LOW_STOCK_THRESHOLD ? "BAJO" : "OK"}
                  </td>
                </tr>
              ))}
              {stockMap.size === 0 ? (
                <tr>
                  <td colSpan={4} style={{ color: "var(--muted)" }}>
                    Aún no hay movimientos registrados.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16, overflowX: "auto" }}>
        <h2 style={{ marginTop: 0 }}>Últimos movimientos</h2>
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Campamento</th>
              <th>Tipo</th>
              <th>Ítem</th>
              <th>Cantidad</th>
              <th>Unidad</th>
              <th>Usuario</th>
              <th>Notas</th>
            </tr>
          </thead>
          <tbody>
            {recentMovements.map((row) => (
              <tr key={row.id}>
                <td>{toInputDateValue(row.date)}</td>
                <td>{row.camp.name}</td>
                <td className={row.movementType === "SALIDA" ? "warn" : "up"}>{row.movementType}</td>
                <td>{row.itemName}</td>
                <td>{row.quantity.toFixed(2)}</td>
                <td>{row.unit}</td>
                <td>{row.createdBy.name}</td>
                <td>{row.notes ?? "-"}</td>
              </tr>
            ))}
            {recentMovements.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ color: "var(--muted)" }}>
                  Sin movimientos de bodega.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </main>
  );
}
