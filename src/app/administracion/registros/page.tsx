import Link from "next/link";
import { FULL_ADMIN_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { toInputDateValue } from "@/lib/report-utils";
import { deleteRecordAction } from "../actions";

export default async function AdministracionRegistrosPage() {
  const user = await requireRole(FULL_ADMIN_ROLES);

  const [dailyReports, dailyTaskControls, stockMovements, staffMembers] = await Promise.all([
    db.dailyReport.findMany({
      take: 30,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      include: { camp: true, createdBy: true }
    }),
    db.dailyTaskControl.findMany({
      take: 30,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      include: { camp: true, createdBy: true }
    }),
    db.stockMovement.findMany({
      take: 40,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      include: { camp: true, createdBy: true }
    }),
    db.staffMember.findMany({
      take: 40,
      orderBy: [{ createdAt: "desc" }],
      include: { camp: true, createdBy: true }
    })
  ]);

  return (
    <AppShell
      title="Registros"
      user={user}
      activeNav="administracion"
      showAdminSections
      rightSlot={
        <Link href="/administracion">
          <button type="button" className="secondary">Volver</button>
        </Link>
      }
    >
      <div className="grid two" style={{ marginBottom: 16 }}>
        <div className="metric">
          <div className="label">Informes diarios visibles</div>
          <div className="value">{dailyReports.length}</div>
        </div>
        <div className="metric">
          <div className="label">Tareas diarias visibles</div>
          <div className="value">{dailyTaskControls.length}</div>
        </div>
        <div className="metric">
          <div className="label">Movimientos de bodega visibles</div>
          <div className="value">{stockMovements.length}</div>
        </div>
        <div className="metric">
          <div className="label">Personal visible</div>
          <div className="value">{staffMembers.length}</div>
        </div>
      </div>

      <div className="alert error" style={{ marginBottom: 16 }}>
        Esta pantalla permite borrar registros. El borrado es definitivo.
      </div>

      <div className="card" style={{ marginBottom: 16, overflowX: "auto" }}>
        <h2 style={{ marginTop: 0 }}>Informes diarios</h2>
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Campamento</th>
              <th>Personas</th>
              <th>Usuario</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody>
            {dailyReports.map((row) => (
              <tr key={row.id}>
                <td>{toInputDateValue(row.date)}</td>
                <td>{row.camp.name}</td>
                <td>{row.peopleCount}</td>
                <td>{row.createdBy.name}</td>
                <td>
                  <form action={deleteRecordAction}>
                    <input type="hidden" name="recordType" value="dailyReport" />
                    <input type="hidden" name="recordId" value={row.id} />
                    <button type="submit" className="danger">Borrar</button>
                  </form>
                </td>
              </tr>
            ))}
            {dailyReports.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ color: "var(--muted)" }}>
                  No hay informes diarios para mostrar.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginBottom: 16, overflowX: "auto" }}>
        <h2 style={{ marginTop: 0 }}>Control de tareas diarias</h2>
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Campamento</th>
              <th>Usuario</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody>
            {dailyTaskControls.map((row) => (
              <tr key={row.id}>
                <td>{toInputDateValue(row.date)}</td>
                <td>{row.camp.name}</td>
                <td>{row.createdBy.name}</td>
                <td>
                  <form action={deleteRecordAction}>
                    <input type="hidden" name="recordType" value="dailyTaskControl" />
                    <input type="hidden" name="recordId" value={row.id} />
                    <button type="submit" className="danger">Borrar</button>
                  </form>
                </td>
              </tr>
            ))}
            {dailyTaskControls.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ color: "var(--muted)" }}>
                  No hay controles de tareas para mostrar.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginBottom: 16, overflowX: "auto" }}>
        <h2 style={{ marginTop: 0 }}>Movimientos de bodega</h2>
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Campamento</th>
              <th>Ítem</th>
              <th>Tipo</th>
              <th>Cantidad</th>
              <th>Usuario</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody>
            {stockMovements.map((row) => (
              <tr key={row.id}>
                <td>{toInputDateValue(row.date)}</td>
                <td>{row.camp.name}</td>
                <td>{row.itemName}</td>
                <td>{row.movementType}</td>
                <td>{row.quantity.toFixed(2)} {row.unit}</td>
                <td>{row.createdBy.name}</td>
                <td>
                  <form action={deleteRecordAction}>
                    <input type="hidden" name="recordType" value="stockMovement" />
                    <input type="hidden" name="recordId" value={row.id} />
                    <button type="submit" className="danger">Borrar</button>
                  </form>
                </td>
              </tr>
            ))}
            {stockMovements.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ color: "var(--muted)" }}>
                  No hay movimientos de bodega para mostrar.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ overflowX: "auto" }}>
        <h2 style={{ marginTop: 0 }}>Personal y turnos</h2>
        <table>
          <thead>
            <tr>
              <th>Campamento</th>
              <th>Nombre</th>
              <th>Cargo</th>
              <th>Turno</th>
              <th>Creado por</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody>
            {staffMembers.map((row) => (
              <tr key={row.id}>
                <td>{row.camp.name}</td>
                <td>{row.fullName}</td>
                <td>{row.role ?? "-"}</td>
                <td>{row.shiftPattern}</td>
                <td>{row.createdBy.name}</td>
                <td>
                  <form action={deleteRecordAction}>
                    <input type="hidden" name="recordType" value="staffMember" />
                    <input type="hidden" name="recordId" value={row.id} />
                    <button type="submit" className="danger">Borrar</button>
                  </form>
                </td>
              </tr>
            ))}
            {staffMembers.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ color: "var(--muted)" }}>
                  No hay personal para mostrar.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
