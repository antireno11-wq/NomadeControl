import Link from "next/link";
import { isAdminRole, TRABAJADORES_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";

export default async function EPPPage({ searchParams }: { searchParams?: { q?: string; vencido?: string } }) {
  const user = await requireRole(TRABAJADORES_ROLES);
  const isAdmin = isAdminRole(user.role);
  const q = searchParams?.q?.trim() ?? "";
  const soloVencidos = searchParams?.vencido === "1";

  const hoy = new Date();
  const campFilter = isAdmin ? {} : { campId: user.campId ?? undefined };

  const where: any = {
    ...campFilter,
    ...(q ? { nombreTrabajador: { contains: q, mode: "insensitive" } } : {}),
    ...(soloVencidos ? { fechaVencimiento: { lt: hoy } } : {}),
  };

  const [entregas, porVencer, vencidos] = await Promise.all([
    db.entregaEPP.findMany({
      where,
      orderBy: { fechaVencimiento: "asc" },
      include: {
        tipoEpp: { select: { nombre: true } },
        entregadoPor: { select: { name: true } },
        camp: { select: { name: true } },
      },
    }),
    db.entregaEPP.count({ where: { ...campFilter, fechaVencimiento: { gte: hoy, lte: new Date(hoy.getTime() + 30 * 86400000) } } }),
    db.entregaEPP.count({ where: { ...campFilter, fechaVencimiento: { lt: hoy } } }),
  ]);

  return (
    <AppShell title="Control de EPP" user={user} activeNav="trabajadores">
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.75rem" }}>
          <div className="card" style={{ padding: "0.75rem 1rem", borderTop: "3px solid #ef4444" }}>
            <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#ef4444" }}>{vencidos}</div>
            <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>EPP vencidos</div>
          </div>
          <div className="card" style={{ padding: "0.75rem 1rem", borderTop: "3px solid #f97316" }}>
            <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#f97316" }}>{porVencer}</div>
            <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Por vencer (30 días)</div>
          </div>
          <div className="card" style={{ padding: "0.75rem 1rem", borderTop: "3px solid #64748b" }}>
            <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#64748b" }}>{entregas.length}</div>
            <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Entregas filtradas</div>
          </div>
        </div>

        {/* Filtros */}
        <form method="GET" style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", marginBottom: 4, color: "var(--muted)" }}>Trabajador</label>
            <input name="q" defaultValue={q} placeholder="Buscar..." className="input" />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 2 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: "0.875rem" }}>
              <input name="vencido" type="checkbox" value="1" defaultChecked={soloVencidos} />
              Solo vencidos
            </label>
          </div>
          <button type="submit" className="btn">Filtrar</button>
          <Link href="/trabajadores/epp" className="btn secondary">Limpiar</Link>
          <div style={{ display: "flex", gap: "0.5rem", marginLeft: "auto" }}>
            {isAdmin && <Link href="/trabajadores/epp/tipos" className="btn secondary">Tipos de EPP</Link>}
            <Link href="/trabajadores/epp/nuevo" className="btn primary">+ Registrar entrega</Link>
          </div>
        </form>

        {/* Tabla */}
        <div className="card" style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Trabajador</th>
                <th>EPP</th>
                <th>Cantidad</th>
                <th>Fecha entrega</th>
                <th>Vencimiento</th>
                <th>Estado</th>
                <th>Entregado por</th>
                {isAdmin && <th>Campamento</th>}
              </tr>
            </thead>
            <tbody>
              {entregas.map((e) => {
                const vence = new Date(e.fechaVencimiento);
                const diasRestantes = Math.ceil((vence.getTime() - hoy.getTime()) / 86400000);
                const estadoColor = diasRestantes < 0 ? "#ef4444" : diasRestantes <= 30 ? "#f97316" : "#16a34a";
                const estadoText = diasRestantes < 0 ? `Venció hace ${Math.abs(diasRestantes)}d` : diasRestantes === 0 ? "Vence hoy" : `${diasRestantes}d restantes`;
                return (
                  <tr key={e.id}>
                    <td style={{ fontWeight: 500 }}>{e.nombreTrabajador}</td>
                    <td>{e.tipoEpp.nombre}</td>
                    <td style={{ textAlign: "center" }}>{e.cantidad}</td>
                    <td style={{ fontSize: "0.875rem" }}>{new Date(e.fechaEntrega).toLocaleDateString("es-CL")}</td>
                    <td style={{ fontSize: "0.875rem" }}>{vence.toLocaleDateString("es-CL")}</td>
                    <td>
                      <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: "0.8rem", background: estadoColor + "20", color: estadoColor, fontWeight: 600 }}>
                        {estadoText}
                      </span>
                    </td>
                    <td style={{ fontSize: "0.875rem" }}>{e.entregadoPor.name}</td>
                    {isAdmin && <td style={{ fontSize: "0.875rem" }}>{e.camp?.name ?? "—"}</td>}
                  </tr>
                );
              })}
              {entregas.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--muted)", padding: "2rem" }}>No hay entregas registradas.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
