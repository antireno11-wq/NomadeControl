import { requireRole, EVALUACIONES_ROLES } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { guardarEvaluacionAction } from "../actions";
import { EvaluacionForm } from "../eval-form";

export default async function NuevaEvaluacionPage() {
  const user = await requireRole(EVALUACIONES_ROLES);

  // Obtener lista de trabajadores (usuarios activos + staff members activos)
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

  return (
    <AppShell title="Nueva Evaluación" user={user} activeNav="evaluaciones">
      <EvaluacionForm
        action={guardarEvaluacionAction}
        evaluacion={null}
        trabajadores={trabajadores}
        evaluadorNombre={user.name}
      />
    </AppShell>
  );
}
