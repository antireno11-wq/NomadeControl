import { isAdminRole, OPERATION_ROLES, requireRole } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { ProfileForm } from "./profile-form";
import { toInputDateValue } from "@/lib/report-utils";

export default async function MiPerfilPage() {
  const user = await requireRole(OPERATION_ROLES);

  return (
    <AppShell title="Mi perfil" user={user} activeNav={null} showAdminSections={isAdminRole(user.role)}>
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
          healthProvider: user.healthProvider ?? "",
          shiftPattern: user.shiftPattern ?? "",
          shiftStartDate: user.shiftStartDate ? toInputDateValue(user.shiftStartDate) : ""
        }}
      />
    </AppShell>
  );
}
