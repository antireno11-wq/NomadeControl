"use client";

import { useFormState, useFormStatus } from "react-dom";
import { saveProfileAction, type ProfileFormState } from "./actions";

type ProfileDefaults = {
  name: string;
  email: string;
  phone: string;
  positionTitle: string;
  profilePhotoUrl: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
};

const initialState: ProfileFormState = { error: "", success: "" };

function SaveButton() {
  const { pending } = useFormStatus();
  return <button type="submit">{pending ? "Guardando..." : "Guardar perfil"}</button>;
}

export function ProfileForm({ defaults }: { defaults: ProfileDefaults }) {
  const [state, formAction] = useFormState(saveProfileAction, initialState);

  return (
    <form action={formAction} className="card grid" style={{ maxWidth: 760 }}>
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
  );
}
