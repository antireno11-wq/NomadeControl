"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isSupervisorRole, OPERATION_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { normalizeDateOnly } from "@/lib/report-utils";

const schema = z.object({
  date: z.string().min(1),
  campId: z.string().min(1),
  itemName: z.string().trim().min(2),
  movementType: z.enum(["INGRESO", "SALIDA"]),
  quantity: z.coerce.number().positive(),
  unit: z.string().trim().min(1),
  notes: z.string().optional()
});

export type StockFormState = { error: string; success: string };

export async function saveStockMovementAction(_: StockFormState, formData: FormData): Promise<StockFormState> {
  const user = await requireRole(OPERATION_ROLES);

  const parsed = schema.safeParse({
    date: formData.get("date"),
    campId: formData.get("campId"),
    itemName: formData.get("itemName"),
    movementType: formData.get("movementType"),
    quantity: formData.get("quantity"),
    unit: formData.get("unit"),
    notes: String(formData.get("notes") ?? "")
  });

  if (!parsed.success) {
    return { error: "Verifica los datos del movimiento.", success: "" };
  }

  const payload = parsed.data;

  if (isSupervisorRole(user.role)) {
    if (!user.campId) {
      return { error: "Tu usuario supervisor no tiene campamento asignado.", success: "" };
    }
    if (payload.campId !== user.campId) {
      return { error: "Solo puedes registrar movimientos de tu campamento.", success: "" };
    }
  }

  await db.stockMovement.create({
    data: {
      date: normalizeDateOnly(payload.date),
      campId: payload.campId,
      createdById: user.id,
      itemName: payload.itemName,
      movementType: payload.movementType,
      quantity: payload.quantity,
      unit: payload.unit,
      notes: payload.notes || null
    }
  });

  revalidatePath("/bodega");
  return { error: "", success: "Movimiento de bodega guardado." };
}
