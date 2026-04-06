import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { OPERATION_ROLES, isAdminRole, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { toInputDateValue } from "@/lib/report-utils";
import { ReportForm } from "@/app/dashboard/report-form";
import { AppShell } from "@/components/app-shell";

export default async function EditarInformePage({ params }: { params: { id: string } }) {
  const user = await requireRole(OPERATION_ROLES);

  if (isAdminRole(user.role)) {
    redirect(`/informes/${params.id}`);
  }

  const report = await db.dailyReport.findUnique({
    where: { id: params.id },
    include: { camp: true }
  });

  if (!report) {
    notFound();
  }

  if (report.createdById !== user.id || user.campId !== report.campId) {
    redirect("/carga-diaria");
  }

  return (
    <AppShell
      title="Editar informe"
      user={user}
      activeNav="carga"
      showAdminSections={false}
      rightSlot={
        <div style={{ display: "flex", gap: 8 }}>
          <Link href={`/informes/${report.id}`}>
            <button type="button" className="secondary">Ver detalle</button>
          </Link>
          <Link href="/carga-diaria">
            <button type="button" className="secondary">Volver</button>
          </Link>
        </div>
      }
    >
      <div className="page-stack">
        <div className="alert success">
          Puedes corregir este informe porque fue creado con tu usuario. Si cambias la lectura del medidor, el sistema recalcula el consumo de agua hacia adelante.
        </div>

        <ReportForm
          camps={[{ id: report.camp.id, name: report.camp.name }]}
          defaultDate={toInputDateValue(report.date)}
          defaultCampId={report.camp.id}
          title={`Editar informe · ${report.camp.name}`}
          submitLabel="Guardar cambios"
          defaults={{
            reportId: report.id,
            date: toInputDateValue(report.date),
            campId: report.camp.id,
            peopleCount: report.peopleCount,
            breakfastCount: report.breakfastCount,
            lunchCount: report.lunchCount,
            dinnerCount: report.dinnerCount,
            snackSimpleCount: report.snackSimpleCount,
            snackReplacementCount: report.snackReplacementCount,
            waterBottleCount: report.waterBottleCount,
            lodgingCount: report.lodgingCount,
            meterReading: report.meterReading,
            fuelLiters: report.fuelLiters,
            fuelRemainingLiters: report.fuelRemainingLiters,
            generator1Hours: report.generator1Hours,
            generator2Hours: report.generator2Hours,
            internetStatus: report.internetStatus as "FUNCIONANDO" | "CON_INTERRUPCIONES" | "NO_FUNCIONA",
            blackWaterRemoved: report.blackWaterRemoved ? "SI" : "NO",
            blackWaterRemovedM3: Math.max(1, Math.round(report.blackWaterRemovedM3 || 1)),
            potableWaterTankLevelPercent: report.potableWaterTankLevelPercent,
            blackWaterTankLevelPercent: report.blackWaterTankLevelPercent,
            potableWaterDelivered: report.potableWaterDelivered ? "SI" : "NO",
            potableWaterDeliveredM3: Math.max(1, Math.round(report.potableWaterDeliveredM3 || 1)),
            wasteFillPercent: report.wasteFillPercent,
            chlorineLevel: report.chlorineLevel,
            phLevel: report.phLevel,
            notes: report.notes ?? ""
          }}
        />
      </div>
    </AppShell>
  );
}
