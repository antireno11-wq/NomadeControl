import crypto from "crypto";
import { db } from "@/lib/db";

/** Cuánto dura el enlace. Corto a propósito: es una llave de la cuenta. */
export const MINUTOS_VIGENCIA = 60;

/** Pedidos por persona y por hora. Más que eso es alguien llenándole la bandeja. */
export const MAX_PEDIDOS_POR_HORA = 3;

export const LARGO_MINIMO_CLAVE = 8;

/** La huella que se guarda. El token en sí solo viaja en el correo. */
export function huellaToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function nuevoToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * El pedido de recuperación al que corresponde un token, si sigue sirviendo.
 *
 * `null` cuando no existe, ya se usó, venció, o la cuenta está desactivada: a
 * quien abre el enlace se le dice lo mismo en los cuatro casos, porque la
 * diferencia solo le sirve a quien está probando enlaces ajenos.
 */
export async function recuperacionVigente(token: string) {
  if (!token || token.length < 20) return null;
  const fila = await db.recuperacionClave.findUnique({
    where: { tokenHash: huellaToken(token) },
    select: {
      id: true, userId: true, expiresAt: true, usadoAt: true,
      user: { select: { name: true, email: true, isActive: true } },
    },
  });
  if (!fila || fila.usadoAt || fila.expiresAt.getTime() < Date.now() || !fila.user.isActive) return null;
  return fila;
}
