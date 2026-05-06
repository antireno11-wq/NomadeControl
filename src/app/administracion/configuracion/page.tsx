import { requireRole, ADMIN_ROLES } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import Link from "next/link";
import {
  agregarProyectoAction,
  agregarAreaAction,
  toggleProyectoAction,
  toggleAreaAction,
} from "./actions";

export default async function ConfiguracionPage() {
  const user = await requireRole(ADMIN_ROLES);

  const [proyectos, areas] = await Promise.all([
    (db as any).proyectoConfig.findMany({ orderBy: { nombre: "asc" } }),
    (db as any).areaConfig.findMany({ orderBy: { nombre: "asc" } }),
  ]);

  return (
    <AppShell title="Configuración" user={user} activeNav="administracion" showAdminSections>
      <div style={{ marginBottom: 16 }}>
        <Link href="/administracion" style={{ color: "var(--teal)", textDecoration: "none", fontSize: "0.9rem", fontWeight: 600 }}>
          ← Volver a administración
        </Link>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, alignItems: "start" }}>

        {/* ── Proyectos ── */}
        <div className="card">
          <h2 style={{ marginTop: 0, color: "var(--teal)" }}>📌 Proyectos</h2>
          <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginBottom: 16 }}>
            Listado de proyectos disponibles al crear o editar tareas.
          </p>

          <form action={agregarProyectoAction} style={{ display: "flex", gap: 8, marginBottom: 20 }}>
            <input
              name="nombre"
              placeholder="Nombre del proyecto"
              required
              style={{ flex: 1, padding: "8px 10px" }}
            />
            <button type="submit" style={{ width: "auto", padding: "8px 16px" }}>
              + Agregar
            </button>
          </form>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {proyectos.length === 0 && (
              <div style={{ color: "var(--muted)", fontSize: "0.85rem", textAlign: "center", padding: "20px 0" }}>
                No hay proyectos configurados
              </div>
            )}
            {proyectos.map(p => (
              <div key={p.id} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "8px 12px", borderRadius: 8,
                background: p.isActive ? "#f0fdf4" : "#f8fafc",
                border: `1px solid ${p.isActive ? "#bbf7d0" : "var(--border)"}`,
              }}>
                <span style={{ fontWeight: 600, color: p.isActive ? "#15803d" : "var(--muted)" }}>
                  {p.nombre}
                </span>
                <form action={toggleProyectoAction.bind(null, p.id, !p.isActive)}>
                  <button type="submit" style={{
                    width: "auto", padding: "3px 10px", fontSize: "0.78rem",
                    borderRadius: 6,
                    background: p.isActive ? "#fef2f2" : "#f0fdf4",
                    color: p.isActive ? "#dc2626" : "#16a34a",
                    border: `1px solid ${p.isActive ? "#fecaca" : "#bbf7d0"}`,
                  }}>
                    {p.isActive ? "Desactivar" : "Activar"}
                  </button>
                </form>
              </div>
            ))}
          </div>
        </div>

        {/* ── Áreas ── */}
        <div className="card">
          <h2 style={{ marginTop: 0, color: "var(--teal)" }}>🏷️ Áreas</h2>
          <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginBottom: 16 }}>
            Listado de áreas disponibles al crear o editar tareas.
          </p>

          <form action={agregarAreaAction} style={{ display: "flex", gap: 8, marginBottom: 20 }}>
            <input
              name="nombre"
              placeholder="Nombre del área"
              required
              style={{ flex: 1, padding: "8px 10px" }}
            />
            <button type="submit" style={{ width: "auto", padding: "8px 16px" }}>
              + Agregar
            </button>
          </form>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {areas.length === 0 && (
              <div style={{ color: "var(--muted)", fontSize: "0.85rem", textAlign: "center", padding: "20px 0" }}>
                No hay áreas configuradas
              </div>
            )}
            {areas.map(a => (
              <div key={a.id} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "8px 12px", borderRadius: 8,
                background: a.isActive ? "#eff6ff" : "#f8fafc",
                border: `1px solid ${a.isActive ? "#bfdbfe" : "var(--border)"}`,
              }}>
                <span style={{ fontWeight: 600, color: a.isActive ? "#1d4ed8" : "var(--muted)" }}>
                  {a.nombre}
                </span>
                <form action={toggleAreaAction.bind(null, a.id, !a.isActive)}>
                  <button type="submit" style={{
                    width: "auto", padding: "3px 10px", fontSize: "0.78rem",
                    borderRadius: 6,
                    background: a.isActive ? "#fef2f2" : "#eff6ff",
                    color: a.isActive ? "#dc2626" : "#1d4ed8",
                    border: `1px solid ${a.isActive ? "#fecaca" : "#bfdbfe"}`,
                  }}>
                    {a.isActive ? "Desactivar" : "Activar"}
                  </button>
                </form>
              </div>
            ))}
          </div>
        </div>

      </div>
    </AppShell>
  );
}
