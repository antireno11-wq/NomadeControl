"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { createUserAction, type CreateUserFormState } from "@/app/administracion/actions";
import { ModulesChooser } from "@/components/modules-chooser";

// Tiene que matchear ALL_MODULES de auth.ts
const ALL_MODULES_CLIENT = [
  { key: "operaciones",  label: "Operaciones",      description: "Dashboard de campamentos e histórico" },
  { key: "tareas",       label: "Tareas",            description: "Gestión de tareas" },
  { key: "hsec",         label: "HSEC / Prevención", description: "Incidentes y matrices de riesgo" },
  { key: "trabajadores", label: "Trabajadores",      description: "Inducciones y Control EPP" },
  { key: "bodega",       label: "Bodega",            description: "Stock y movimientos de bodega" },
  { key: "vehiculos",    label: "Vehículos",         description: "Control vehicular" },
  { key: "biblioteca",   label: "Biblioteca",        description: "Documentos y recursos" },
];

const ADMIN_ROLES_CLIENT = ["ADMINISTRADOR", "ADMIN_LIMITADO"];

type CampOption = { id: string; name: string };

const initialState: CreateUserFormState = { error: "", success: "" };

function SubmitButton() {
  const { pending } = useFormStatus();
  return <button type="submit">{pending ? "Creando..." : "Crear usuario"}</button>;
}

export function NewUserForm({ camps, canAssignFullAdmin }: { camps: CampOption[]; canAssignFullAdmin: boolean }) {
  const [state, formAction] = useFormState(createUserAction, initialState);
  const [selectedRole, setSelectedRole] = useState("SUPERVISOR");

  const isAdmin = ADMIN_ROLES_CLIENT.includes(selectedRole);

  return (
    <form action={formAction} className="grid two">
      <div>
        <label htmlFor="new-name">Nombre</label>
        <input id="new-name" name="name" required />
      </div>
      <div>
        <label htmlFor="new-email">Correo</label>
        <input id="new-email" name="email" type="email" required />
      </div>
      <div>
        <label htmlFor="new-role">Rol</label>
        <select
          id="new-role"
          name="role"
          defaultValue="SUPERVISOR"
          onChange={(e) => setSelectedRole(e.target.value)}
        >
          <option value="SUPERVISOR">SUPERVISOR</option>
          {canAssignFullAdmin ? <option value="ADMINISTRADOR">ADMINISTRADOR</option> : null}
          <option value="ADMIN_LIMITADO">ADMIN LIMITADO</option>
          <option value="VEHICULOS">SOLO VEHÍCULOS</option>
          <option value="OFICINA">OFICINA</option>
          <option value="COLABORADOR">COLABORADOR</option>
        </select>
      </div>
      <div>
        <label htmlFor="new-camp">Campamento</label>
        <select id="new-camp" name="campId" defaultValue="none">
          <option value="none">Sin asignar</option>
          {camps.map((camp) => (
            <option key={camp.id} value={camp.id}>
              {camp.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="new-password">Contraseña inicial</label>
        <input id="new-password" name="password" type="password" minLength={8} required />
      </div>
      <div>
        <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 28 }}>
          <input type="checkbox" name="sendWelcomeEmail" style={{ width: "auto", padding: 0 }} />
          Enviar credenciales por correo (opcional)
        </label>
      </div>

      {/* ── Módulos ─────────────────────────────────────────────────── */}
      <div style={{ gridColumn: "1 / -1", marginTop: 8 }}>
        <label style={{ display: "block", marginBottom: 8, fontWeight: 600 }}>
          Acceso a módulos
        </label>
        {isAdmin ? (
          <div style={{ padding: "12px 16px", borderRadius: 8, background: "#eff6ff", border: "1px solid #bfdbfe", fontSize: "0.875rem", color: "#1d4ed8" }}>
            Los administradores tienen acceso total a todos los módulos.
          </div>
        ) : (
          <>
            <p style={{ color: "var(--muted)", fontSize: "0.8rem", margin: "0 0 0.75rem" }}>
              Elige los módulos que este usuario puede ver. Los permisos son independientes del rol asignado.
            </p>
            <ModulesChooser
              modules={ALL_MODULES_CLIENT}
              initialChecked={[]}
            />
          </>
        )}
      </div>

      {state.error ? <div className="alert error" style={{ gridColumn: "1 / -1" }}>{state.error}</div> : null}
      {state.success ? <div className="alert success" style={{ gridColumn: "1 / -1" }}>{state.success}</div> : null}

      <div style={{ display: "flex", alignItems: "end" }}>
        <SubmitButton />
      </div>
    </form>
  );
}
