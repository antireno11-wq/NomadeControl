import Image from "next/image";
import Link from "next/link";
import { OPERATION_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { logoutAction } from "@/app/dashboard/actions";
import { OpsNav } from "@/components/ops-nav";

export default async function BodegaPage() {
  const user = await requireRole(OPERATION_ROLES);
  const camps = await db.camp.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });

  const stockRows = camps.map((camp, index) => ({
    campName: camp.name,
    botellasAgua: 150 - index * 12,
    kitsAseo: 40 - index * 3,
    cilindrosGas: 16 - index,
    estado: index % 2 === 0 ? "Normal" : "Reponer pronto"
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
          <form action={logoutAction}>
            <button className="danger" type="submit">
              Cerrar sesión
            </button>
          </form>
        </div>
      </div>

      <OpsNav active="bodega" />

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Control de stock por campamento</h2>
        <p style={{ color: "var(--muted)", margin: 0 }}>
          Esta vista está preparada para el flujo de inventario diario. En el siguiente paso se puede agregar ingreso y egreso real por ítem.
        </p>
      </div>

      <div className="card" style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Campamento</th>
              <th>Botellas de agua</th>
              <th>Kits de aseo</th>
              <th>Cilindros de gas</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {stockRows.map((row) => (
              <tr key={row.campName}>
                <td>{row.campName}</td>
                <td>{row.botellasAgua}</td>
                <td>{row.kitsAseo}</td>
                <td>{row.cilindrosGas}</td>
                <td className={row.estado === "Reponer pronto" ? "down" : "up"}>{row.estado}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
