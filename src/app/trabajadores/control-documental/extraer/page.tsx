import Link from "next/link";
import { requireRole, type AppRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { SectionTabs } from "@/components/section-tabs";
import { buildTrabajadoresTabs } from "@/lib/section-nav";
import { ExtractClient } from "./extract-client";

const STAFF_MANAGER_ROLES: AppRole[] = ["ADMINISTRADOR", "OPERATIVO"];

export default async function ExtraerDocumentosPage() {
  const user = await requireRole(STAFF_MANAGER_ROLES);

  const [workers, tipos] = await Promise.all([
    db.staffMember.findMany({
      where: { isActive: true },
      select: { id: true, fullName: true, nationalId: true },
      orderBy: { fullName: "asc" },
    }),
    db.tipoDocumento.findMany({
      where: { activo: true },
      select: { id: true, codigo: true, nombre: true },
      orderBy: { orden: "asc" },
    }),
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
          <h2 style={{ margin: "0 0 8px" }}>Subí fotos/scans de documentos, la IA lee las fechas</h2>
          <p className="section-caption" style={{ margin: 0 }}>
            Arrastrá una o varias imágenes (JPG, PNG, WEBP) de licencias, carnet, exámenes, vacunas o
            certificados. La IA identifica el tipo de documento, el vencimiento, y con qué trabajador
            emparejarlo. Vos revisás y confirmás antes de guardar.
          </p>
          <ul style={{ margin: "12px 0 0", paddingLeft: 20, fontSize: "0.85rem", color: "var(--muted)" }}>
            <li>Ideal para fotos con celular · funciona con PDFs convertidos a imagen</li>
            <li>Todo pasa por revisión humana — no se guarda nada sin tu confirmación</li>
            <li>Costo aproximado: USD 0.002 por documento (gpt-4o-mini)</li>
          </ul>
        </div>

        {tipos.length === 0 ? (
          <div className="alert error">
            El catálogo de tipos de documento todavía no está inicializado.
            Volvé a <Link href="/trabajadores/control-documental">Control documental</Link> y
            ejecutá la migración primero.
          </div>
        ) : (
          <ExtractClient
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
