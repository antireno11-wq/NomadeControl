import Link from "next/link";
import { requireRole, EVALUACIONES_ROLES } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { guardarEvaluacionAction } from "../actions";
import { EvaluacionForm } from "../eval-form";

type SearchParams = { nombre?: string; cargo?: string };

export default async function NuevaEvaluacionPage({ searchParams }: { searchParams?: SearchParams }) {
  const user = await requireRole(EVALUACIONES_ROLES);

  const preNombre = searchParams?.nombre ?? "";
  const preCargo  = searchParams?.cargo  ?? "";

  const [users, staffMembers] = await Promise.all([
    db.user.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, positionTitle: true },
    }),
    db.staffMember.findMany({
      where: { isActive: true },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, role: true },
    }),
  ]);

  const trabajadores = [
    ...users.map(u => ({ nombre: u.name, cargo: u.positionTitle ?? "" })),
    ...staffMembers
      .filter(s => !users.some(u => u.name === s.fullName))
      .map(s => ({ nombre: s.fullName, cargo: s.role ?? "" })),
  ].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  // Pre-fill evaluation with worker from URL params
  const preEval = preNombre
    ? { id: "", evaluadoNombre: preNombre, evaluadoCargo: preCargo, periodo: "", proyecto: null, evaluadorNombre: user.name, planificacion: null, iniciativa: null, cooperacion: null, responsabilidad: null, convivenciaLaboral: null, comunicacionSeg: null, indumentaria: null, elaboracionDocs: null, reportabilidad: null, gestionAmbiente: null, comentPlanificacion: null, comentIniciativa: null, comentCooperacion: null, comentResponsabilidad: null, comentConvivencia: null, comentComunicacion: null, comentIndumentaria: null, comentElaboracion: null, comentReportabilidad: null, comentGestion: null, puntajeTotal: null, oportunidadesMejora: null, mantenerCargo: null, reubicar: null, promocion: null, reconocimiento: null, requiereCapacitacion: null, observacionesFinales: null, estado: "borrador" }
    : null;

  return (
    <AppShell title={preNombre ? `Evaluar a ${preNombre}` : "Nueva Evaluación"} user={user} activeNav="trabajadores">
      <div style={{ marginBottom: 16 }}>
        <Link href="/trabajadores" style={{ color: "var(--teal)", textDecoration: "none", fontSize: "0.9rem", fontWeight: 600 }}>
          ← Volver a trabajadores
        </Link>
      </div>
      <EvaluacionForm
        action={guardarEvaluacionAction}
        evaluacion={preEval}
        trabajadores={trabajadores}
        evaluadorNombre={user.name}
      />
    </AppShell>
  );
}
