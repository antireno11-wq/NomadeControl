import { NextResponse, type NextRequest } from "next/server";
import { ENABLED_MODULES } from "@/lib/modules-config";

/**
 * Middleware: redirige a `/` cualquier navegación a un módulo deshabilitado.
 *
 * NOTA: no bloquea el acceso — solo redirige por comodidad de UX. Los
 * endpoints internos (POST forms, server actions, /api/*) siguen operando
 * normalmente para no romper flujos existentes.
 */

// Prefijos de ruta por cada módulo, en orden de especificidad (más específico
// primero para evitar colisiones tipo /trabajadores/... vs /trabajadores).
const MODULE_ROUTES: Array<{ module: keyof typeof ENABLED_MODULES; prefixes: string[] }> = [
  { module: "dashboard",    prefixes: ["/dashboard"] },
  { module: "tareas",       prefixes: ["/gestion-tareas"] },
  { module: "hsec",         prefixes: ["/hsec"] },
  { module: "biblioteca",   prefixes: ["/biblioteca"] },
];

function isPathInModule(pathname: string, prefixes: string[]) {
  return prefixes.some(p => pathname === p || pathname.startsWith(p + "/"));
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  for (const { module, prefixes } of MODULE_ROUTES) {
    if (!ENABLED_MODULES[module] && isPathInModule(pathname, prefixes)) {
      const url = req.nextUrl.clone();
      url.pathname = "/";
      url.searchParams.set("moduloDeshabilitado", module);
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  // Se aplica a todo excepto assets estáticos, API y auth (que necesita
  // seguir funcionando aunque no haya módulo activo).
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|login|logout|nomade-logo).*)",
  ],
};
