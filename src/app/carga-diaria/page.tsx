import Link from "next/link";
import Image from "next/image";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { toInputDateValue } from "@/lib/report-utils";
import { logoutAction } from "@/app/dashboard/actions";
import { ReportForm } from "@/app/dashboard/report-form";

export default async function CargaDiariaPage() {
  const user = await requireRole(["ADMIN", "OPERADOR"]);

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
      <nav className="top-menu">
        <Link href="/dashboard" className="menu-item">
          Dashboard
        </Link>
        <Link href="/carga-diaria" className="menu-item active">
          Cargar información
        </Link>
      </nav>

      <div className="header">
        <div>
          <div className="brand-inline">
            <Image src="/nomade-logo-v2.png" alt="Logo Nomade" width={120} height={120} priority />
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

      <div className="alert error" style={{ marginBottom: 16 }}>
        Campos exigibles diarios: desayuno, almuerzo, cena, colación simple, colación de reemplazo, agua y alojamientos.
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
                <th>Alojamientos</th>
                <th>Agua</th>
                <th>Combustible</th>
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
                  <td>{report.lodgingCount}</td>
                  <td>{report.waterLiters} L</td>
                  <td>{report.fuelLiters} L</td>
                </tr>
              ))}
              {recentReports.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ color: "var(--muted)" }}>
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
