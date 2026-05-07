"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavChild = { href: string; label: string };
export type NavEntry =
  | { type: "link"; href: string; label: string; navKey: string | null; active: boolean }
  | { type: "group"; label: string; navKey: string; children: NavChild[]; anyChildActive: boolean };

export function NavMenu({ items }: { items: NavEntry[] }) {
  const pathname = usePathname();

  // Initialize open state: open any group that has an active child
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const item of items) {
      if (item.type === "group" && item.anyChildActive) {
        initial[item.navKey] = true;
      }
    }
    return initial;
  });

  // Re-evaluate when pathname changes
  useEffect(() => {
    setOpenGroups((prev) => {
      const next = { ...prev };
      for (const item of items) {
        if (item.type === "group" && item.anyChildActive) {
          next[item.navKey] = true;
        }
      }
      return next;
    });
  }, [pathname, items]);

  function toggle(key: string) {
    setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  }

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

        // Group
        const isOpen = openGroups[item.navKey] ?? false;
        return (
          <div key={item.navKey}>
            <button
              onClick={() => toggle(item.navKey)}
              className={`dashboard-nav-link ${item.anyChildActive ? "active" : ""}`}
              style={{
                width: "100%",
                background: "none",
                border: "none",
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                textAlign: "left",
                fontFamily: "inherit",
                fontSize: "inherit",
              }}
            >
              <span>{item.label}</span>
              <span style={{ fontSize: "0.7rem", opacity: 0.6, transition: "transform 0.2s", display: "inline-block", transform: isOpen ? "rotate(180deg)" : "rotate(0deg)" }}>
                ▼
              </span>
            </button>
            {isOpen && (
              <div style={{ display: "grid", gap: 2, marginTop: 2, paddingLeft: 8 }}>
                {item.children.map((child) => {
                  const childActive = pathname === child.href || pathname.startsWith(child.href + "/");
                  return (
                    <Link
                      key={child.href}
                      href={child.href}
                      className={`dashboard-nav-link ${childActive ? "active" : ""}`}
                      style={{ padding: "8px 14px", fontSize: "0.875rem" }}
                    >
                      {child.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
