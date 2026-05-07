import Link from "next/link";
import { requireRole, OPERATION_ROLES, canAccessHSEC, canAccessCampOperations } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";

export default async function DashboardPage() {
  const user = await requireRole(OPERATION_ROLES);

  const today = new Date();
  const en30Dias = new Date(today);
  en30Dias.setDate(en30Dias.getDate() + 30);

  // Tareas pendientes donde el responsable es el usuario
  const tareasPendientes = await db.tarea.findMany({
    where: {
      estado: { in: ["pendiente", "en_progreso"] },
      responsable: user.name,
    },
    orderBy: [{ prioridad: "asc" }, { createdAt: "desc" }],
    take: 10,
  });

  // EPP por vencer en 30 días
  const eppPorVencer = await db.entregaEPP.findMany({
    where: {
      fechaVencimiento: { lte: en30Dias, gte: today },
      ...(user.campId ? { campId: user.campId } : {}),
    },
    orderBy: { fechaVencimiento: "asc" },
    take: 8,
    include: { tipoEpp: { select: { nombre: true } } },
  });

  // Incidentes abiertos (solo si tiene acceso HSEC)
  const incidentesAbiertos = canAccessHSEC(user.role)
    ? await db.incidente.findMany({
        where: { estado: { in: ["abierto", "en_investigacion"] } },
        orderBy: [{ criticidad: "desc" }, { createdAt: "desc" }],
        take: 5,
        select: { id: true, titulo: true, criticidad: true, estado: true, createdAt: true },
      })
    : [];

  const puedeVerOps = canAccessCampOperations(user.role);

  const prioridadColor: Record<string, string> = {
    alta: "#dc2626",
    media: "#d97706",
    baja: "#16a34a",
  };

  const criticidadColor: Record<string, string> = {
    critica: "#dc2626",
    alta: "#ea580c",
    media: "#d97706",
    baja: "#16a34a",
  };

  return (
    <AppShell title="Mi Dashboard" user={user} activeNav="dashboard">
      <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", maxWidth: 1000 }}>

        {/* Bienvenida */}
        <div className="card" style={{ padding: "1.25rem 1.5rem", background: "linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%)", color: "white", border: "none" }}>
          <div style={{ fontSize: "1.25rem", fontWeight: 700 }}>Bienvenido, {user.name} 👋</div>
          <div style={{ fontSize: "0.875rem", opacity: 0.85, marginTop: 4 }}>
            {user.role} · {today.toLocaleDateString("es-CL", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
          </div>
        </div>

        {/* Accesos rápidos */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.75rem" }}>
          {puedeVerOps && (
            <Link href="/operaciones" className="card" style={{ textAlign: "center", padding: "1rem", textDecoration: "none", color: "inherit" }}>
              <div style={{ fontSize: "1.5rem" }}>📊</div>
              <div style={{ fontSize: "0.8rem", fontWeight: 600, marginTop: 4 }}>Operaciones</div>
            </Link>
          )}
          <Link href="/tareas" className="card" style={{ textAlign: "center", padding: "1rem", textDecoration: "none", color: "inherit" }}>
            <div style={{ fontSize: "1.5rem" }}>✅</div>
            <div style={{ fontSize: "0.8rem", fontWeight: 600, marginTop: 4 }}>Tareas</div>
          </Link>
          <Link href="/trabajadores/epp" className="card" style={{ textAlign: "center", padding: "1rem", textDecoration: "none", color: "inherit" }}>
            <div style={{ fontSize: "1.5rem" }}>🦺</div>
            <div style={{ fontSize: "0.8rem", fontWeight: 600, marginTop: 4 }}>Control EPP</div>
          </Link>
          {canAccessHSEC(user.role) && (
            <Link href="/hsec" className="card" style={{ textAlign: "center", padding: "1rem", textDecoration: "none", color: "inherit" }}>
              <div style={{ fontSize: "1.5rem" }}>⚠️</div>
              <div style={{ fontSize: "0.8rem", fontWeight: 600, marginTop: 4 }}>HSEC</div>
            </Link>
          )}
          <Link href="/trabajadores/inducciones" className="card" style={{ textAlign: "center", padding: "1rem", textDecoration: "none", color: "inherit" }}>
            <div style={{ fontSize: "1.5rem" }}>🎓</div>
            <div style={{ fontSize: "0.8rem", fontWeight: 600, marginTop: 4 }}>Inducciones</div>
          </Link>
          <Link href="/bodega" className="card" style={{ textAlign: "center", padding: "1rem", textDecoration: "none", color: "inherit" }}>
            <div style={{ fontSize: "1.5rem" }}>📦</div>
            <div style={{ fontSize: "0.8rem", fontWeight: 600, marginTop: 4 }}>Bodega</div>
          </Link>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem", alignItems: "start" }}>

          {/* Mis tareas pendientes */}
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>Mis tareas pendientes</h3>
              <Link href="/tareas" style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Ver todas →</Link>
            </div>
            {tareasPendientes.length === 0 ? (
              <p style={{ padding: "1.5rem", color: "var(--muted)", textAlign: "center", margin: 0, fontSize: "0.875rem" }}>
                Sin tareas pendientes asignadas.
              </p>
            ) : (
              <div>
                {tareasPendientes.map((t) => (
                  <div key={t.id} style={{ padding: "0.75rem 1.25rem", borderBottom: "1px solid #f1f5f9", display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <span style={{ fontSize: "0.7rem", padding: "2px 7px", borderRadius: 4, background: "#fef3c7", color: prioridadColor[t.prioridad] ?? "#374151", fontWeight: 700, whiteSpace: "nowrap", marginTop: 2 }}>
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
                ))}
              </div>
            )}
          </div>

          {/* EPP por vencer */}
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>EPP por vencer (30 días)</h3>
              <Link href="/trabajadores/epp" style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Ver todos →</Link>
            </div>
            {eppPorVencer.length === 0 ? (
              <p style={{ padding: "1.5rem", color: "var(--muted)", textAlign: "center", margin: 0, fontSize: "0.875rem" }}>
                Sin EPP por vencer en los próximos 30 días.
              </p>
            ) : (
              <div>
                {eppPorVencer.map((e) => {
                  const diasRestantes = Math.ceil((new Date(e.fechaVencimiento).getTime() - today.getTime()) / 86400000);
                  return (
                    <div key={e.id} style={{ padding: "0.75rem 1.25rem", borderBottom: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ fontSize: "0.875rem", fontWeight: 500 }}>{e.tipoEpp?.nombre ?? "EPP"}</div>
                        <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{e.nombreTrabajador}</div>
                      </div>
                      <span style={{ fontSize: "0.75rem", padding: "2px 8px", borderRadius: 4, background: diasRestantes <= 7 ? "#fee2e2" : "#fef3c7", color: diasRestantes <= 7 ? "#991b1b" : "#92400e", fontWeight: 600, whiteSpace: "nowrap" }}>
                        {diasRestantes}d
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>

        {/* Incidentes abiertos */}
        {incidentesAbiertos.length > 0 && (
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>⚠️ Incidentes abiertos</h3>
              <Link href="/hsec/incidentes" style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Ver todos →</Link>
            </div>
            <div>
              {incidentesAbiertos.map((inc) => (
                <Link key={inc.id} href={`/hsec/incidentes/${inc.id}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.75rem 1.25rem", borderBottom: "1px solid #f1f5f9", textDecoration: "none", color: "inherit" }}>
                  <div style={{ fontSize: "0.875rem", fontWeight: 500 }}>{inc.titulo}</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <span style={{ fontSize: "0.7rem", padding: "2px 7px", borderRadius: 4, background: "#fee2e2", color: criticidadColor[inc.criticidad] ?? "#374151", fontWeight: 700 }}>
                      {inc.criticidad.toUpperCase()}
                    </span>
                    <span style={{ fontSize: "0.7rem", padding: "2px 7px", borderRadius: 4, background: "#f1f5f9", color: "var(--muted)", fontWeight: 600 }}>
                      {inc.estado.replace("_", " ")}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

      </div>
    </AppShell>
  );
}
