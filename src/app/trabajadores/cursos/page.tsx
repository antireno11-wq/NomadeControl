import Link from "next/link";
import { isAdminRole, TRABAJADORES_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";

export default async function CursosPage() {
  const user = await requireRole(TRABAJADORES_ROLES);
  const isAdmin = isAdminRole(user.role);

  const cursos = await db.curso.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { preguntas: true, inducciones: true } },
    },
  });

  return (
    <AppShell title="Gestión de Cursos" user={user} activeNav="trabajadores">
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <Link href="/trabajadores/inducciones" style={{ fontSize: "0.875rem", color: "var(--muted)" }}>← Volver a inducciones</Link>
          {isAdmin && <Link href="/trabajadores/cursos/nuevo" className="btn primary">+ Nuevo curso</Link>}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "1rem" }}>
          {cursos.map((c) => (
            <div key={c.id} className="card" style={{ padding: "1.25rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <h3 style={{ margin: "0 0 0.25rem", fontSize: "1rem" }}>{c.titulo}</h3>
                  {c.descripcion && <p style={{ margin: "0 0 0.75rem", fontSize: "0.85rem", color: "var(--muted)" }}>{c.descripcion}</p>}
                  <div style={{ display: "flex", gap: 12, fontSize: "0.82rem", color: "var(--muted)" }}>
                    <span>⏱ {c.tiempoEstimadoMin} min</span>
                    <span>❓ {c._count.preguntas} preguntas</span>
                    <span>👤 {c._count.inducciones} asignaciones</span>
                  </div>
                </div>
                <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: "0.78rem", background: c.activo ? "#dcfce7" : "#fee2e2", color: c.activo ? "#166534" : "#991b1b", fontWeight: 600, flexShrink: 0 }}>
                  {c.activo ? "Activo" : "Inactivo"}
                </span>
              </div>
              {isAdmin && (
                <div style={{ marginTop: "1rem", display: "flex", gap: 8 }}>
                  <Link href={`/trabajadores/cursos/${c.id}`} className="btn secondary" style={{ fontSize: "0.82rem", padding: "4px 12px" }}>Editar / Ver preguntas</Link>
                </div>
              )}
            </div>
          ))}
          {cursos.length === 0 && (
            <div style={{ gridColumn: "1 / -1", textAlign: "center", color: "var(--muted)", padding: "3rem" }}>
              No hay cursos creados aún.
              {isAdmin && <div style={{ marginTop: 8 }}><Link href="/trabajadores/cursos/nuevo" className="btn primary">Crear el primero →</Link></div>}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
