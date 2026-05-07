import Link from "next/link";
import { notFound } from "next/navigation";
import { ADMIN_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { toggleCursoAction } from "./actions";

export default async function CursoDetallePage({ params, searchParams }: { params: { id: string }; searchParams?: { status?: string } }) {
  const user = await requireRole(ADMIN_ROLES);

  const curso = await db.curso.findUnique({
    where: { id: params.id },
    include: { preguntas: { orderBy: { orden: "asc" } }, _count: { select: { inducciones: true } } },
  });

  if (!curso) notFound();

  const msg = searchParams?.status === "created" ? "Curso creado correctamente." :
              searchParams?.status === "updated" ? "Curso actualizado." : null;

  return (
    <AppShell title={curso.titulo} user={user} activeNav="trabajadores">
      <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", maxWidth: 800 }}>
        {msg && <div className="alert success">{msg}</div>}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
          <div>
            <Link href="/trabajadores/cursos" style={{ fontSize: "0.875rem", color: "var(--muted)" }}>← Volver a cursos</Link>
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <span style={{ padding: "2px 10px", borderRadius: 4, fontSize: "0.82rem", background: curso.activo ? "#dcfce7" : "#fee2e2", color: curso.activo ? "#166534" : "#991b1b", fontWeight: 600 }}>
                {curso.activo ? "Activo" : "Inactivo"}
              </span>
              <span style={{ padding: "2px 10px", borderRadius: 4, fontSize: "0.82rem", background: "#f1f5f9", color: "#475569" }}>
                ⏱ {curso.tiempoEstimadoMin} min · ❓ {curso.preguntas.length} preguntas · 👤 {curso._count.inducciones} asignaciones
              </span>
            </div>
          </div>
          <form action={toggleCursoAction}>
            <input type="hidden" name="id" value={curso.id} />
            <input type="hidden" name="activo" value={String(!curso.activo)} />
            <button type="submit" className={`btn ${curso.activo ? "secondary" : "primary"}`}>
              {curso.activo ? "Desactivar curso" : "Activar curso"}
            </button>
          </form>
        </div>

        {/* Contenido */}
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Contenido del curso</h3>
          {curso.descripcion && <p style={{ color: "var(--muted)", marginTop: 0 }}>{curso.descripcion}</p>}
          <div style={{ whiteSpace: "pre-wrap", fontSize: "0.9rem", lineHeight: 1.6, maxHeight: 400, overflowY: "auto", padding: "1rem", background: "#f8fafc", borderRadius: 8 }}>
            {curso.contenido}
          </div>
        </div>

        {/* Preguntas */}
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Quiz — {curso.preguntas.length} preguntas</h3>
          {curso.preguntas.length === 0 ? (
            <p style={{ color: "var(--muted)" }}>Este curso no tiene preguntas aún.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {curso.preguntas.map((p, idx) => {
                const opciones = p.opciones as string[];
                return (
                  <div key={p.id} style={{ padding: "0.75rem 1rem", background: "#f8fafc", borderRadius: 8 }}>
                    <p style={{ margin: "0 0 0.5rem", fontWeight: 600 }}>{idx + 1}. {p.pregunta}</p>
                    <ul style={{ margin: 0, paddingLeft: "1.25rem", display: "flex", flexDirection: "column", gap: 4 }}>
                      {opciones.map((op, i) => (
                        <li key={i} style={{ color: i === p.respuestaCorrecta ? "#16a34a" : "#475569", fontWeight: i === p.respuestaCorrecta ? 700 : 400 }}>
                          {op} {i === p.respuestaCorrecta ? " ✓" : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
