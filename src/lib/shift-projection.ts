import { formatDisplayDate, formatShortDisplayDate, toInputDateValue } from "@/lib/report-utils";

type ShiftProjectionInput = {
  shiftPattern?: string | null;
  shiftWorkDays?: number | null;
  shiftOffDays?: number | null;
  shiftStartDate?: Date | null;
};

export type ShiftProjectedDay = {
  date: Date;
  dateKey: string;
  shortLabel: string;
  state: "work" | "off";
  stateLabel: string;
  isToday: boolean;
};

export type ShiftProjection = {
  isConfigured: boolean;
  shiftPatternLabel: string;
  currentState: "work" | "off";
  currentStateLabel: string;
  currentBlockDay: number;
  currentBlockTotal: number;
  daysRemainingInBlock: number;
  currentBlockStart: Date;
  currentBlockEnd: Date;
  nextBlockState: "work" | "off";
  nextBlockLabel: string;
  nextBlockStart: Date;
  nextBlockEnd: Date;
  projectedDays: ShiftProjectedDay[];
};

const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

function toUtcDateOnly(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function buildProjectedDays(referenceDate: Date, cycleLength: number, cycleStart: Date, workDays: number) {
  return Array.from({ length: cycleLength }, (_, index) => {
    const date = addUtcDays(referenceDate, index);
    const elapsedDays = Math.max(0, Math.floor((date.getTime() - cycleStart.getTime()) / MILLIS_PER_DAY));
    const cycleIndex = cycleLength > 0 ? elapsedDays % cycleLength : 0;
    const state = cycleIndex < workDays ? "work" : "off";

    return {
      date,
      dateKey: toInputDateValue(date),
      shortLabel: formatShortDisplayDate(date),
      state,
      stateLabel: state === "work" ? "Trabaja" : "Descanso",
      isToday: index === 0
    } satisfies ShiftProjectedDay;
  });
}

export function getShiftProjection(input: ShiftProjectionInput, referenceDate = new Date()): ShiftProjection | null {
  if (!input.shiftStartDate || !input.shiftWorkDays || !input.shiftOffDays) {
    return null;
  }

  const shiftStart = toUtcDateOnly(input.shiftStartDate);
  const today = toUtcDateOnly(referenceDate);
  const workDays = input.shiftWorkDays;
  const offDays = input.shiftOffDays;
  const cycleLength = workDays + offDays;

  if (cycleLength <= 0) {
    return null;
  }

  const elapsedDays = Math.max(0, Math.floor((today.getTime() - shiftStart.getTime()) / MILLIS_PER_DAY));
  const cycleIndex = elapsedDays % cycleLength;
  const currentState = cycleIndex < workDays ? "work" : "off";
  const currentStateLabel = currentState === "work" ? "Trabaja" : "Descanso";
  const currentBlockDay = currentState === "work" ? cycleIndex + 1 : cycleIndex - workDays + 1;
  const currentBlockTotal = currentState === "work" ? workDays : offDays;
  const daysRemainingInBlock = currentBlockTotal - currentBlockDay;
  const currentBlockOffset = currentState === "work" ? cycleIndex : cycleIndex - workDays;
  const currentBlockStart = addUtcDays(today, -currentBlockOffset);
  const currentBlockEnd = addUtcDays(currentBlockStart, currentBlockTotal - 1);
  const nextBlockState = currentState === "work" ? "off" : "work";
  const nextBlockLabel = nextBlockState === "work" ? "Trabaja" : "Descanso";
  const nextBlockStart = addUtcDays(currentBlockEnd, 1);
  const nextBlockEnd = addUtcDays(nextBlockStart, (nextBlockState === "work" ? workDays : offDays) - 1);
  const projectedDays = buildProjectedDays(today, cycleLength, shiftStart, workDays);

  return {
    isConfigured: true,
    shiftPatternLabel: input.shiftPattern ?? `${workDays}x${offDays}`,
    currentState,
    currentStateLabel,
    currentBlockDay,
    currentBlockTotal,
    daysRemainingInBlock,
    currentBlockStart,
    currentBlockEnd,
    nextBlockState,
    nextBlockLabel,
    nextBlockStart,
    nextBlockEnd,
    projectedDays
  };
}

export function formatShiftRange(start: Date, end: Date) {
  return `${formatDisplayDate(start)} al ${formatDisplayDate(end)}`;
}
