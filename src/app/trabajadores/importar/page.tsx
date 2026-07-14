import { requireRole, ADMIN_ROLES, type AppRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { ImportWorkers } from "./import-client";

const STAFF_MANAGER_ROLES: AppRole[] = ["ADMINISTRADOR", "OPERATIVO"];

export default async function ImportarTrabajadoresPage() {
  const user = await requireRole(STAFF_MANAGER_ROLES);
  const camps = await db.camp.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  }).catch(() => [] as { id: string; name: string }[]);
  return (
    <AppShell title="Importar trabajadores" user={user} activeNav="trabajadores">
      <ImportWorkers camps={camps} />
    </AppShell>
  );
}
