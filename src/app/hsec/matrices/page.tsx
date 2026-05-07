import Link from "next/link";
import { isAdminRole, HSEC_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";

const nivelColor: Record<string, string> = {
  bajo: "#16a34a", medio: "#f59e0b", alto: "#f97316", critico: "#ef4444",
};

function calcularNivel(prob: number, impacto: number): string {
  const score = prob * impacto;
  if (score >= 20) return "critico";
  if (score >= 12) return "alto";
  if (score >= 6) return "medio";
  return "bajo";
}

export default async function MatricesPage({ searchParams }: { searchParams?: { nivel?: string; area?: string } }) {
  const user = await requireRole(HSEC_ROLES);
  const isAdmin = isAdminRole(user.role);
  const nivelFiltro = searchParams?.nivel ?? "";
  const areaFiltro = searchParams?.area?.trim() ?? "";

  const where: any = {
    ...(isAdmin ? {} : { campId: user.campId ?? undefined }),
    ...(nivelFiltro ? { nivelRiesgo: nivelFiltro } : {}),
    ...(areaFiltro ? { area: { contains: areaFiltro, mode: "insensitive" } } : {}),
  };

  const matrices = await db.matrizRiesgo.findMany({
    where,
    orderBy: [{ probabilidad: "desc" }, { impacto: "desc" }],
    include: {
      responsable: { select: { name: true } },
      camp: { select: { name: true } },
    },
  });

  return (
    <AppShell title="Matrices de Riesgo" user={user} activeNav="hsec">
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>

        <form method="GET" style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", marginBottom: 4, color: "var(--muted)" }}>Área</label>
            <input name="area" defaultValue={areaFiltro} placeholder="Filtrar por área..." className="input" />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", marginBottom: 4, color: "var(--muted)" }}>Nivel de riesgo</label>
            <select name="nivel" defaultValue={nivelFiltro} className="input">
              <option value="">Todos</option>
              <option value="bajo">Bajo</option>
              <option value="medio">Medio</option>
              <option value="alto">Alto</option>
              <option value="critico">Crítico</option>
            </select>
          </div>
          <button type="submit" className="btn">Filtrar</button>
          <Link href="/hsec/matrices" className="btn secondary">Limpiar</Link>
          <Link href="/hsec/matrices/nueva" className="btn primary" style={{ marginLeft: "auto" }}>+ Nueva matriz</Link>
        </form>

        <div className="card" style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Tarea / Actividad</th>
                <th>Área</th>
                <th>Peligro</th>
                <th>Prob.</th>
                <th>Impacto</th>
                <th>Nivel</th>
                <th>Medidas de control</th>
                <th>Responsable</th>
                {isAdmin && <th>Campamento</th>}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {matrices.map((m) => (
                <tr key={m.id}>
                  <td style={{ fontWeight: 500 }}>{m.tarea}</td>
                  <td style={{ fontSize: "0.875rem" }}>{m.area}</td>
                  <td style={{ fontSize: "0.875rem", color: "var(--muted)" }}>{m.peligro}</td>
                  <td style={{ textAlign: "center", fontWeight: 600 }}>{m.probabilidad}</td>
                  <td style={{ textAlign: "center", fontWeight: 600 }}>{m.impacto}</td>
                  <td>
                    <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: "0.8rem", background: nivelColor[m.nivelRiesgo] + "20", color: nivelColor[m.nivelRiesgo], fontWeight: 600 }}>
                      {m.nivelRiesgo.charAt(0).toUpperCase() + m.nivelRiesgo.slice(1)}
                    </span>
                  </td>
                  <td style={{ fontSize: "0.875rem", maxWidth: 200 }}>{m.medidasControl ?? "—"}</td>
                  <td style={{ fontSize: "0.875rem" }}>{m.responsable.name}</td>
                  {isAdmin && <td style={{ fontSize: "0.875rem" }}>{m.camp?.name ?? "—"}</td>}
                  <td><Link href={`/hsec/matrices/${m.id}`} style={{ fontSize: "0.875rem" }}>Ver →</Link></td>
                </tr>
              ))}
              {matrices.length === 0 && (
                <tr><td colSpan={10} style={{ textAlign: "center", color: "var(--muted)", padding: "2rem" }}>No hay matrices registradas.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
