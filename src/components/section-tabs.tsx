import Link from "next/link";

export type SectionTab = {
  href: string;
  label: string;
  active?: boolean;
};

/**
 * Sub-navegación horizontal que se renderiza al tope de las páginas
 * de una sección (Operaciones, Trabajadores, etc.). Reemplaza a los
 * desplegables que antes estaban en el menú lateral.
 */
export function SectionTabs({ items }: { items: SectionTab[] }) {
  if (items.length === 0) return null;
  return (
    <nav
      style={{
        display: "flex",
        gap: 4,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 4,
        width: "fit-content",
        flexWrap: "wrap",
        maxWidth: "100%",
      }}
    >
      {items.map((item) => (
        <Link key={item.href} href={item.href} style={{ textDecoration: "none" }}>
          <div
            style={{
              padding: "8px 16px",
              borderRadius: 9,
              fontSize: "0.88rem",
              fontWeight: item.active ? 700 : 500,
              background: item.active ? "var(--teal)" : "transparent",
              color: item.active ? "white" : "var(--muted)",
              cursor: "pointer",
              whiteSpace: "nowrap",
              transition: "background 0.15s ease, color 0.15s ease",
            }}
          >
            {item.label}
          </div>
        </Link>
      ))}
    </nav>
  );
}
