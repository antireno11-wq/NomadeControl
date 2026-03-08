export const ADMIN_DAILY_TASKS = [
  "Firma por Talana de asistencia del personal",
  "Revision de registros Alimentacion al día",
  "Revision de registros de Hoteleria al día",
  "Ingreso de salidas de materia prima",
  "Cumplimiento de minuta por día",
  "Ingreso de consumo por servicio en Drive EDP",
  "Informe interno del servicio entregado (Fotografia)",
  "Cumplimiento del registro díario de degustacion Nomade",
  "Registro fotografico  degustracion diaria",
  "Verificar registro de traslado de comidas en sonda T° correcta",
  "Informes de stock",
  "Chequear combustible de generadores",
  "Correo de actividades y/o tareas diarias",
  "Registro de cierre de turno"
] as const;

export const OPERATIONAL_DAILY_TASKS = [
  "Revision de minuta desyauno",
  "Verificar Orden y limpieza de areas",
  "Chequear gramajes a producir (Pesaje)",
  "Chequeo visual de orden en bodegas y almacenamiento",
  "Chequeo visiual de quiebre sanitario en espacios comunes",
  "Chequeo visiual de orden y limpieza implementaciones de habitacion y aseo",
  "Chequeo visual de espacios comunes",
  "Revision en terreno con encargados de area, cocina, desconche, habitaciones.",
  "Chequeo visual de presentacion de los platos.",
  "Verificar cierre de bodegas y espacio de nomadeque contienen MP"
] as const;

export function taskKeyFromLabel(label: string) {
  return label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
