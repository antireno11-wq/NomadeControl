import Link from "next/link";

export type NavChild = { href: string; label: string };
export type NavEntry =
  | { type: "link"; href: string; label: string; navKey: string | null; active: boolean }
  // El tipo "group" queda solo por compatibilidad de imports históricos.
  // Las sub-secciones se renderizan como tabs dentro de cada página
  // (ver `components/section-tabs.tsx` + `lib/section-nav.ts`).
  | { type: "group"; label: string; navKey: string; children: NavChild[]; anyChildActive: boolean };

export function NavMenu({ items }: { items: NavEntry[] }) {
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

        // Fallback: si quedara algún grupo, lo aplanamos a un solo link al primer hijo.
        const firstChild = item.children[0];
        if (!firstChild) return null;
        return (
          <Link
            key={item.navKey}
            href={firstChild.href}
            className={`dashboard-nav-link ${item.anyChildActive ? "active" : ""}`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
