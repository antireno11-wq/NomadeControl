import { requireRole, ADMIN_ROLES } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { ImportWorkers } from "./import-client";

export default async function ImportarTrabajadoresPage() {
  const user = await requireRole(ADMIN_ROLES);
  return (
    <AppShell title="Importar trabajadores" user={user} activeNav="trabajadores">
      <ImportWorkers />
    </AppShell>
  );
}
