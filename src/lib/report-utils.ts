export function normalizeDateOnly(dateInput: string) {
  const [year, month, day] = dateInput.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function toInputDateValue(date: Date) {
  return new Date(date).toISOString().slice(0, 10);
}

type WaterReadingReport = {
  meterReading: number;
  waterLiters: number;
};

const MAX_REASONABLE_DAILY_WATER_LITERS = 40_000;

export function resolveWaterLiters(current: WaterReadingReport, previous?: WaterReadingReport | null) {
  if (!previous) {
    return current.waterLiters;
  }

  const meterDelta = Math.round(current.meterReading - previous.meterReading);

  if (!Number.isFinite(meterDelta) || meterDelta < 0) {
    return current.waterLiters;
  }

  if (meterDelta === current.waterLiters) {
    return current.waterLiters;
  }

  if (meterDelta <= MAX_REASONABLE_DAILY_WATER_LITERS) {
    return meterDelta;
  }

  return current.waterLiters;
}
