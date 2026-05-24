"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavChild = { href: string; label: string };
export type NavEntry =
  | { type: "link"; href: string; label: string; navKey: string | null; active: boolean }
  | { type: "group"; label: string; navKey: string; children: NavChild[]; anyChildActive: boolean };

export function NavMenu({ items }: { items: NavEntry[] }) {
  const pathname = usePathname();

  return (
    <nav className="dashboard-nav">
      {items.map((item) => {
        if (item.type === "link") {
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`dashboard-nav-link ${item.active ? "active" : ""}`}
            >
              {item.label}
            </Link>
          );
        }

        // Group → etiqueta padre + hijos anidados visualmente (sin desplegable)
        return (
          <div key={item.navKey} style={{ display: "grid", gap: 2 }}>
            <div
              className={`dashboard-nav-link ${item.anyChildActive ? "active" : ""}`}
              style={{ cursor: "default", fontWeight: 700 }}
            >
              {item.label}
            </div>
            <div
              style={{
                display: "grid",
                gap: 2,
                marginLeft: 10,
                paddingLeft: 10,
                borderLeft: "2px solid var(--border)",
              }}
            >
              {item.children.map((child) => {
                const childActive = pathname === child.href || pathname.startsWith(child.href + "/");
                return (
                  <Link
                    key={child.href}
                    href={child.href}
                    className={`dashboard-nav-link ${childActive ? "active" : ""}`}
                    style={{ padding: "6px 12px", fontSize: "0.88rem" }}
                  >
                    {child.label}
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}
