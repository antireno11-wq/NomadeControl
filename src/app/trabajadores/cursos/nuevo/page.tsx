import { ADMIN_ROLES, requireRole } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { crearCursoAction } from "./actions";

export default async function NuevoCursoPage() {
  const user = await requireRole(ADMIN_ROLES);

  return (
    <AppShell title="Nuevo Curso" user={user} activeNav="trabajadores">
      <div className="card" style={{ maxWidth: 720 }}>
        <form action={crearCursoAction} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <label className="label">Título del curso *</label>
            <input name="titulo" required className="input" placeholder="Ej: Inducción de seguridad general" />
          </div>
          <div>
            <label className="label">Descripción</label>
            <textarea name="descripcion" className="input" rows={3} placeholder="Descripción breve del curso..." />
          </div>
          <div>
            <label className="label">Contenido / Material del curso *</label>
            <textarea name="contenido" required className="input" rows={8} placeholder="Pega aquí el contenido del curso que el trabajador deberá leer antes del quiz..." />
          </div>
          <div>
            <label className="label">Tiempo estimado (minutos)</label>
            <input name="tiempoEstimadoMin" type="number" min="5" defaultValue="30" className="input" style={{ maxWidth: 150 }} />
          </div>

          <hr style={{ border: "none", borderTop: "1px solid #e2e8f0" }} />
          <h3 style={{ margin: 0 }}>Preguntas del quiz</h3>
          <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--muted)" }}>
            Agrega entre 5 y 20 preguntas. Marca la respuesta correcta con el número de opción (0 = primera).
          </p>

          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="card" style={{ padding: "1rem", background: "#f8fafc" }}>
              <label className="label">Pregunta {i + 1}</label>
              <input name={`pregunta_${i}`} className="input" placeholder={`Texto de la pregunta ${i + 1}...`} style={{ marginBottom: "0.5rem" }} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                {[0, 1, 2, 3].map((j) => (
                  <input key={j} name={`opcion_${i}_${j}`} className="input" placeholder={`Opción ${j + 1}`} />
                ))}
              </div>
              <div style={{ marginTop: "0.5rem", display: "flex", alignItems: "center", gap: 8 }}>
                <label className="label" style={{ margin: 0 }}>Respuesta correcta (0-3):</label>
                <select name={`correcta_${i}`} className="input" style={{ width: 80 }}>
                  <option value="0">0</option>
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                </select>
              </div>
            </div>
          ))}

          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
            <a href="/trabajadores/cursos" className="btn secondary">Cancelar</a>
            <button type="submit" className="btn primary">Crear curso</button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
