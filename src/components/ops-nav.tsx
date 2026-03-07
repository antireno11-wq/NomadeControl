import Link from "next/link";

type NavKey = "dashboard" | "carga" | "check" | "bodega" | "hsec" | "administracion";

const navItems: Array<{ key: NavKey; href: string; label: string }> = [
  { key: "dashboard", href: "/dashboard", label: "Dashboard" },
  { key: "carga", href: "/carga-diaria", label: "Cargar información" },
  { key: "check", href: "/check-campamento", label: "Check campamento" },
  { key: "bodega", href: "/bodega", label: "Bodega" },
  { key: "hsec", href: "/hsec", label: "HSEC" },
  { key: "administracion", href: "/administracion", label: "Administración" }
];

export function OpsNav({ active }: { active: NavKey }) {
  return (
    <nav className="top-menu">
      {navItems.map((item) => (
        <Link key={item.key} href={item.href} className={`menu-item ${item.key === active ? "active" : ""}`}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

