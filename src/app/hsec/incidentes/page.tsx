import Link from "next/link";
import { isAdminRole, HSEC_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";

const criticidadColor: Record<string, string> = {
  baja: "#16a34a", media: "#f59e0b", alta: "#f97316", critica: "#ef4444",
};
const estadoColor: Record<string, string> = {
  abierto: "#ef4444", en_investigacion: "#f59e0b", cerrado: "#16a34a",
};
const estadoLabel: Record<string, string> = {
  abierto: "Abierto", en_investigacion: "En investigación", cerrado: "Cerrado",
};

export default async function IncidentesPage({ searchParams }: { searchParams?: { q?: string; estado?: string; criticidad?: string } }) {
  const user = await requireRole(HSEC_ROLES);
  const isAdmin = isAdminRole(user.role);
  const q = searchParams?.q?.trim() ?? "";
  const estadoFiltro = searchParams?.estado ?? "";
  const criticidadFiltro = searchParams?.criticidad ?? "";

  const where: any = {
    ...(isAdmin ? {} : { campId: user.campId ?? undefined }),
    ...(q ? { OR: [{ titulo: { contains: q, mode: "insensitive" } }, { lugar: { contains: q, mode: "insensitive" } }] } : {}),
    ...(estadoFiltro ? { estado: estadoFiltro } : {}),
    ...(criticidadFiltro ? { criticidad: criticidadFiltro } : {}),
  };

  const incidentes = await db.incidente.findMany({
    where,
    orderBy: { fechaOcurrencia: "desc" },
    include: {
      reportadoPor: { select: { name: true } },
      responsable: { select: { name: true } },
      camp: { select: { name: true } },
    },
  });

  return (
    <AppShell title="Incidentes y Hallazgos" user={user} activeNav="hsec">
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>

        {/* Barra de filtros */}
        <form method="GET" style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", marginBottom: 4, color: "var(--muted)" }}>Buscar</label>
            <input name="q" defaultValue={q} placeholder="Título o lugar..." className="input" />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", marginBottom: 4, color: "var(--muted)" }}>Estado</label>
            <select name="estado" defaultValue={estadoFiltro} className="input">
              <option value="">Todos</option>
              <option value="abierto">Abierto</option>
              <option value="en_investigacion">En investigación</option>
              <option value="cerrado">Cerrado</option>
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", marginBottom: 4, color: "var(--muted)" }}>Criticidad</label>
            <select name="criticidad" defaultValue={criticidadFiltro} className="input">
              <option value="">Todas</option>
              <option value="baja">Baja</option>
              <option value="media">Media</option>
              <option value="alta">Alta</option>
              <option value="critica">Crítica</option>
            </select>
          </div>
          <button type="submit" className="btn">Filtrar</button>
          <Link href="/hsec/incidentes" className="btn secondary">Limpiar</Link>
          <Link href="/hsec/incidentes/nuevo" className="btn primary" style={{ marginLeft: "auto" }}>+ Nuevo incidente</Link>
        </form>

        {/* Tabla */}
        <div className="card" style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Título</th>
                <th>Lugar</th>
                <th>Fecha</th>
                <th>Criticidad</th>
                <th>Estado</th>
                <th>Legal</th>
                <th>Responsable</th>
                {isAdmin && <th>Campamento</th>}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {incidentes.map((i) => (
                <tr key={i.id}>
                  <td style={{ fontWeight: 500 }}>{i.titulo}</td>
                  <td style={{ color: "var(--muted)", fontSize: "0.875rem" }}>{i.lugar}</td>
                  <td style={{ fontSize: "0.875rem" }}>{new Date(i.fechaOcurrencia).toLocaleDateString("es-CL")}</td>
                  <td>
                    <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: "0.8rem", background: criticidadColor[i.criticidad] + "20", color: criticidadColor[i.criticidad], fontWeight: 600 }}>
                      {i.criticidad.charAt(0).toUpperCase() + i.criticidad.slice(1)}
                    </span>
                  </td>
                  <td>
                    <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: "0.8rem", background: estadoColor[i.estado] + "15", color: estadoColor[i.estado], fontWeight: 600 }}>
                      {estadoLabel[i.estado]}
                    </span>
                  </td>
                  <td style={{ fontSize: "0.875rem" }}>{i.incumplimientoLegal ? "⚠️ Sí" : "No"}</td>
                  <td style={{ fontSize: "0.875rem" }}>{i.responsable?.name ?? "—"}</td>
                  {isAdmin && <td style={{ fontSize: "0.875rem" }}>{i.camp?.name ?? "—"}</td>}
                  <td><Link href={`/hsec/incidentes/${i.id}`} style={{ fontSize: "0.875rem" }}>Ver →</Link></td>
                </tr>
              ))}
              {incidentes.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--muted)", padding: "2rem" }}>No hay incidentes que coincidan con los filtros.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
