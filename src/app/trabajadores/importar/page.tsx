import { requireRole, ADMIN_ROLES } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { ImportWorkers } from "./import-client";

export default async function ImportarTrabajadoresPage() {
  const user = await requireRole(ADMIN_ROLES);
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
