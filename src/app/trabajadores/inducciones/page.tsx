import Link from "next/link";
import { isAdminRole, OPERATION_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";

const estadoColor: Record<string, string> = {
  pendiente: "#94a3b8",
  en_progreso: "#f59e0b",
  completado: "#16a34a",
  reprobado: "#ef4444",
};
const estadoLabel: Record<string, string> = {
  pendiente: "Pendiente",
  en_progreso: "En progreso",
  completado: "Completado",
  reprobado: "Reprobado",
};

export default async function InduccionesPage({
  searchParams,
}: {
  searchParams?: { q?: string; estado?: string; cursoId?: string };
}) {
  const user = await requireRole(OPERATION_ROLES);
  const isAdmin = isAdminRole(user.role);
  const q = searchParams?.q?.trim() ?? "";
  const estadoFiltro = searchParams?.estado ?? "";
  const cursoFiltro = searchParams?.cursoId ?? "";

  const campFilter = isAdmin ? {} : { staffMember: { campId: user.campId ?? undefined } };

  const [inducciones, cursos, stats] = await Promise.all([
    db.induccionUsuario.findMany({
      where: {
        ...campFilter,
        ...(q ? { nombreTrabajador: { contains: q, mode: "insensitive" } } : {}),
        ...(estadoFiltro ? { estado: estadoFiltro } : {}),
        ...(cursoFiltro ? { cursoId: cursoFiltro } : {}),
      },
      orderBy: { createdAt: "desc" },
      include: { curso: { select: { titulo: true } }, staffMember: { select: { fullName: true, camp: { select: { name: true } } } } },
    }),
    db.curso.findMany({ where: { activo: true }, select: { id: true, titulo: true }, orderBy: { titulo: "asc" } }),
    db.induccionUsuario.groupBy({ by: ["estado"], where: campFilter, _count: true }),
  ]);

  return (
    <AppShell title="Inducciones y Capacitación" user={user} activeNav="trabajadores">
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "0.75rem" }}>
          {["pendiente", "en_progreso", "completado", "reprobado"].map((e) => {
            const count = stats.find((s) => s.estado === e)?._count ?? 0;
            return (
              <div key={e} className="card" style={{ padding: "0.75rem 1rem", borderTop: `3px solid ${estadoColor[e]}` }}>
                <div style={{ fontSize: "1.75rem", fontWeight: 700, color: estadoColor[e] }}>{count}</div>
                <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>{estadoLabel[e]}</div>
              </div>
            );
          })}
        </div>

        {/* Filtros */}
        <form method="GET" style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", marginBottom: 4, color: "var(--muted)" }}>Trabajador</label>
            <input name="q" defaultValue={q} placeholder="Buscar..." className="input" />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", marginBottom: 4, color: "var(--muted)" }}>Curso</label>
            <select name="cursoId" defaultValue={cursoFiltro} className="input">
              <option value="">Todos</option>
              {cursos.map((c) => <option key={c.id} value={c.id}>{c.titulo}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", marginBottom: 4, color: "var(--muted)" }}>Estado</label>
            <select name="estado" defaultValue={estadoFiltro} className="input">
              <option value="">Todos</option>
              <option value="pendiente">Pendiente</option>
              <option value="en_progreso">En progreso</option>
              <option value="completado">Completado</option>
              <option value="reprobado">Reprobado</option>
            </select>
          </div>
          <button type="submit" className="btn">Filtrar</button>
          <Link href="/trabajadores/inducciones" className="btn secondary">Limpiar</Link>
          <div style={{ display: "flex", gap: "0.5rem", marginLeft: "auto" }}>
            <Link href="/trabajadores/cursos" className="btn secondary">Gestionar cursos</Link>
            <Link href="/trabajadores/inducciones/nuevo" className="btn primary">+ Asignar inducción</Link>
          </div>
        </form>

        {/* Tabla */}
        <div className="card" style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Trabajador</th>
                <th>Curso</th>
                <th>Estado</th>
                <th>Puntaje</th>
                <th>Intentos</th>
                <th>Reglamento</th>
                <th>Fecha completado</th>
                {isAdmin && <th>Campamento</th>}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {inducciones.map((i) => (
                <tr key={i.id}>
                  <td style={{ fontWeight: 500 }}>{i.nombreTrabajador}</td>
                  <td style={{ fontSize: "0.875rem" }}>{i.curso.titulo}</td>
                  <td>
                    <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: "0.8rem", background: estadoColor[i.estado] + "20", color: estadoColor[i.estado], fontWeight: 600 }}>
                      {estadoLabel[i.estado]}
                    </span>
                  </td>
                  <td style={{ textAlign: "center" }}>{i.puntaje !== null ? `${i.puntaje}%` : "—"}</td>
                  <td style={{ textAlign: "center" }}>{i.intentos}</td>
                  <td style={{ textAlign: "center" }}>{i.reglamentoFirmado ? "✅" : "—"}</td>
                  <td style={{ fontSize: "0.875rem" }}>{i.fechaCompletado ? new Date(i.fechaCompletado).toLocaleDateString("es-CL") : "—"}</td>
                  {isAdmin && <td style={{ fontSize: "0.875rem" }}>{i.staffMember?.camp?.name ?? "—"}</td>}
                  <td><Link href={`/trabajadores/inducciones/${i.id}`} style={{ fontSize: "0.875rem" }}>Ver →</Link></td>
                </tr>
              ))}
              {inducciones.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--muted)", padding: "2rem" }}>No hay inducciones registradas.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
