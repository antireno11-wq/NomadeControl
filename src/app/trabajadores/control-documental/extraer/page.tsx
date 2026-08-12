import Link from "next/link";
import { requireRole, type AppRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { SectionTabs } from "@/components/section-tabs";
import { buildTrabajadoresTabs } from "@/lib/section-nav";
import { getTiposDocumento } from "@/lib/acreditacion-db";
import { ExtractClient } from "./extract-client";
import { getCargos, getProyectos } from "@/lib/requisitos-db";

const STAFF_MANAGER_ROLES: AppRole[] = ["ADMINISTRADOR", "OPERATIVO"];

export default async function ExtraerDocumentosPage() {
  const user = await requireRole(STAFF_MANAGER_ROLES);

  const [workers, tipos, proyectos, cargos] = await Promise.all([
    db.staffMember.findMany({
      where: { isActive: true },
      select: { id: true, fullName: true, nationalId: true },
      orderBy: { fullName: "asc" },
    }),
    getTiposDocumento(),
    getProyectos(),
    getCargos(),
  ]);

  const hasKey = Boolean(process.env.OPENAI_API_KEY);

  return (
    <AppShell
      title="Extraer fechas con IA"
      user={user}
      activeNav="trabajadores"
      rightSlot={
        <Link href="/trabajadores/control-documental">
          <button type="button" className="secondary">← Volver</button>
        </Link>
      }
    >
      <div className="page-stack">
        <SectionTabs items={buildTrabajadoresTabs("control-documental")} />

        {!hasKey && (
          <div className="alert error">
            ⚠️ Falta configurar la variable de entorno <code>OPENAI_API_KEY</code> en Railway.
            Ve a Settings → Variables y agregala. La página no puede procesar documentos sin la key.
          </div>
        )}

        <div className="hero-panel">
          <span className="hero-kicker">Extractor con IA</span>
          <h2 style={{ margin: "0 0 8px" }}>Sube las carpetas de documentos, la IA lee las fechas</h2>
          <p className="section-caption" style={{ margin: 0 }}>
            Arrastrá PDFs o fotos de contratos, licencias, cédulas, exámenes, vacunas o certificados.
            La IA identifica cada documento, su vencimiento y a qué trabajador corresponde. Tú revisas
            y confirmas antes de que se guarde nada.
          </p>
          <ul style={{ margin: "12px 0 0", paddingLeft: 20, fontSize: "0.85rem", color: "var(--muted)" }}>
            <li><strong>Un PDF con la carpeta completa se separa solo</strong> en contrato, cédula, exámenes, etc.</li>
            <li>Si el trabajador todavía no existe, se crea la ficha con el nombre y RUT del documento</li>
            <li>Todo pasa por revisión humana — una fecha mal leída sería peor que no tener sistema</li>
            <li>Costo aproximado: USD 0.01 por carpeta (gpt-4o-mini)</li>
          </ul>
        </div>

        {tipos.length === 0 ? (
          <div className="alert error">
            El catálogo de tipos de documento todavía no está inicializado.
            Vuelve a <Link href="/trabajadores/control-documental">Control documental</Link> y
            ejecutá la migración primero.
          </div>
        ) : (
          <ExtractClient
            proyectos={proyectos.map(p => ({ id: p.id, nombre: p.nombre, mandanteNombre: p.mandanteNombre, ambito: p.ambito }))}
            cargos={cargos.map(c => ({ id: c.id, nombre: c.nombre }))}
            workers={workers.map(w => ({
              id: w.id,
              fullName: w.fullName,
              nationalId: w.nationalId,
            }))}
            docTypes={tipos}
            apiKeyMissing={!hasKey}
          />
        )}
      </div>
    </AppShell>
  );
}
