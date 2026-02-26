export function normalizeDateOnly(dateInput: string) {
  const [year, month, day] = dateInput.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function toInputDateValue(date: Date) {
  return new Date(date).toISOString().slice(0, 10);
}
