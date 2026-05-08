import Link from "next/link";
import { requireRole, OPERATION_ROLES, canAccessHSEC, isAdminRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";

export default async function DashboardPage() {
  const user = await requireRole(OPERATION_ROLES);

  const isAdmin = isAdminRole(user.role);
  const today = new Date();
  const en7dias = new Date(today); en7dias.setDate(today.getDate() + 7);
  const en30dias = new Date(today); en30dias.setDate(today.getDate() + 30);
  const campFilter = !isAdmin && user.campId ? { campId: user.campId } : {};

  const [
    campsActivos,
    trabajadoresActivos,
    vehiculosOperativos,
    tareasAbiertas,
    eppVenceSemana,
    eppVenceMes,
    incidentesAbiertos,
    induccionesPendientes,
    misTareas,
    ultimosIncidentes,
  ] = await Promise.all([
    db.camp.count({ where: { isActive: true } }),
    db.staffMember.count({ where: { isActive: true, ...campFilter } }),
    db.vehicle.count({ where: { status: "OPERATIVO" } }),
    db.tarea.count({ where: { estado: { in: ["pendiente", "en_progreso"] } } }),
    db.entregaEPP.count({ where: { fechaVencimiento: { lte: en7dias, gte: today }, ...campFilter } }),
    db.entregaEPP.count({ where: { fechaVencimiento: { lte: en30dias, gte: today }, ...campFilter } }),
    canAccessHSEC(user.role)
      ? db.incidente.count({ where: { estado: { in: ["abierto", "en_investigacion"] } } })
      : Promise.resolve(0),
    db.induccionUsuario.count({ where: { estado: { in: ["pendiente", "en_progreso"] }, ...campFilter } }),
    db.tarea.findMany({
      where: { estado: { in: ["pendiente", "en_progreso"] }, responsable: user.name },
      orderBy: [{ prioridad: "asc" }, { createdAt: "desc" }],
      take: 6,
    }),
    canAccessHSEC(user.role)
      ? db.incidente.findMany({
          where: { estado: { in: ["abierto", "en_investigacion"] } },
          orderBy: [{ criticidad: "desc" }, { createdAt: "desc" }],
          take: 5,
          select: { id: true, titulo: true, criticidad: true, estado: true, fechaOcurrencia: true },
        })
      : Promise.resolve([]),
  ]);

  const prioridadColor: Record<string, string> = { alta: "#dc2626", media: "#d97706", baja: "#16a34a" };
  const criticidadBg: Record<string, string> = { critica: "#fee2e2", alta: "#ffedd5", media: "#fef9c3", baja: "#dcfce7" };
  const criticidadColor: Record<string, string> = { critica: "#991b1b", alta: "#9a3412", media: "#854d0e", baja: "#166534" };

  return (
    <AppShell title="Dashboard" user={user} activeNav="dashboard">
      <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", maxWidth: 1100 }}>

        {/* KPIs principales */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "1rem" }}>

          <Link href="/operaciones" style={{ textDecoration: "none" }}>
            <div className="card" style={{ textAlign: "center", padding: "1.1rem", cursor: "pointer" }}>
              <div style={{ fontSize: "2rem", fontWeight: 800, color: "#2563eb" }}>{campsActivos}</div>
              <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: 2 }}>Campamentos activos</div>
            </div>
          </Link>

          <Link href="/trabajadores" style={{ textDecoration: "none" }}>
            <div className="card" style={{ textAlign: "center", padding: "1.1rem", cursor: "pointer" }}>
              <div style={{ fontSize: "2rem", fontWeight: 800, color: "#0891b2" }}>{trabajadoresActivos}</div>
              <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: 2 }}>Trabajadores activos</div>
            </div>
          </Link>

          <Link href="/vehiculos" style={{ textDecoration: "none" }}>
            <div className="card" style={{ textAlign: "center", padding: "1.1rem", cursor: "pointer" }}>
              <div style={{ fontSize: "2rem", fontWeight: 800, color: "#7c3aed" }}>{vehiculosOperativos}</div>
              <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: 2 }}>Vehículos operativos</div>
            </div>
          </Link>

          <Link href="/gestion-tareas" style={{ textDecoration: "none" }}>
            <div className="card" style={{ textAlign: "center", padding: "1.1rem", cursor: "pointer" }}>
              <div style={{ fontSize: "2rem", fontWeight: 800, color: tareasAbiertas > 0 ? "#d97706" : "#16a34a" }}>{tareasAbiertas}</div>
              <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: 2 }}>Tareas pendientes</div>
            </div>
          </Link>

          <Link href="/trabajadores/epp" style={{ textDecoration: "none" }}>
            <div className="card" style={{ textAlign: "center", padding: "1.1rem", cursor: "pointer" }}>
              <div style={{ fontSize: "2rem", fontWeight: 800, color: eppVenceSemana > 0 ? "#dc2626" : eppVenceMes > 0 ? "#d97706" : "#16a34a" }}>
                {eppVenceMes}
              </div>
              <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: 2 }}>
                EPP vence en 30 días
                {eppVenceSemana > 0 && (
                  <div style={{ color: "#dc2626", fontWeight: 700 }}>{eppVenceSemana} esta semana</div>
                )}
              </div>
            </div>
          </Link>

          {canAccessHSEC(user.role) && (
            <Link href="/hsec/incidentes" style={{ textDecoration: "none" }}>
              <div className="card" style={{ textAlign: "center", padding: "1.1rem", cursor: "pointer" }}>
                <div style={{ fontSize: "2rem", fontWeight: 800, color: incidentesAbiertos > 0 ? "#dc2626" : "#16a34a" }}>{incidentesAbiertos}</div>
                <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: 2 }}>Incidentes abiertos</div>
              </div>
            </Link>
          )}

          <Link href="/trabajadores/inducciones" style={{ textDecoration: "none" }}>
            <div className="card" style={{ textAlign: "center", padding: "1.1rem", cursor: "pointer" }}>
              <div style={{ fontSize: "2rem", fontWeight: 800, color: induccionesPendientes > 0 ? "#d97706" : "#16a34a" }}>{induccionesPendientes}</div>
              <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: 2 }}>Inducciones pendientes</div>
            </div>
          </Link>

        </div>

        {/* Detalle */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem", alignItems: "start" }}>

          {/* Mis tareas */}
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>Mis tareas pendientes</h3>
              <Link href="/gestion-tareas" style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Ver todas →</Link>
            </div>
            {misTareas.length === 0 ? (
              <p style={{ padding: "1.5rem", color: "var(--muted)", textAlign: "center", margin: 0, fontSize: "0.875rem" }}>
                Sin tareas asignadas 🎉
              </p>
            ) : (
              misTareas.map((t) => (
                <div key={t.id} style={{ padding: "0.75rem 1.25rem", borderBottom: "1px solid #f1f5f9", display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <span style={{ fontSize: "0.7rem", padding: "2px 7px", borderRadius: 4, background: "#f1f5f9", color: prioridadColor[t.prioridad] ?? "#374151", fontWeight: 700, whiteSpace: "nowrap", marginTop: 2 }}>
                    {t.prioridad.toUpperCase()}
                  </span>
                  <div>
                    <div style={{ fontSize: "0.875rem", fontWeight: 500 }}>{t.descripcion}</div>
                    <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                      {t.estado === "en_progreso" ? "En progreso" : "Pendiente"}
                      {t.fechaCierre ? ` · Vence ${new Date(t.fechaCierre).toLocaleDateString("es-CL")}` : ""}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Incidentes abiertos */}
          {canAccessHSEC(user.role) ? (
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h3 style={{ margin: 0 }}>Incidentes abiertos</h3>
                <Link href="/hsec/incidentes" style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Ver todos →</Link>
              </div>
              {ultimosIncidentes.length === 0 ? (
                <p style={{ padding: "1.5rem", color: "var(--muted)", textAlign: "center", margin: 0, fontSize: "0.875rem" }}>
                  Sin incidentes abiertos ✓
                </p>
              ) : (
                ultimosIncidentes.map((inc) => (
                  <Link key={inc.id} href={`/hsec/incidentes/${inc.id}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.75rem 1.25rem", borderBottom: "1px solid #f1f5f9", textDecoration: "none", color: "inherit" }}>
                    <div>
                      <div style={{ fontSize: "0.875rem", fontWeight: 500 }}>{inc.titulo}</div>
                      <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                        {new Date(inc.fechaOcurrencia).toLocaleDateString("es-CL")}
                      </div>
                    </div>
                    <span style={{ fontSize: "0.7rem", padding: "2px 8px", borderRadius: 4, background: criticidadBg[inc.criticidad] ?? "#f1f5f9", color: criticidadColor[inc.criticidad] ?? "#374151", fontWeight: 700, whiteSpace: "nowrap" }}>
                      {inc.criticidad.toUpperCase()}
                    </span>
                  </Link>
                ))
              )}
            </div>
          ) : (
            /* Si no tiene HSEC, mostrar accesos rápidos */
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Accesos rápidos</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                {[
                  { href: "/trabajadores/epp", icon: "🦺", label: "Control EPP" },
                  { href: "/trabajadores/inducciones", icon: "🎓", label: "Inducciones" },
                  { href: "/bodega", icon: "📦", label: "Bodega" },
                  { href: "/operaciones", icon: "📊", label: "Operaciones" },
                ].map((a) => (
                  <Link key={a.href} href={a.href} style={{ display: "flex", alignItems: "center", gap: 10, padding: "0.75rem 1rem", borderRadius: 10, border: "1px solid #e2e8f0", textDecoration: "none", color: "inherit", fontWeight: 600, fontSize: "0.875rem" }}>
                    <span style={{ fontSize: "1.25rem" }}>{a.icon}</span> {a.label}
                  </Link>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    </AppShell>
  );
}
