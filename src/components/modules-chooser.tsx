"use client";

import { useState } from "react";

export type ModuleEntry = {
  key: string;
  label: string;
  description: string;
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
  initialChecked,
}: {
  modules: ModuleEntry[];
  initialChecked: string[];
}) {
  const defaultState = () => {
    const map: Record<string, boolean> = {};
    for (const m of modules) {
      map[m.key] = initialChecked.includes(m.key);
    }
    return map;
  };

  const [checked, setChecked] = useState<Record<string, boolean>>(defaultState);

  const toggle = (key: string) => {
    setChecked(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: "0.6rem" }}>
      {modules.map((mod) => {
        const isOn = checked[mod.key];
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
              border: `1px solid ${isOn ? chip.bg : "#e2e8f0"}`,
              cursor: "pointer",
              background: isOn ? chip.bg + "66" : "white",
              userSelect: "none",
            }}
          >
            <input
              type="checkbox"
              name={`mod_${mod.key}`}
              checked={isOn}
              readOnly
              style={{ marginTop: 3, pointerEvents: "none" }}
            />
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.875rem", color: "var(--text)" }}>
                {mod.label}
              </div>
              <div style={{ fontSize: "0.72rem", marginTop: 1, color: "var(--muted)" }}>
                {mod.description}
              </div>
            </div>
          </label>
        );
      })}
    </div>
  );
}
