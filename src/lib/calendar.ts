export type Day = string;
export type LocalTime = { day: Day; minute: number };

/** Civil dates and times are wall-clock values, not instants. */
export function parseDay(day: Day): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) throw new RangeError(`Invalid day: ${day}`);
  const [, year, month, date] = match.map(Number);
  const result = new Date(0);
  result.setHours(12, 0, 0, 0);
  result.setFullYear(year, month - 1, date);
  if (
    result.getFullYear() !== year ||
    result.getMonth() !== month - 1 ||
    result.getDate() !== date
  ) {
    throw new RangeError(`Invalid day: ${day}`);
  }
  result.setHours(0, 0, 0, 0);
  return result;
}

export function formatDay(date: Date): Day {
  if (!Number.isFinite(date.getTime())) throw new RangeError('Invalid date');
  const year = date.getFullYear();
  if (year < 0 || year > 9999) throw new RangeError('Day outside four-digit year range');
  return `${String(year).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function todayDay(): Day {
  return formatDay(new Date());
}

export function addDays(day: Day, amount: number): Day {
  if (!Number.isSafeInteger(amount)) throw new RangeError('Days must be an integer');
  const date = parseDay(day);
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + amount);
  return formatDay(date);
}

export function startOfWeek(day: Day): Day {
  const weekday = parseDay(day).getDay();
  return addDays(day, -(weekday === 0 ? 6 : weekday - 1));
}

export function addMinutes(time: LocalTime, minutes: number): LocalTime {
  parseDay(time.day);
  if (
    !Number.isSafeInteger(time.minute) ||
    time.minute < 0 ||
    time.minute >= 1440 ||
    !Number.isSafeInteger(minutes)
  ) {
    throw new RangeError('Invalid wall-clock minute');
  }
  const total = time.minute + minutes;
  if (!Number.isSafeInteger(total)) throw new RangeError('Minute offset too large');
  const days = Math.floor(total / 1440);
  return { day: addDays(time.day, days), minute: total - days * 1440 };
}

export function compareLocal(a: LocalTime, b: LocalTime): number {
  parseDay(a.day);
  parseDay(b.day);
  if (
    ![a.minute, b.minute].every(
      (minute) => Number.isSafeInteger(minute) && minute >= 0 && minute < 1440
    )
  ) {
    throw new RangeError('Invalid wall-clock minute');
  }
  return a.day < b.day ? -1 : a.day > b.day ? 1 : Math.sign(a.minute - b.minute);
}

export function formatTime(minute: number): string {
  if (!Number.isInteger(minute) || minute < 0 || minute >= 1440)
    throw new RangeError('Invalid time');
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

export function parseTime(value: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) throw new RangeError(`Invalid time: ${value}`);
  return Number(match[1]) * 60 + Number(match[2]);
}
