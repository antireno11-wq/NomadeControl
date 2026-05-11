"use client";

import { useState } from "react";

export type ModuleEntry = {
  key: string;
  label: string;
  description: string;
};

// Espejo cliente de los checks de auth.ts (sin imports server-only)
const ROLE_CAN_ACCESS: Record<string, string[]> = {
  ADMINISTRADOR:  ["operaciones", "tareas", "hsec", "trabajadores", "bodega", "vehiculos", "biblioteca"],
  ADMIN:          ["operaciones", "tareas", "hsec", "trabajadores", "bodega", "vehiculos", "biblioteca"],
  ADMIN_LIMITADO: ["operaciones", "tareas", "hsec", "trabajadores", "bodega", "vehiculos", "biblioteca"],
  SUPERVISOR:     ["operaciones", "tareas", "hsec", "trabajadores", "bodega"],
  OPERADOR:       ["operaciones", "tareas", "hsec", "trabajadores", "bodega"],
  VEHICULOS:      ["vehiculos"],
  OFICINA:        ["tareas", "biblioteca"],
  COLABORADOR:    ["tareas", "biblioteca"],
};

const CHIP_COLOR: Record<string, { bg: string; color: string }> = {
  operaciones:  { bg: "#dbeafe", color: "#1e40af" },
  tareas:       { bg: "#fef3c7", color: "#92400e" },
  hsec:         { bg: "#fee2e2", color: "#991b1b" },
  trabajadores: { bg: "#dcfce7", color: "#14532d" },
  bodega:       { bg: "#e0e7ff", color: "#3730a3" },
  vehiculos:    { bg: "#f3e8ff", color: "#6b21a8" },
  biblioteca:   { bg: "#fce7f3", color: "#831843" },
};

export function ModulesChooser({
  modules,
  role,
  initialChecked,
}: {
  modules: ModuleEntry[];
  /** Rol actual del usuario (puede venir de un <select> externo en el formulario padre). */
  role: string;
  /** Módulos actualmente guardados en DB. [] = usar defaults del rol. */
  initialChecked: string[];
}) {
  const accessible = ROLE_CAN_ACCESS[role] ?? [];

  // Estado inicial: si no hay lista custom → marcar los que el rol permite
  const defaultState = () => {
    const map: Record<string, boolean> = {};
    for (const m of modules) {
      map[m.key] = initialChecked.length === 0
        ? accessible.includes(m.key)
        : initialChecked.includes(m.key);
    }
    return map;
  };

  const [checked, setChecked] = useState<Record<string, boolean>>(defaultState);

  // Cuando el rol cambia (el padre re-renderiza con nuevo `role`) recalcular
  // los que estaban marcados: sólo los que el nuevo rol permite pueden quedar marcados
  const toggle = (key: string) => {
    if (!accessible.includes(key)) return;
    setChecked(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: "0.6rem" }}>
      {modules.map((mod) => {
        const canAccess = accessible.includes(mod.key);
        const isOn = canAccess && checked[mod.key];
        const chip = CHIP_COLOR[mod.key] ?? { bg: "#f1f5f9", color: "#374151" };

        return (
          <label
            key={mod.key}
            onClick={() => toggle(mod.key)}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "0.6rem",
              padding: "0.75rem 1rem",
              borderRadius: 8,
              border: `1px solid ${canAccess ? (isOn ? chip.bg : "#e2e8f0") : "#e2e8f0"}`,
              cursor: canAccess ? "pointer" : "not-allowed",
              background: canAccess ? (isOn ? chip.bg + "66" : "white") : "#f8fafc",
              opacity: canAccess ? 1 : 0.45,
              userSelect: "none",
            }}
          >
            {/* Checkbox real — se envía con el formulario */}
            <input
              type="checkbox"
              name={`mod_${mod.key}`}
              checked={isOn}
              readOnly
              disabled={!canAccess}
              style={{ marginTop: 3, pointerEvents: "none" }}
            />
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.875rem", color: canAccess ? "var(--text)" : "var(--muted)" }}>
                {mod.label}
              </div>
              <div style={{ fontSize: "0.72rem", marginTop: 1, color: canAccess ? "var(--muted)" : "#cbd5e1" }}>
                {canAccess ? mod.description : "No disponible para este rol"}
              </div>
            </div>
          </label>
        );
      })}
    </div>
  );
}
