"use server";

import { redirect } from "next/navigation";
import { requireRole, ADMIN_ROLES } from "@/lib/auth";
import { db } from "@/lib/db";

export async function crearCursoAction(formData: FormData) {
  const user = await requireRole(ADMIN_ROLES);

  const titulo = String(formData.get("titulo") ?? "").trim();
  const descripcion = String(formData.get("descripcion") ?? "").trim() || null;
  const contenido = String(formData.get("contenido") ?? "").trim();
  const tiempoEstimadoMin = parseInt(String(formData.get("tiempoEstimadoMin") ?? "30"));

  if (!titulo || !contenido) redirect("/trabajadores/cursos/nuevo?error=campos");

  // Recoger preguntas (hasta 20)
  const preguntas: { pregunta: string; opciones: string[]; respuestaCorrecta: number; orden: number }[] = [];
  for (let i = 0; i < 20; i++) {
    const pregunta = String(formData.get(`pregunta_${i}`) ?? "").trim();
    if (!pregunta) continue;
    const opciones = [0, 1, 2, 3].map((j) => String(formData.get(`opcion_${i}_${j}`) ?? "").trim()).filter(Boolean);
    if (opciones.length < 2) continue;
    const respuestaCorrecta = parseInt(String(formData.get(`correcta_${i}`) ?? "0"));
    preguntas.push({ pregunta, opciones, respuestaCorrecta, orden: i });
  }

  const curso = await db.curso.create({
    data: {
      titulo,
      descripcion,
      contenido,
      tiempoEstimadoMin: isNaN(tiempoEstimadoMin) ? 30 : tiempoEstimadoMin,
      createdById: user.id,
      preguntas: {
        create: preguntas.map((p) => ({
          pregunta: p.pregunta,
          opciones: p.opciones,
          respuestaCorrecta: p.respuestaCorrecta,
          orden: p.orden,
        })),
      },
    },
  });

  redirect(`/trabajadores/cursos/${curso.id}?status=created`);
}
