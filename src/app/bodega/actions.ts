"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isSupervisorRole, OPERATION_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { normalizeDateOnly } from "@/lib/report-utils";

const schema = z.object({
  date: z.string().min(1),
  campId: z.string().min(1),
  inventoryItemId: z.string().min(1),
  movementType: z.enum(["INGRESO", "SALIDA"]),
  quantity: z.coerce.number().positive(),
  notes: z.string().optional()
});

export type StockFormState = { error: string; success: string };
export type InventoryItemFormState = { error: string; success: string };

const createItemSchema = z.object({
  campId: z.string().optional(),
  name: z.string().trim().min(2),
  category: z.string().trim().optional(),
  newCategory: z.string().trim().optional(),
  unit: z.string().trim().min(1)
});

function normalizeInventoryName(input: string) {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export async function saveStockMovementAction(_: StockFormState, formData: FormData): Promise<StockFormState> {
  const user = await requireRole(OPERATION_ROLES);

  const parsed = schema.safeParse({
    date: formData.get("date"),
    campId: formData.get("campId"),
    inventoryItemId: formData.get("inventoryItemId"),
    movementType: formData.get("movementType"),
    quantity: formData.get("quantity"),
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

  const inventoryItem = await db.inventoryItem.findFirst({
    where: {
      id: payload.inventoryItemId,
      isActive: true,
      ...(isSupervisorRole(user.role)
        ? {
            OR: [{ campId: null }, { campId: user.campId }]
          }
        : {})
    }
  });

  if (!inventoryItem) {
    return { error: "El item de inventario no existe o no esta disponible para tu campamento.", success: "" };
  }

  await db.stockMovement.create({
    data: {
      date: normalizeDateOnly(payload.date),
      campId: payload.campId,
      createdById: user.id,
      inventoryItemId: inventoryItem.id,
      itemName: inventoryItem.name,
      movementType: payload.movementType,
      quantity: payload.quantity,
      unit: inventoryItem.unit,
      notes: payload.notes || null
    }
  });

  revalidatePath("/bodega");
  return { error: "", success: "Movimiento de bodega guardado." };
}

export async function saveInventoryItemAction(
  _: InventoryItemFormState,
  formData: FormData
): Promise<InventoryItemFormState> {
  const user = await requireRole(OPERATION_ROLES);

  const parsed = createItemSchema.safeParse({
    campId: String(formData.get("campId") ?? ""),
    name: formData.get("name"),
    category: formData.get("category"),
    newCategory: formData.get("newCategory"),
    unit: formData.get("unit")
  });

  if (!parsed.success) {
    return { error: "Verifica los datos del nuevo item.", success: "" };
  }

  const payload = parsed.data;
  const scopedCampId = payload.campId || null;

  if (isSupervisorRole(user.role)) {
    if (!user.campId) {
      return { error: "Tu usuario supervisor no tiene campamento asignado.", success: "" };
    }
    if (scopedCampId !== user.campId) {
      return { error: "Solo puedes crear items para tu campamento.", success: "" };
    }
  }

  const selectedCategory = payload.newCategory?.trim() || payload.category?.trim() || "Otros";
  const normalizedName = normalizeInventoryName(payload.name);
  const normalizedUnit = payload.unit.trim().toLowerCase();

  const exists = await db.inventoryItem.findFirst({
    where: {
      isActive: true,
      campId: scopedCampId,
      normalizedName,
      unit: normalizedUnit
    }
  });

  if (exists) {
    return { error: "Ese item ya existe en el catalogo para ese campamento.", success: "" };
  }

  await db.inventoryItem.create({
    data: {
      campId: scopedCampId,
      name: payload.name.trim(),
      normalizedName,
      category: selectedCategory,
      unit: normalizedUnit,
      isActive: true
    }
  });

  revalidatePath("/bodega");
  revalidatePath("/bodega/items/nuevo");
  return { error: "", success: "Item creado correctamente. Ya aparece en la lista de bodega." };
}
