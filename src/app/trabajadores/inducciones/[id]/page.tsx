import Link from "next/link";
import { notFound } from "next/navigation";
import { OPERATION_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { actualizarInduccionAction } from "./actions";

const estadoColor: Record<string, string> = {
  pendiente: "#94a3b8", en_progreso: "#f59e0b", completado: "#16a34a", reprobado: "#ef4444",
};
const estadoLabel: Record<string, string> = {
  pendiente: "Pendiente", en_progreso: "En progreso", completado: "Completado", reprobado: "Reprobado",
};

export default async function InduccionDetallePage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { status?: string };
}) {
  const user = await requireRole(OPERATION_ROLES);

  const induccion = await db.induccionUsuario.findUnique({
    where: { id: params.id },
    include: {
      curso: { include: { preguntas: { orderBy: { orden: "asc" } } } },
      staffMember: { select: { fullName: true, camp: { select: { name: true } } } },
    },
  });

  if (!induccion) notFound();

  const msg =
    searchParams?.status === "created" ? "Inducción asignada correctamente." :
    searchParams?.status === "updated" ? "Inducción actualizada." :
    searchParams?.status === "exists" ? "Este trabajador ya tiene esta inducción asignada." : null;

  const preguntas = induccion.curso.preguntas;

  return (
    <AppShell title="Detalle Inducción" user={user} activeNav="trabajadores">
      <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", maxWidth: 800 }}>

        {msg && <div className="alert success">{msg}</div>}

        <div>
          <Link href="/trabajadores/inducciones" style={{ fontSize: "0.875rem", color: "var(--muted)" }}>← Volver a inducciones</Link>
          <h2 style={{ margin: "0.5rem 0 0.25rem" }}>{induccion.curso.titulo}</h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span style={{ padding: "2px 10px", borderRadius: 4, fontSize: "0.82rem", background: estadoColor[induccion.estado] + "20", color: estadoColor[induccion.estado], fontWeight: 600 }}>
              {estadoLabel[induccion.estado]}
            </span>
            {induccion.reglamentoFirmado && <span style={{ padding: "2px 10px", borderRadius: 4, fontSize: "0.82rem", background: "#dcfce7", color: "#166534", fontWeight: 600 }}>✅ Reglamento firmado</span>}
            {induccion.certificadoUrl && <span style={{ padding: "2px 10px", borderRadius: 4, fontSize: "0.82rem", background: "#dbeafe", color: "#1e40af", fontWeight: 600 }}>📄 Certificado emitido</span>}
          </div>
        </div>

        {/* Info */}
        <div className="card">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div><span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Trabajador</span><div style={{ fontWeight: 500 }}>{induccion.nombreTrabajador}</div></div>
            {induccion.staffMember?.camp && <div><span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Campamento</span><div>{induccion.staffMember.camp.name}</div></div>}
            <div><span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Intentos</span><div>{induccion.intentos}</div></div>
            {induccion.puntaje !== null && <div><span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Puntaje</span><div style={{ fontWeight: 700, fontSize: "1.1rem", color: induccion.puntaje >= 60 ? "#16a34a" : "#ef4444" }}>{induccion.puntaje}%</div></div>}
            {induccion.fechaInicio && <div><span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Inicio</span><div>{new Date(induccion.fechaInicio).toLocaleDateString("es-CL")}</div></div>}
            {induccion.fechaCompletado && <div><span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Completado</span><div>{new Date(induccion.fechaCompletado).toLocaleDateString("es-CL")}</div></div>}
          </div>
          {induccion.curso.descripcion && (
            <div style={{ marginTop: "1rem" }}>
              <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Descripción del curso</span>
              <p style={{ margin: "0.25rem 0 0" }}>{induccion.curso.descripcion}</p>
            </div>
          )}
        </div>

        {/* Actualizar estado */}
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Actualizar estado</h3>
          <form action={actualizarInduccionAction} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <input type="hidden" name="id" value={induccion.id} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
              <div>
                <label className="label">Estado</label>
                <select name="estado" defaultValue={induccion.estado} className="input">
                  <option value="pendiente">Pendiente</option>
                  <option value="en_progreso">En progreso</option>
                  <option value="completado">Completado</option>
                  <option value="reprobado">Reprobado</option>
                </select>
              </div>
              <div>
                <label className="label">Puntaje (%)</label>
                <input name="puntaje" type="number" min="0" max="100" defaultValue={induccion.puntaje ?? ""} className="input" placeholder="0-100" />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input name="reglamentoFirmado" type="checkbox" value="true" defaultChecked={induccion.reglamentoFirmado} />
                  <span>Reglamento firmado</span>
                </label>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button type="submit" className="btn primary">Guardar cambios</button>
            </div>
          </form>
        </div>

        {/* Preguntas del quiz */}
        {preguntas.length > 0 && (
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Quiz del curso ({preguntas.length} preguntas)</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {preguntas.map((p, idx) => {
                const opciones = p.opciones as string[];
                return (
                  <div key={p.id} style={{ padding: "0.75rem", background: "#f8fafc", borderRadius: 8 }}>
                    <p style={{ margin: "0 0 0.5rem", fontWeight: 500 }}>{idx + 1}. {p.pregunta}</p>
                    <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
                      {opciones.map((op, i) => (
                        <li key={i} style={{ color: i === p.respuestaCorrecta ? "#16a34a" : "inherit", fontWeight: i === p.respuestaCorrecta ? 600 : 400 }}>
                          {op} {i === p.respuestaCorrecta ? "✓" : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
