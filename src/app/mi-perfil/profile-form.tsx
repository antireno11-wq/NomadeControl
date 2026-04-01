"use client";

import { useFormState, useFormStatus } from "react-dom";
import { changeOwnPasswordAction, saveProfileAction, type PasswordFormState, type ProfileFormState } from "./actions";

type ProfileDefaults = {
  name: string;
  email: string;
  phone: string;
  positionTitle: string;
  profilePhotoUrl: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  nationalId: string;
  address: string;
  city: string;
  healthProvider: string;
  shiftPattern: string;
  shiftStartDate: string;
};

const initialState: ProfileFormState = { error: "", success: "" };
const initialPasswordState: PasswordFormState = { error: "", success: "" };

function SaveButton() {
  const { pending } = useFormStatus();
  return <button type="submit">{pending ? "Guardando..." : "Guardar perfil"}</button>;
}

function PasswordButton() {
  const { pending } = useFormStatus();
  return <button type="submit" className="secondary">{pending ? "Actualizando..." : "Cambiar contraseña"}</button>;
}

export function ProfileForm({ defaults }: { defaults: ProfileDefaults }) {
  const [state, formAction] = useFormState(saveProfileAction, initialState);
  const [passwordState, passwordAction] = useFormState(changeOwnPasswordAction, initialPasswordState);

  return (
    <div className="page-stack" style={{ maxWidth: 860 }}>
      <form action={formAction} className="card grid">
        <h2 style={{ margin: 0 }}>Datos del supervisor</h2>

        <div className="grid two">
          <div>
            <label htmlFor="name">Nombre completo</label>
            <input id="name" name="name" defaultValue={defaults.name} required />
          </div>
          <div>
            <label htmlFor="email">Correo</label>
            <input id="email" value={defaults.email} disabled />
          </div>
          <div>
            <label htmlFor="positionTitle">Cargo</label>
            <input id="positionTitle" name="positionTitle" defaultValue={defaults.positionTitle} placeholder="Supervisor de campamento" />
          </div>
          <div>
            <label htmlFor="phone">Telefono</label>
            <input id="phone" name="phone" defaultValue={defaults.phone} placeholder="+56 9 ..." />
          </div>
          <div>
            <label htmlFor="nationalId">RUT / Identificacion</label>
            <input id="nationalId" name="nationalId" defaultValue={defaults.nationalId} placeholder="12.345.678-9" />
          </div>
          <div>
            <label htmlFor="healthProvider">Prevision / Salud</label>
            <input id="healthProvider" name="healthProvider" defaultValue={defaults.healthProvider} placeholder="Fonasa, Isapre..." />
          </div>
          <div>
            <label htmlFor="city">Ciudad</label>
            <input id="city" name="city" defaultValue={defaults.city} />
          </div>
          <div>
            <label htmlFor="address">Direccion</label>
            <input id="address" name="address" defaultValue={defaults.address} />
          </div>
          <div>
            <label htmlFor="shiftPattern">Tipo de turno</label>
            <select id="shiftPattern" name="shiftPattern" defaultValue={defaults.shiftPattern}>
              <option value="">Sin definir</option>
              <option value="14x14">14x14</option>
              <option value="10x10">10x10</option>
              <option value="7x7">7x7</option>
              <option value="4x3">4x3</option>
            </select>
          </div>
          <div>
            <label htmlFor="shiftStartDate">Inicio del turno</label>
            <input id="shiftStartDate" name="shiftStartDate" type="date" defaultValue={defaults.shiftStartDate} />
          </div>
        </div>

        <div>
          <label htmlFor="profilePhotoUrl">Foto (URL)</label>
          <input id="profilePhotoUrl" name="profilePhotoUrl" defaultValue={defaults.profilePhotoUrl} placeholder="https://..." />
        </div>

        <div className="grid two">
          <div>
            <label htmlFor="emergencyContactName">Contacto de emergencia</label>
            <input id="emergencyContactName" name="emergencyContactName" defaultValue={defaults.emergencyContactName} />
          </div>
          <div>
            <label htmlFor="emergencyContactPhone">Telefono emergencia</label>
            <input id="emergencyContactPhone" name="emergencyContactPhone" defaultValue={defaults.emergencyContactPhone} />
          </div>
        </div>

        {state.error ? <div className="alert error">{state.error}</div> : null}
        {state.success ? <div className="alert success">{state.success}</div> : null}
        <SaveButton />
      </form>

      <form action={passwordAction} className="card grid">
        <h2 style={{ margin: 0 }}>Cambiar contraseña</h2>
        <div className="grid two">
          <div>
            <label htmlFor="currentPassword">Contraseña actual</label>
            <input id="currentPassword" name="currentPassword" type="password" required />
          </div>
          <div>
            <label htmlFor="newPassword">Nueva contraseña</label>
            <input id="newPassword" name="newPassword" type="password" minLength={8} required />
          </div>
          <div>
            <label htmlFor="confirmPassword">Confirmar nueva contraseña</label>
            <input id="confirmPassword" name="confirmPassword" type="password" minLength={8} required />
          </div>
        </div>

        {passwordState.error ? <div className="alert error">{passwordState.error}</div> : null}
        {passwordState.success ? <div className="alert success">{passwordState.success}</div> : null}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <PasswordButton />
        </div>
      </form>
    </div>
  );
}
