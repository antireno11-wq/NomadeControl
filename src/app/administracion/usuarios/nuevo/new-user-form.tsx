"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { createUserAction, type CreateUserFormState } from "@/app/administracion/actions";
import { ModulesChooser } from "@/components/modules-chooser";

const ALL_MODULES_CLIENT = [
  { key: "operaciones",  label: "Operaciones",      description: "Dashboard de campamentos e histórico" },
  { key: "tareas",       label: "Tareas",            description: "Gestión de tareas" },
  { key: "hsec",         label: "HSEC / Prevención", description: "Incidentes y matrices de riesgo" },
  { key: "trabajadores", label: "Trabajadores",      description: "Inducciones y Control EPP" },
  { key: "bodega",       label: "Bodega",            description: "Stock y movimientos de bodega" },
  { key: "vehiculos",    label: "Vehículos",         description: "Control vehicular" },
  { key: "biblioteca",   label: "Biblioteca",        description: "Documentos y recursos" },
];

const ROLES = [
  {
    value: "SUPERVISOR",
    label: "Supervisor",
    icon: "👷",
    description: "Operaciones, HSEC, trabajadores y tareas del campamento",
    adminOnly: false,
  },
  {
    value: "OPERADOR",
    label: "Operador",
    icon: "🔧",
    description: "Acceso operativo básico: operaciones, tareas, bodega y HSEC",
    adminOnly: false,
  },
  {
    value: "OFICINA",
    label: "Oficina",
    icon: "📋",
    description: "Tareas y biblioteca de documentos",
    adminOnly: false,
  },
  {
    value: "COLABORADOR",
    label: "Colaborador",
    icon: "👤",
    description: "Solo tareas asignadas y biblioteca",
    adminOnly: false,
  },
  {
    value: "VEHICULOS",
    label: "Solo vehículos",
    icon: "🚗",
    description: "Acceso exclusivo al módulo de vehículos",
    adminOnly: false,
  },
  {
    value: "RRHH",
    label: "Recursos Humanos",
    icon: "🧑‍💼",
    description: "Gestión de trabajadores, documentos, EPP e inducciones",
    adminOnly: false,
  },
  {
    value: "ADMIN_LIMITADO",
    label: "Admin limitado",
    icon: "🔒",
    description: "Gestión de usuarios y módulos operativos, sin eliminar datos",
    adminOnly: false,
  },
  {
    value: "ADMINISTRADOR",
    label: "Administrador",
    icon: "⚙️",
    description: "Acceso total al sistema, incluyendo configuración",
    adminOnly: true,
  },
];

const ADMIN_VALUES = ["ADMINISTRADOR", "ADMIN_LIMITADO"];

// Módulos pre-seleccionados por rol al crear usuario
const DEFAULT_MODULES_BY_ROLE: Record<string, string[]> = {
  RRHH: ["trabajadores", "tareas", "biblioteca"],
};

type CampOption = { id: string; name: string };
const initialState: CreateUserFormState = { error: "", success: "" };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      style={{
        padding: "13px 32px",
        fontSize: "1rem",
        fontWeight: 700,
        borderRadius: 12,
        background: pending ? "#ccc" : "var(--accent)",
        cursor: pending ? "not-allowed" : "pointer",
        width: "auto",
        minWidth: 180,
      }}
    >
      {pending ? "Creando usuario…" : "Crear usuario"}
    </button>
  );
}

export function NewUserForm({
  camps,
  canAssignFullAdmin,
}: {
  camps: CampOption[];
  canAssignFullAdmin: boolean;
}) {
  const [state, formAction] = useFormState(createUserAction, initialState);
  const [selectedRole, setSelectedRole] = useState("SUPERVISOR");
  const [showPassword, setShowPassword] = useState(false);

  const isAdmin = ADMIN_VALUES.includes(selectedRole);
  const visibleRoles = ROLES.filter((r) => !r.adminOnly || canAssignFullAdmin);

  return (
    <form action={formAction}>
      <div className="page-stack">

        {/* ── 1. Información personal ─────────────────────────────────── */}
        <div className="card">
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
            <div style={{
              width: 32, height: 32, borderRadius: "50%",
              background: "linear-gradient(135deg, var(--teal), #00a6b6)",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "white", fontWeight: 800, fontSize: "0.85rem", flexShrink: 0,
            }}>1</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: "1rem", color: "var(--text)" }}>Información personal</div>
              <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Nombre completo y correo de acceso</div>
            </div>
          </div>

          <div className="grid two">
            <div>
              <label htmlFor="new-name">Nombre completo</label>
              <input
                id="new-name"
                name="name"
                required
                placeholder="Ej: María González"
                style={{ fontSize: "1rem" }}
              />
            </div>
            <div>
              <label htmlFor="new-email">Correo electrónico</label>
              <input
                id="new-email"
                name="email"
                type="email"
                required
                placeholder="usuario@empresa.cl"
                style={{ fontSize: "1rem" }}
              />
            </div>
          </div>
        </div>

        {/* ── 2. Rol ──────────────────────────────────────────────────── */}
        <div className="card">
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
            <div style={{
              width: 32, height: 32, borderRadius: "50%",
              background: "linear-gradient(135deg, var(--teal), #00a6b6)",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "white", fontWeight: 800, fontSize: "0.85rem", flexShrink: 0,
            }}>2</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: "1rem", color: "var(--text)" }}>Rol del usuario</div>
              <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Define qué puede hacer dentro del sistema</div>
            </div>
          </div>

          {/* Input hidden que se envía con el form */}
          <input type="hidden" name="role" value={selectedRole} />

          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: "10px",
          }}>
            {visibleRoles.map((role) => {
              const isSelected = selectedRole === role.value;
              return (
                <button
                  key={role.value}
                  type="button"
                  onClick={() => setSelectedRole(role.value)}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "12px",
                    padding: "14px 16px",
                    borderRadius: 12,
                    border: isSelected ? "2px solid var(--teal)" : "1.5px solid var(--border)",
                    background: isSelected
                      ? "linear-gradient(135deg, rgba(0,104,120,0.07), rgba(0,166,182,0.05))"
                      : "white",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "all 0.15s ease",
                    boxShadow: isSelected ? "0 0 0 3px rgba(0,104,120,0.1)" : "none",
                    width: "100%",
                  }}
                >
                  <div style={{
                    width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                    background: isSelected ? "rgba(0,104,120,0.12)" : "#f1f5f9",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "1.2rem",
                  }}>
                    {role.icon}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      fontWeight: 700, fontSize: "0.9rem",
                      color: isSelected ? "var(--teal)" : "var(--text)",
                      marginBottom: 3,
                    }}>
                      {role.label}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "var(--muted)", lineHeight: 1.4 }}>
                      {role.description}
                    </div>
                  </div>
                  {isSelected && (
                    <div style={{
                      marginLeft: "auto", flexShrink: 0,
                      width: 20, height: 20, borderRadius: "50%",
                      background: "var(--teal)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: "white", fontSize: "0.7rem", fontWeight: 800,
                    }}>✓</div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── 3. Asignación y acceso ───────────────────────────────────── */}
        <div className="card">
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
            <div style={{
              width: 32, height: 32, borderRadius: "50%",
              background: "linear-gradient(135deg, var(--teal), #00a6b6)",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "white", fontWeight: 800, fontSize: "0.85rem", flexShrink: 0,
            }}>3</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: "1rem", color: "var(--text)" }}>Asignación y acceso</div>
              <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Campamento, contraseña y notificaciones</div>
            </div>
          </div>

          <div className="grid two">
            <div>
              <label htmlFor="new-camp">Campamento asignado</label>
              <select id="new-camp" name="campId" defaultValue="none">
                <option value="none">Sin asignar</option>
                {camps.map((camp) => (
                  <option key={camp.id} value={camp.id}>{camp.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="new-password">Contraseña inicial</label>
              <div style={{ position: "relative" }}>
                <input
                  id="new-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  minLength={8}
                  required
                  placeholder="Mínimo 8 caracteres"
                  style={{ paddingRight: 44 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  style={{
                    position: "absolute", right: 10, top: "50%",
                    transform: "translateY(-50%)",
                    width: "auto", padding: "4px 6px",
                    background: "none", color: "var(--muted)",
                    border: "none", fontSize: "1rem", cursor: "pointer",
                  }}
                  tabIndex={-1}
                >
                  {showPassword ? "🙈" : "👁️"}
                </button>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", paddingTop: 8 }}>
              <label style={{
                display: "flex", alignItems: "center", gap: 10,
                cursor: "pointer", fontWeight: 500, color: "var(--text)",
                padding: "12px 14px",
                borderRadius: 10, border: "1px solid var(--border)",
                background: "#f8fcfc", width: "100%", margin: 0,
              }}>
                <input
                  type="checkbox"
                  name="sendWelcomeEmail"
                  style={{ width: "auto", padding: 0, margin: 0, flexShrink: 0 }}
                />
                <div>
                  <div style={{ fontWeight: 600, fontSize: "0.875rem" }}>Enviar credenciales por correo</div>
                  <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: 1 }}>
                    Le llegará el correo y contraseña al usuario
                  </div>
                </div>
              </label>
            </div>
          </div>
        </div>

        {/* ── 4. Módulos ───────────────────────────────────────────────── */}
        <div className="card">
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
            <div style={{
              width: 32, height: 32, borderRadius: "50%",
              background: "linear-gradient(135deg, var(--teal), #00a6b6)",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "white", fontWeight: 800, fontSize: "0.85rem", flexShrink: 0,
            }}>4</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: "1rem", color: "var(--text)" }}>Acceso a módulos</div>
              <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                {isAdmin
                  ? "Los administradores tienen acceso completo a todos los módulos"
                  : "Selecciona los módulos que este usuario puede ver"}
              </div>
            </div>
          </div>

          {isAdmin ? (
            <div style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "14px 16px", borderRadius: 10,
              background: "linear-gradient(135deg, rgba(0,104,120,0.07), rgba(0,166,182,0.04))",
              border: "1px solid rgba(0,104,120,0.2)",
            }}>
              <span style={{ fontSize: "1.3rem" }}>🔓</span>
              <div style={{ fontSize: "0.875rem", color: "var(--teal)", fontWeight: 600 }}>
                Acceso total habilitado — todos los módulos están disponibles para este rol
              </div>
            </div>
          ) : (
            <ModulesChooser
              modules={ALL_MODULES_CLIENT}
              initialChecked={DEFAULT_MODULES_BY_ROLE[selectedRole] ?? []}
              key={selectedRole}
            />
          )}
        </div>

        {/* ── Errores / éxito + submit ─────────────────────────────────── */}
        {state.error && (
          <div className="alert error">{state.error}</div>
        )}
        {state.success && (
          <div className="alert success">{state.success}</div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <SubmitButton />
        </div>

      </div>
    </form>
  );
}
