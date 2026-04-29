"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireRole, EVALUACIONES_ROLES } from "@/lib/auth";

function calcPuntaje(scores: (number | null | undefined)[]): number | null {
  const valid = scores.filter((s): s is number => typeof s === "number" && s >= 1 && s <= 5);
  if (valid.length === 0) return null;
  return Math.round((valid.reduce((a, b) => a + b, 0) / valid.length) * 10) / 10;
}

function intOrNull(v: FormDataEntryValue | null): number | null {
  if (!v) return null;
  const n = parseInt(v as string, 10);
  return isNaN(n) ? null : n;
}

function strOrNull(v: FormDataEntryValue | null): string | null {
  if (!v) return null;
  const s = (v as string).trim();
  return s === "" ? null : s;
}

export async function guardarEvaluacionAction(formData: FormData) {
  const user = await requireRole(EVALUACIONES_ROLES);

  const evaluadoNombre = (formData.get("evaluadoNombre") as string)?.trim();
  if (!evaluadoNombre) redirect("/evaluaciones?status=invalid");

  const scores = {
    planificacion:      intOrNull(formData.get("planificacion")),
    iniciativa:         intOrNull(formData.get("iniciativa")),
    cooperacion:        intOrNull(formData.get("cooperacion")),
    responsabilidad:    intOrNull(formData.get("responsabilidad")),
    convivenciaLaboral: intOrNull(formData.get("convivenciaLaboral")),
    comunicacionSeg:    intOrNull(formData.get("comunicacionSeg")),
    indumentaria:       intOrNull(formData.get("indumentaria")),
    elaboracionDocs:    intOrNull(formData.get("elaboracionDocs")),
    reportabilidad:     intOrNull(formData.get("reportabilidad")),
    gestionAmbiente:    intOrNull(formData.get("gestionAmbiente")),
  };

  const puntajeTotal = calcPuntaje(Object.values(scores));
  const estado = formData.get("accion") === "completar" ? "completada" : "borrador";

  const data = {
    evaluadoNombre,
    evaluadoCargo:    strOrNull(formData.get("evaluadoCargo")),
    periodo:          (formData.get("periodo") as string)?.trim() || "",
    proyecto:         strOrNull(formData.get("proyecto")),
    evaluadorNombre:  user.name,
    evaluadorId:      user.id,
    ...scores,
    comentPlanificacion:   strOrNull(formData.get("comentPlanificacion")),
    comentIniciativa:      strOrNull(formData.get("comentIniciativa")),
    comentCooperacion:     strOrNull(formData.get("comentCooperacion")),
    comentResponsabilidad: strOrNull(formData.get("comentResponsabilidad")),
    comentConvivencia:     strOrNull(formData.get("comentConvivencia")),
    comentComunicacion:    strOrNull(formData.get("comentComunicacion")),
    comentIndumentaria:    strOrNull(formData.get("comentIndumentaria")),
    comentElaboracion:     strOrNull(formData.get("comentElaboracion")),
    comentReportabilidad:  strOrNull(formData.get("comentReportabilidad")),
    comentGestion:         strOrNull(formData.get("comentGestion")),
    puntajeTotal,
    oportunidadesMejora:  strOrNull(formData.get("oportunidadesMejora")),
    mantenerCargo:        strOrNull(formData.get("mantenerCargo")),
    reubicar:             strOrNull(formData.get("reubicar")),
    promocion:            strOrNull(formData.get("promocion")),
    reconocimiento:       strOrNull(formData.get("reconocimiento")),
    requiereCapacitacion: strOrNull(formData.get("requiereCapacitacion")),
    observacionesFinales: strOrNull(formData.get("observacionesFinales")),
    estado,
  };

  const evalId = strOrNull(formData.get("evalId"));

  if (evalId) {
    await db.evaluacion.update({ where: { id: evalId }, data });
    revalidatePath("/evaluaciones");
    redirect(`/evaluaciones/${evalId}?status=updated`);
  } else {
    const created = await db.evaluacion.create({ data });
    revalidatePath("/evaluaciones");
    redirect(`/evaluaciones/${created.id}?status=created`);
  }
}

export async function eliminarEvaluacionAction(formData: FormData) {
  await requireRole(EVALUACIONES_ROLES);
  const id = formData.get("id") as string;
  if (!id) return;
  await db.evaluacion.delete({ where: { id } });
  revalidatePath("/evaluaciones");
  redirect("/evaluaciones?status=deleted");
}
