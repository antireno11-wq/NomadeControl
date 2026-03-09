import Image from "next/image";
import Link from "next/link";
import { OPERATION_ROLES, requireRole } from "@/lib/auth";
import { logoutAction } from "@/app/dashboard/actions";
import { ProfileForm } from "./profile-form";

export default async function MiPerfilPage() {
  const user = await requireRole(OPERATION_ROLES);

  return (
    <main>
      <div className="header">
        <div>
          <div className="brand-inline">
            <Link href="/" aria-label="Ir al inicio">
              <Image src="/nomade-logo-v2.png" alt="Logo Nomade" width={120} height={120} priority />
            </Link>
          </div>
          <h1>Mi perfil</h1>
          <div style={{ color: "var(--muted)", fontSize: "0.92rem" }}>
            Sesion: {user.name} ({user.role})
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Link href="/" className="menu-item">
            Inicio
          </Link>
          <form action={logoutAction}>
            <button className="danger" type="submit">
              Cerrar sesion
            </button>
          </form>
        </div>
      </div>

      <ProfileForm
        defaults={{
          name: user.name,
          email: user.email,
          phone: user.phone ?? "",
          positionTitle: user.positionTitle ?? "",
          profilePhotoUrl: user.profilePhotoUrl ?? "",
          emergencyContactName: user.emergencyContactName ?? "",
          emergencyContactPhone: user.emergencyContactPhone ?? "",
          nationalId: user.nationalId ?? "",
          address: user.address ?? "",
          city: user.city ?? "",
          healthProvider: user.healthProvider ?? ""
        }}
      />
    </main>
  );
}
