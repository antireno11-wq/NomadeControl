import Link from "next/link";
import { isAdminRole, HSEC_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";

const criticidadColor: Record<string, string> = {
  baja: "#16a34a", media: "#f59e0b", alta: "#f97316", critica: "#ef4444",
};

const estadoLabel: Record<string, string> = {
  abierto: "Abierto", en_investigacion: "En investigación", cerrado: "Cerrado",
};

export default async function HsecPage() {
  const user = await requireRole(HSEC_ROLES);
  const isAdmin = isAdminRole(user.role);
  const campFilter = isAdmin ? {} : { campId: user.campId ?? undefined };

  const [totalIncidentes, incidentesAbiertos, incidentesCriticos, totalMatrices, matrizAlta] = await Promise.all([
    db.incidente.count({ where: campFilter }),
    db.incidente.count({ where: { ...campFilter, estado: { in: ["abierto", "en_investigacion"] } } }),
    db.incidente.count({ where: { ...campFilter, criticidad: { in: ["alta", "critica"] }, estado: { not: "cerrado" } } }),
    db.matrizRiesgo.count({ where: campFilter }),
    db.matrizRiesgo.count({ where: { ...campFilter, nivelRiesgo: { in: ["alto", "critico"] } } }),
  ]);

  const ultimosIncidentes = await db.incidente.findMany({
    where: campFilter,
    orderBy: { createdAt: "desc" },
    take: 5,
    include: { reportadoPor: { select: { name: true } } },
  });

  return (
    <AppShell title="HSEC / Prevención" user={user} activeNav="hsec">
      <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>

        {/* KPIs */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "1rem" }}>
          {[
            { label: "Incidentes abiertos", value: incidentesAbiertos, color: incidentesAbiertos > 0 ? "#ef4444" : "#16a34a", href: "/hsec/incidentes" },
            { label: "Criticidad alta/crítica", value: incidentesCriticos, color: incidentesCriticos > 0 ? "#f97316" : "#16a34a", href: "/hsec/incidentes" },
            { label: "Total incidentes", value: totalIncidentes, color: "#64748b", href: "/hsec/incidentes" },
            { label: "Riesgos altos/críticos", value: matrizAlta, color: matrizAlta > 0 ? "#f97316" : "#16a34a", href: "/hsec/matrices" },
            { label: "Total matrices", value: totalMatrices, color: "#64748b", href: "/hsec/matrices" },
          ].map((k) => (
            <Link key={k.label} href={k.href} style={{ textDecoration: "none" }}>
              <div className="card" style={{ borderTop: `4px solid ${k.color}`, padding: "1rem" }}>
                <div style={{ fontSize: "2rem", fontWeight: 700, color: k.color }}>{k.value}</div>
                <div style={{ fontSize: "0.82rem", color: "var(--muted)" }}>{k.label}</div>
              </div>
            </Link>
          ))}
        </div>

        {/* Accesos rápidos */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
          {[
            { href: "/hsec/incidentes/nuevo", title: "+ Registrar incidente", desc: "Hallazgo, accidente o incumplimiento" },
            { href: "/hsec/matrices/nueva", title: "+ Nueva matriz de riesgo", desc: "Evaluar probabilidad e impacto" },
            { href: "/hsec/incidentes", title: "Ver incidentes", desc: "Listado y seguimiento" },
            { href: "/hsec/matrices", title: "Ver matrices de riesgo", desc: "Listado por nivel de riesgo" },
            { href: "/hsec/documentos", title: "Documentos del campamento", desc: "Planes, autorizaciones y permisos" },
          ].map((a) => (
            <Link key={a.href} href={a.href} className="card" style={{ textDecoration: "none", display: "block", padding: "1rem" }}>
              <strong style={{ display: "block", marginBottom: 4 }}>{a.title}</strong>
              <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>{a.desc}</span>
            </Link>
          ))}
        </div>

        {/* Últimos incidentes */}
        {ultimosIncidentes.length > 0 && (
          <div className="card" style={{ overflowX: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h2 style={{ margin: 0 }}>Últimos incidentes</h2>
              <Link href="/hsec/incidentes" style={{ fontSize: "0.875rem" }}>Ver todos →</Link>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Título</th>
                  <th>Criticidad</th>
                  <th>Estado</th>
                  <th>Reportado por</th>
                  <th>Fecha</th>
                </tr>
              </thead>
              <tbody>
                {ultimosIncidentes.map((i) => (
                  <tr key={i.id}>
                    <td><Link href={`/hsec/incidentes/${i.id}`}>{i.titulo}</Link></td>
                    <td>
                      <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: "0.8rem", background: criticidadColor[i.criticidad] + "20", color: criticidadColor[i.criticidad], fontWeight: 600 }}>
                        {i.criticidad.charAt(0).toUpperCase() + i.criticidad.slice(1)}
                      </span>
                    </td>
                    <td>{estadoLabel[i.estado] ?? i.estado}</td>
                    <td>{i.reportadoPor.name}</td>
                    <td>{new Date(i.fechaOcurrencia).toLocaleDateString("es-CL")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {ultimosIncidentes.length === 0 && (
          <div className="card" style={{ textAlign: "center", padding: "2rem", color: "var(--muted)" }}>
            <p style={{ margin: 0 }}>No hay incidentes registrados aún.</p>
            <Link href="/hsec/incidentes/nuevo" style={{ marginTop: 8, display: "inline-block" }}>Registrar el primero →</Link>
          </div>
        )}
      </div>
    </AppShell>
  );
}
