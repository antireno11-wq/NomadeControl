import { STAFF_DOCUMENT_FIELDS, STAFF_ROLE_OPTIONS } from "@/lib/staff-docs";
import { MOTIVOS_BAJA } from "@/lib/acreditacion";

type CampOption = {
  id: string;
  name: string;
};

type WorkerFormDefaults = {
  campId: string;
  fullName: string;
  role: string;
  employerCompany: string;
  nationalId: string;
  phone: string;
  personalEmail: string;
  shiftPattern: string;
  shiftStartDate: string;
  contractEndDate: string;
  contractIsIndefinite: boolean;
  /** Grupo de dotación: decide qué documentos se le exigen. */
  cargoId: string;
  proyectoId: string;
  trabajoPrevioMandante: boolean;
  altitudeExamDueDate: string;
  occupationalExamDueDate: string;
  inductionDueDate: string;
  accreditationDueDate: string;
  driversLicenseDueDate: string;
  cedulaExpiryDate: string;
  foodHandlingExamDueDate: string;
  vaccineDueDate: string;
  notes: string;
  isActive: boolean;
  motivoBaja?: string | null;
};

export function WorkerForm({
  action,
  camps,
  cargos,
  proyectos,
  defaults,
  submitLabel,
  successRedirectTo,
  errorRedirectTo,
  workerId,
  fixedCampId,
  fixedCampName
}: {
  action: (formData: FormData) => Promise<void>;
  camps: CampOption[];
  cargos: { id: string; nombre: string }[];
  proyectos: { id: string; nombre: string; mandanteNombre: string; faena: string | null }[];
  defaults: WorkerFormDefaults;
  submitLabel: string;
  successRedirectTo: string;
  errorRedirectTo: string;
  workerId?: string;
  fixedCampId?: string;
  fixedCampName?: string;
}) {
  return (
    <form action={action} className="grid two">
      {workerId ? <input type="hidden" name="workerId" value={workerId} /> : null}
      <input type="hidden" name="successRedirectTo" value={successRedirectTo} />
      <input type="hidden" name="errorRedirectTo" value={errorRedirectTo} />

      {fixedCampId ? (
        <>
          <input type="hidden" name="campId" value={fixedCampId} />
          <div>
            <label>Campamento</label>
            <input value={fixedCampName ?? "Campamento asignado"} disabled />
          </div>
        </>
      ) : (
        <div>
          <label htmlFor="worker-camp">Campamento <span style={{ fontWeight: 400, color: "var(--muted)" }}>(opcional)</span></label>
          <select id="worker-camp" name="campId" defaultValue={defaults.campId}>
            <option value="">Sin asignar</option>
            {camps.map((camp) => (
              <option key={camp.id} value={camp.id}>
                {camp.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label htmlFor="worker-name">Nombre completo</label>
        <input id="worker-name" name="fullName" defaultValue={defaults.fullName} required />
      </div>
      <div>
        <label htmlFor="worker-role">Cargo del contrato</label>
        <select id="worker-role" name="role" defaultValue={defaults.role}>
          <option value="">Selecciona un cargo</option>
          {STAFF_ROLE_OPTIONS.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </select>
      </div>

      {/* El proyecto y el grupo de dotación son los que deciden qué
          documentos se le exigen. Sin ellos no hay matriz que aplicar. */}
      <div>
        <label htmlFor="worker-proyecto">Proyecto de acreditación</label>
        <select id="worker-proyecto" name="proyectoId" defaultValue={defaults.proyectoId}>
          <option value="">Sin proyecto asignado</option>
          {proyectos.map(p => (
            <option key={p.id} value={p.id}>
              {p.mandanteNombre} — {p.nombre}{p.faena ? ` (${p.faena})` : ""}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="worker-cargo">Grupo de dotación</label>
        <select id="worker-cargo" name="cargoId" defaultValue={defaults.cargoId}>
          <option value="">Sin grupo asignado</option>
          {cargos.map(c => (
            <option key={c.id} value={c.id}>{c.nombre}</option>
          ))}
        </select>
        <span style={{ color: "var(--muted)", fontSize: "0.78rem" }}>
          Define qué documentos se le exigen. Si queda sin asignar, no se le puede calcular el avance.
        </span>
      </div>
      <div>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input type="checkbox" name="trabajoPrevioMandante" defaultChecked={defaults.trabajoPrevioMandante} />
          Trabajó antes en una faena del mandante
        </label>
        <span style={{ color: "var(--muted)", fontSize: "0.78rem" }}>
          Activa el finiquito de ese trabajo anterior como documento exigido.
        </span>
      </div>
      <div>
        <label htmlFor="worker-company">Empresa</label>
        <input id="worker-company" name="employerCompany" defaultValue={defaults.employerCompany} placeholder="Nomade Chile o contratista" />
      </div>
      <div>
        <label htmlFor="worker-national-id">RUT / Identificación</label>
        <input id="worker-national-id" name="nationalId" defaultValue={defaults.nationalId} />
      </div>
      <div>
        <label htmlFor="worker-phone">Teléfono</label>
        <input id="worker-phone" name="phone" defaultValue={defaults.phone} />
      </div>
      <div>
        <label htmlFor="worker-email">Correo</label>
        <input id="worker-email" name="personalEmail" type="email" defaultValue={defaults.personalEmail} />
      </div>
      <div>
        <label htmlFor="worker-shift-pattern">Turno</label>
        <select id="worker-shift-pattern" name="shiftPattern" defaultValue={defaults.shiftPattern} required>
          <option value="14x14">14x14</option>
          <option value="10x10">10x10</option>
          <option value="7x7">7x7</option>
          <option value="4x3">4x3</option>
        </select>
      </div>
      <div>
        <label htmlFor="worker-shift-start">Inicio de turno</label>
        <input id="worker-shift-start" name="shiftStartDate" type="date" defaultValue={defaults.shiftStartDate} required />
      </div>

      <div style={{ gridColumn: "1 / -1" }}>
        <h3 style={{ marginBottom: 8 }}>Vencimientos documentales</h3>
      </div>

      {/* Contrato con opción "Indefinido" */}
      <div>
        <label htmlFor="worker-contractEndDate">Contrato</label>
        <input
          id="worker-contractEndDate"
          name="contractEndDate"
          type="date"
          defaultValue={defaults.contractEndDate}
        />
        <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, fontSize: "0.82rem", color: "var(--muted)", fontWeight: 400, cursor: "pointer" }}>
          <input
            type="checkbox"
            name="contractIsIndefinite"
            defaultChecked={defaults.contractIsIndefinite}
            style={{ width: "auto", margin: 0 }}
          />
          Contrato indefinido (sin fecha de término)
        </label>
      </div>

      {/* Resto de documentos (excluye contrato porque se renderiza arriba con checkbox) */}
      {STAFF_DOCUMENT_FIELDS.filter(f => f.key !== "contractEndDate").map((field) => (
        <div key={field.key}>
          <label htmlFor={`worker-${field.key}`}>{field.label}</label>
          <input
            id={`worker-${field.key}`}
            name={field.key}
            type="date"
            defaultValue={defaults[field.key]}
          />
        </div>
      ))}

      <div style={{ gridColumn: "1 / -1" }}>
        <label htmlFor="worker-notes">Notas</label>
        <textarea id="worker-notes" name="notes" defaultValue={defaults.notes} rows={4} />
      </div>

      <div className="vehicle-inline-option">
        <label>
          <input type="checkbox" name="isActive" defaultChecked={defaults.isActive} />
          Trabajador activo
        </label>
        {/* Solo tiene sentido al darlo de baja. Se muestra siempre para no
            depender de JS, pero el guardado lo ignora si sigue activo. */}
        <div style={{ marginTop: 6 }}>
          <label htmlFor="worker-motivo" style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
            Si lo desactivas, ¿por qué?
          </label>
          <select id="worker-motivo" name="motivoBaja" defaultValue={defaults.motivoBaja ?? ""}
                  style={{ fontSize: "0.85rem" }}>
            <option value="">— Sin especificar —</option>
            {MOTIVOS_BAJA.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "flex-end" }}>
        <button type="submit">{submitLabel}</button>
      </div>
    </form>
  );
}
