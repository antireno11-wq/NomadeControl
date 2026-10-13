"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { logAuditEvent } from "@/lib/audit";
import { roleLabel } from "@/lib/auth";
import { sendRecuperacionClaveEmail } from "@/lib/mailer";
import {
  LARGO_MINIMO_CLAVE, MAX_PEDIDOS_POR_HORA, MINUTOS_VIGENCIA,
  huellaToken, nuevoToken, recuperacionVigente,
} from "@/lib/recuperacion-clave";

export type EstadoPedido = { enviado: boolean; error: string };

/**
 * Pide el enlace para cambiar la contraseña.
 *
 * Responde lo mismo exista o no el correo. Decir "ese correo no está
 * registrado" le sirve a quien quiere saber quién tiene cuenta, no a quien
 * olvidó su clave: esa persona sabe cuál es su correo.
 */
export async function pedirRecuperacionAction(_: EstadoPedido, formData: FormData): Promise<EstadoPedido> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { enviado: false, error: "Escribe un correo válido." };
  }

  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true, role: true, isActive: true },
  });

  if (user?.isActive) {
    const haceUnaHora = new Date(Date.now() - 60 * 60 * 1000);
    const recientes = await db.recuperacionClave.count({
      where: { userId: user.id, createdAt: { gte: haceUnaHora } },
    });

    if (recientes < MAX_PEDIDOS_POR_HORA) {
      const token = nuevoToken();
      await db.recuperacionClave.create({
        data: {
          userId: user.id,
          tokenHash: huellaToken(token),
          expiresAt: new Date(Date.now() + MINUTOS_VIGENCIA * 60 * 1000),
        },
      });

      const base = process.env.APP_URL ?? "https://control.nomadechile.cl";
      const envio = await sendRecuperacionClaveEmail({
        to: user.email,
        nombre: user.name.split(" ")[0] || user.name,
        enlace: `${base}/recuperar/${token}`,
        tipoAcceso: roleLabel(user.role),
        minutosVigencia: MINUTOS_VIGENCIA,
      });

      await logAuditEvent({
        actorUserId: user.id, actorName: user.name, actorEmail: user.email,
        action: "CLAVE_RECUPERACION_PEDIDA", entityType: "user", entityId: user.id,
        summary: envio.ok
          ? "Pidió el enlace para cambiar su contraseña"
          : `Pidió el enlace para cambiar su contraseña, pero el correo no salió: ${envio.error}`,
      }).catch(() => {});

      // Si el correo no sale, la persona va a esperar un enlace que no llega.
      // No se le puede decir sin revelar que la cuenta existe, así que queda
      // en la auditoría y en el registro del servidor para que alguien lo vea.
      if (!envio.ok) console.error("[recuperar-clave] no se pudo enviar el correo:", envio.error);
    }
  }

  return { enviado: true, error: "" };
}

export type EstadoCambio = { error: string };

/** Cambia la contraseña con el enlace del correo. */
export async function cambiarClaveAction(_: EstadoCambio, formData: FormData): Promise<EstadoCambio> {
  const token = String(formData.get("token") ?? "");
  const clave = String(formData.get("clave") ?? "");
  const repetida = String(formData.get("repetida") ?? "");

  const pedido = await recuperacionVigente(token);
  if (!pedido) {
    return { error: "El enlace ya no sirve: venció o ya se usó. Pide uno nuevo." };
  }
  if (clave.length < LARGO_MINIMO_CLAVE) {
    return { error: `La contraseña tiene que tener al menos ${LARGO_MINIMO_CLAVE} caracteres.` };
  }
  if (clave !== repetida) {
    return { error: "Las dos contraseñas no coinciden." };
  }

  const passwordHash = await bcrypt.hash(clave, 10);

  await db.$transaction([
    db.user.update({ where: { id: pedido.userId }, data: { passwordHash } }),
    // El enlace usado y cualquier otro que haya quedado vigente: si alguien
    // pidió varios, ninguno sirve después de que uno funcionó.
    db.recuperacionClave.updateMany({
      where: { userId: pedido.userId, usadoAt: null },
      data: { usadoAt: new Date() },
    }),
    // Se cierran las sesiones abiertas. Si se cambió la clave porque alguien
    // más la conocía, esa persona no puede seguir adentro con la sesión vieja.
    db.session.deleteMany({ where: { userId: pedido.userId } }),
  ]);

  await logAuditEvent({
    actorUserId: pedido.userId, actorName: pedido.user.name, actorEmail: pedido.user.email,
    action: "CLAVE_CAMBIADA_POR_ENLACE", entityType: "user", entityId: pedido.userId,
    summary: "Cambió su contraseña con el enlace de recuperación. Se cerraron sus sesiones abiertas.",
  }).catch(() => {});

  redirect("/login?status=clave-cambiada");
}
