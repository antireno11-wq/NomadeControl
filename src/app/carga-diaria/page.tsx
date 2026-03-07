import Link from "next/link";
import Image from "next/image";
import { OPERATION_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { toInputDateValue } from "@/lib/report-utils";
import { logoutAction } from "@/app/dashboard/actions";
import { ReportForm } from "@/app/dashboard/report-form";
import { OpsNav } from "@/components/ops-nav";

export default async function CargaDiariaPage() {
  const user = await requireRole(OPERATION_ROLES);

  const [camps, recentReports] = await Promise.all([
    db.camp.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    db.dailyReport.findMany({
      take: 15,
      orderBy: [{ date: "desc" }, { camp: { name: "asc" } }],
      include: { camp: true, createdBy: true }
    })
  ]);

  return (
    <main>
      <div className="header">
        <div>
          <div className="brand-inline">
            <Link href="/" aria-label="Ir al inicio">
              <Image src="/nomade-logo-v2.png" alt="Logo Nomade" width={120} height={120} priority />
            </Link>
          </div>
          <h1>Carga Diaria de Consumos</h1>
          <div style={{ color: "var(--muted)", fontSize: "0.92rem" }}>
            Sesión: {user.name} ({user.role})
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <form action={logoutAction}>
            <button className="danger" type="submit">
              Cerrar sesión
            </button>
          </form>
        </div>
      </div>

      <OpsNav active="carga" />

      <div className="alert error" style={{ marginBottom: 16 }}>
        Campos exigibles diarios: desayuno, almuerzo, cena, colación simple, colación de reemplazo, botellas de agua, alojamientos, lectura de medidor, agua gastada, basura, cloro y pH.
      </div>

      <div className="grid two">
        <ReportForm camps={camps.map((camp) => ({ id: camp.id, name: camp.name }))} defaultDate={toInputDateValue(new Date())} />

        <div className="card" style={{ overflowX: "auto" }}>
          <h2 style={{ marginTop: 0 }}>Últimas cargas</h2>
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Campamento</th>
                <th>Personas</th>
                <th>Comidas</th>
                <th>Colaciones</th>
                <th>Botellas</th>
                <th>Alojamientos</th>
                <th>Lectura medidor</th>
                <th>Agua gastada</th>
                <th>Combustible</th>
                <th>Basura</th>
                <th>Cloro</th>
                <th>pH</th>
              </tr>
            </thead>
            <tbody>
              {recentReports.map((report) => (
                <tr key={report.id}>
                  <td>{toInputDateValue(report.date)}</td>
                  <td>{report.camp.name}</td>
                  <td>{report.peopleCount}</td>
                  <td>{report.breakfastCount + report.lunchCount + report.dinnerCount}</td>
                  <td>{report.snackSimpleCount + report.snackReplacementCount}</td>
                  <td>{report.waterBottleCount}</td>
                  <td>{report.lodgingCount}</td>
                  <td>{report.meterReading.toFixed(2)}</td>
                  <td>{report.waterLiters} L</td>
                  <td>{report.fuelLiters} L</td>
                  <td>{report.wasteFillPercent}%</td>
                  <td>{report.chlorineLevel.toFixed(2)}</td>
                  <td>{report.phLevel.toFixed(2)}</td>
                </tr>
              ))}
              {recentReports.length === 0 ? (
                <tr>
                  <td colSpan={13} style={{ color: "var(--muted)" }}>
                    Aún no hay cargas registradas.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
