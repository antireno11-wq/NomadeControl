"use client";

import { useFormState, useFormStatus } from "react-dom";
import { toInputDateValue } from "@/lib/report-utils";
import { createVehicleAction, type ActionState, updateVehicleAction } from "./actions";

type CampOption = {
  id: string;
  name: string;
};

type ProjectOption = {
  id: string;
  name: string;
};

type VehicleSnapshot = {
  id: string;
  plate: string;
  company: string | null;
  internalCode: string | null;
  brand: string;
  model: string;
  year: number | null;
  type: string;
  status: string;
  accreditationStatus: string;
  odometerKm: number;
  assignedCampId: string | null;
  assignedProjectId: string | null;
  ownerArea: string | null;
  color: string | null;
  vin: string | null;
  engineNumber: string | null;
  circulationPermitDue: Date | null;
  soapDue: Date | null;
  technicalReviewDue: Date | null;
  insuranceDue: Date | null;
  extinguisherDue: Date | null;
  gpsInstalled: boolean;
  gpsCertificatePresent: boolean;
  unitPhotoSet: boolean;
  winterKitPhotoSet: boolean;
  uvProtectionCertificate: boolean;
  reviewedByName: string | null;
  reviewedAt: Date | null;
  notes: string | null;
};

const initialState: ActionState = { error: "", success: "" };

function SubmitButton({ isEditing }: { isEditing: boolean }) {
  const { pending } = useFormStatus();
  if (pending) {
    return <button type="submit">Guardando...</button>;
  }

  return <button type="submit">{isEditing ? "Guardar cambios" : "Crear vehículo"}</button>;
}

function asDateValue(value?: Date | null) {
  return value ? toInputDateValue(value) : "";
}

export function VehicleForm({
  camps,
  projects,
  vehicle
}: {
  camps: CampOption[];
  projects: ProjectOption[];
  vehicle?: VehicleSnapshot;
}) {
  const isEditing = Boolean(vehicle);
  const action = isEditing ? updateVehicleAction : createVehicleAction;
  const [state, formAction] = useFormState(action, initialState);

  return (
    <form action={formAction} className="grid two vehicle-form-grid">
      {isEditing ? <input type="hidden" name="vehicleId" value={vehicle?.id} /> : null}

      <div>
        <label htmlFor="vehicle-plate">Patente</label>
        <input id="vehicle-plate" name="plate" defaultValue={vehicle?.plate ?? ""} placeholder="ABCD12" required />
      </div>
      <div>
        <label htmlFor="vehicle-company">Empresa</label>
        <input id="vehicle-company" name="company" defaultValue={vehicle?.company ?? ""} placeholder="Nómade Chile" />
      </div>
      <div>
        <label htmlFor="vehicle-code">Código interno</label>
        <input id="vehicle-code" name="internalCode" defaultValue={vehicle?.internalCode ?? ""} placeholder="VH-001" />
      </div>
      <div>
        <label htmlFor="vehicle-brand">Marca</label>
        <input id="vehicle-brand" name="brand" defaultValue={vehicle?.brand ?? ""} required />
      </div>
      <div>
        <label htmlFor="vehicle-model">Modelo</label>
        <input id="vehicle-model" name="model" defaultValue={vehicle?.model ?? ""} required />
      </div>
      <div>
        <label htmlFor="vehicle-year">Año</label>
        <input id="vehicle-year" name="year" type="number" min={1990} max={2100} defaultValue={vehicle?.year ?? ""} />
      </div>
      <div>
        <label htmlFor="vehicle-type">Tipo</label>
        <select id="vehicle-type" name="type" defaultValue={vehicle?.type ?? "Camioneta"}>
          <option value="Camioneta">Camioneta</option>
          <option value="Camión">Camión</option>
          <option value="Bus">Bus</option>
          <option value="Minibús">Minibús</option>
          <option value="SUV">SUV</option>
          <option value="Auto">Auto</option>
          <option value="Otro">Otro</option>
        </select>
      </div>
      <div>
        <label htmlFor="vehicle-status">Estado</label>
        <select id="vehicle-status" name="status" defaultValue={vehicle?.status ?? "OPERATIVO"}>
          <option value="OPERATIVO">Operativo</option>
          <option value="MANTENCION">Mantención</option>
          <option value="FUERA_DE_SERVICIO">Fuera de servicio</option>
        </select>
      </div>
      <div>
        <label htmlFor="vehicle-accreditation">Estatus de acreditación</label>
        <select id="vehicle-accreditation" name="accreditationStatus" defaultValue={vehicle?.accreditationStatus ?? "PENDIENTE"}>
          <option value="ACREDITADO">Acreditado</option>
          <option value="PENDIENTE">Pendiente</option>
          <option value="NO_ACREDITADO">No acreditado</option>
        </select>
      </div>
      <div>
        <label htmlFor="vehicle-odometer">Kilometraje actual</label>
        <input id="vehicle-odometer" name="odometerKm" type="number" min={0} defaultValue={vehicle?.odometerKm ?? 0} required />
      </div>
      <div>
        <label htmlFor="vehicle-camp">Campamento asignado</label>
        <select id="vehicle-camp" name="assignedCampId" defaultValue={vehicle?.assignedCampId ?? "none"}>
          <option value="none">Sin asignar</option>
          {camps.map((camp) => (
            <option key={camp.id} value={camp.id}>
              {camp.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="vehicle-project">Proyecto asignado</label>
        <select id="vehicle-project" name="assignedProjectId" defaultValue={vehicle?.assignedProjectId ?? "none"}>
          <option value="none">Sin proyecto</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="vehicle-area">Área responsable</label>
        <input id="vehicle-area" name="ownerArea" defaultValue={vehicle?.ownerArea ?? ""} placeholder="Operaciones" />
      </div>
      <div>
        <label htmlFor="vehicle-color">Color</label>
        <input id="vehicle-color" name="color" defaultValue={vehicle?.color ?? ""} />
      </div>
      <div>
        <label htmlFor="vehicle-vin">VIN / Chasis</label>
        <input id="vehicle-vin" name="vin" defaultValue={vehicle?.vin ?? ""} />
      </div>
      <div>
        <label htmlFor="vehicle-engine">N° motor</label>
        <input id="vehicle-engine" name="engineNumber" defaultValue={vehicle?.engineNumber ?? ""} />
      </div>
      <div>
        <label htmlFor="vehicle-circulation">Vence permiso circulación</label>
        <input id="vehicle-circulation" name="circulationPermitDue" type="date" defaultValue={asDateValue(vehicle?.circulationPermitDue)} />
      </div>
      <div>
        <label htmlFor="vehicle-soap">Vence SOAP</label>
        <input id="vehicle-soap" name="soapDue" type="date" defaultValue={asDateValue(vehicle?.soapDue)} />
      </div>
      <div>
        <label htmlFor="vehicle-review">Vence revisión técnica</label>
        <input id="vehicle-review" name="technicalReviewDue" type="date" defaultValue={asDateValue(vehicle?.technicalReviewDue)} />
      </div>
      <div>
        <label htmlFor="vehicle-insurance">Vence seguro</label>
        <input id="vehicle-insurance" name="insuranceDue" type="date" defaultValue={asDateValue(vehicle?.insuranceDue)} />
      </div>
      <div>
        <label htmlFor="vehicle-extinguisher">Vence extintor</label>
        <input id="vehicle-extinguisher" name="extinguisherDue" type="date" defaultValue={asDateValue(vehicle?.extinguisherDue)} />
      </div>
      <div className="vehicle-inline-option">
        <label>
          <input type="checkbox" name="gpsInstalled" defaultChecked={vehicle?.gpsInstalled ?? false} />
          GPS instalado
        </label>
      </div>
      <div className="vehicle-inline-option">
        <label>
          <input type="checkbox" name="gpsCertificatePresent" defaultChecked={vehicle?.gpsCertificatePresent ?? false} />
          Certificado de GPS
        </label>
      </div>
      <div className="vehicle-inline-option">
        <label>
          <input type="checkbox" name="unitPhotoSet" defaultChecked={vehicle?.unitPhotoSet ?? false} />
          Detalle fotográfico unidad
        </label>
      </div>
      <div className="vehicle-inline-option">
        <label>
          <input type="checkbox" name="winterKitPhotoSet" defaultChecked={vehicle?.winterKitPhotoSet ?? false} />
          Caja de invierno fotografiada
        </label>
      </div>
      <div className="vehicle-inline-option">
        <label>
          <input type="checkbox" name="uvProtectionCertificate" defaultChecked={vehicle?.uvProtectionCertificate ?? false} />
          Certificado láminas UV
        </label>
      </div>
      <div>
        <label htmlFor="vehicle-reviewed-by">Revisado por</label>
        <input id="vehicle-reviewed-by" name="reviewedByName" defaultValue={vehicle?.reviewedByName ?? ""} />
      </div>
      <div>
        <label htmlFor="vehicle-reviewed-at">Fecha revisión</label>
        <input id="vehicle-reviewed-at" name="reviewedAt" type="date" defaultValue={asDateValue(vehicle?.reviewedAt)} />
      </div>
      <div style={{ gridColumn: "1 / -1" }}>
        <label htmlFor="vehicle-notes">Observaciones</label>
        <textarea id="vehicle-notes" name="notes" defaultValue={vehicle?.notes ?? ""} placeholder="Mantenciones, uso especial, estado general..." />
      </div>

      {state.error ? <div className="alert error">{state.error}</div> : null}
      {state.success ? <div className="alert success">{state.success}</div> : null}

      <div style={{ display: "flex", justifyContent: "flex-end", gridColumn: "1 / -1" }}>
        <SubmitButton isEditing={isEditing} />
      </div>
    </form>
  );
}
