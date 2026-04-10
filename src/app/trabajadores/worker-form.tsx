import { STAFF_DOCUMENT_FIELDS } from "@/lib/staff-docs";

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
  altitudeExamDueDate: string;
  occupationalExamDueDate: string;
  inductionDueDate: string;
  accreditationDueDate: string;
  driversLicenseDueDate: string;
  notes: string;
  isActive: boolean;
};

export function WorkerForm({
  action,
  camps,
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
          <label htmlFor="worker-camp">Campamento</label>
          <select id="worker-camp" name="campId" defaultValue={defaults.campId} required>
            <option value="">Selecciona un campamento</option>
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
        <label htmlFor="worker-role">Cargo</label>
        <input id="worker-role" name="role" defaultValue={defaults.role} placeholder="Supervisor, Maestro, Conductor..." />
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

      {STAFF_DOCUMENT_FIELDS.map((field) => (
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
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "flex-end" }}>
        <button type="submit">{submitLabel}</button>
      </div>
    </form>
  );
}
