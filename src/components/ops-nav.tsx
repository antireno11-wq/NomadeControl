import Link from "next/link";

export type NavKey = "dashboard" | "carga" | "check" | "bodega" | "hsec" | "administracion";

const navItems: Array<{ key: NavKey; href: string; label: string; adminOnly?: boolean }> = [
  { key: "dashboard", href: "/dashboard", label: "Dashboard", adminOnly: true },
  { key: "carga", href: "/carga-diaria", label: "Cargar información" },
  { key: "check", href: "/check-campamento", label: "Check campamento" },
  { key: "bodega", href: "/bodega", label: "Bodega" },
  { key: "hsec", href: "/hsec", label: "HSEC" },
  { key: "administracion", href: "/administracion", label: "Administración", adminOnly: true }
];

export function OpsNav({
  active,
  showAdminSections = true,
  showLoadSection = true
}: {
  active: NavKey;
  showAdminSections?: boolean;
  showLoadSection?: boolean;
}) {
  const visibleItems = (showAdminSections ? navItems : navItems.filter((item) => !item.adminOnly)).filter((item) =>
    showLoadSection ? true : item.key !== "carga"
  );
  return (
    <nav className="top-menu">
      {visibleItems.map((item) => (
        <Link key={item.key} href={item.href} className={`menu-item ${item.key === active ? "active" : ""}`}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
