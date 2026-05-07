import Link from "next/link";
import { isAdminRole, HSEC_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";

export default async function ReportesHSECPage() {
  const user = await requireRole(HSEC_ROLES);
  const isAdmin = isAdminRole(user.role);
  const campFilter = isAdmin ? {} : { campId: user.campId ?? undefined };

  const [
    incidentesPorCriticidad,
    incidentesPorEstado,
    matricesPorNivel,
    incidentesUltimos30,
  ] = await Promise.all([
    db.incidente.groupBy({ by: ["criticidad"], where: campFilter, _count: true }),
    db.incidente.groupBy({ by: ["estado"], where: campFilter, _count: true }),
    db.matrizRiesgo.groupBy({ by: ["nivelRiesgo"], where: campFilter, _count: true }),
    db.incidente.count({ where: { ...campFilter, fechaOcurrencia: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } }),
  ]);

  const criticidadColor: Record<string, string> = { baja: "#16a34a", media: "#f59e0b", alta: "#f97316", critica: "#ef4444" };
  const estadoColor: Record<string, string> = { abierto: "#ef4444", en_investigacion: "#f59e0b", cerrado: "#16a34a" };
  const nivelColor: Record<string, string> = { bajo: "#16a34a", medio: "#f59e0b", alto: "#f97316", critico: "#ef4444" };
  const estadoLabel: Record<string, string> = { abierto: "Abierto", en_investigacion: "En investigación", cerrado: "Cerrado" };

  return (
    <AppShell title="Reportes HSEC" user={user} activeNav="hsec">
      <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "1rem" }}>
          <div className="card" style={{ textAlign: "center", padding: "1.25rem" }}>
            <div style={{ fontSize: "2.5rem", fontWeight: 700, color: "#3b82f6" }}>{incidentesUltimos30}</div>
            <div style={{ fontSize: "0.82rem", color: "var(--muted)" }}>Incidentes últimos 30 días</div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1.5rem" }}>

          {/* Por criticidad */}
          <div className="card">
            <h3 style={{ marginTop: 0, fontSize: "1rem" }}>Incidentes por criticidad</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {["critica", "alta", "media", "baja"].map((c) => {
                const count = incidentesPorCriticidad.find((x) => x.criticidad === c)?._count ?? 0;
                return (
                  <div key={c} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: "0.8rem", background: criticidadColor[c] + "20", color: criticidadColor[c], fontWeight: 600 }}>
                      {c.charAt(0).toUpperCase() + c.slice(1)}
                    </span>
                    <strong style={{ color: criticidadColor[c] }}>{count}</strong>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Por estado */}
          <div className="card">
            <h3 style={{ marginTop: 0, fontSize: "1rem" }}>Incidentes por estado</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {["abierto", "en_investigacion", "cerrado"].map((e) => {
                const count = incidentesPorEstado.find((x) => x.estado === e)?._count ?? 0;
                return (
                  <div key={e} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: "0.8rem", background: estadoColor[e] + "20", color: estadoColor[e], fontWeight: 600 }}>
                      {estadoLabel[e]}
                    </span>
                    <strong style={{ color: estadoColor[e] }}>{count}</strong>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Matrices por nivel */}
          <div className="card">
            <h3 style={{ marginTop: 0, fontSize: "1rem" }}>Matrices por nivel de riesgo</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {["critico", "alto", "medio", "bajo"].map((n) => {
                const count = matricesPorNivel.find((x) => x.nivelRiesgo === n)?._count ?? 0;
                return (
                  <div key={n} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: "0.8rem", background: nivelColor[n] + "20", color: nivelColor[n], fontWeight: 600 }}>
                      {n.charAt(0).toUpperCase() + n.slice(1)}
                    </span>
                    <strong style={{ color: nivelColor[n] }}>{count}</strong>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: "1rem" }}>
          <Link href="/hsec/incidentes" className="btn">Ver todos los incidentes →</Link>
          <Link href="/hsec/matrices" className="btn">Ver matrices de riesgo →</Link>
        </div>
      </div>
    </AppShell>
  );
}
