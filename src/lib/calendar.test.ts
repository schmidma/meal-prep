import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMinutes,
  compareLocal,
  formatDay,
  formatTime,
  parseDay,
  parseTime,
  startOfWeek
} from './calendar';

describe('civil calendar', () => {
  it('validates real ISO dates and round-trips local components', () => {
    expect(formatDay(parseDay('2024-02-29'))).toBe('2024-02-29');
    for (const invalid of ['2023-02-29', '2024-04-31', '2024-2-01', 'bad'])
      expect(() => parseDay(invalid)).toThrow();
    expect(formatDay(parseDay('0099-12-31'))).toBe('0099-12-31');
  });
  it('navigates weeks, leap days and year boundaries', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2024-12-31', 1)).toBe('2025-01-01');
    expect(addDays('2025-01-01', -1)).toBe('2024-12-31');
    expect(startOfWeek('2025-01-05')).toBe('2024-12-30');
    expect(startOfWeek('2025-01-06')).toBe('2025-01-06');
  });
  it('navigates DST boundaries by calendar days rather than 24-hour timestamps', () => {
    // Local noon-to-noon is 23 or 25 hours across these transitions in America/New_York.
    expect(addDays('2024-03-09', 1)).toBe('2024-03-10');
    expect(addDays('2024-11-02', 1)).toBe('2024-11-03');
    expect(addMinutes({ day: '2024-03-09', minute: 23 * 60 + 30 }, 90)).toEqual({
      day: '2024-03-10',
      minute: 60
    });
    expect(addMinutes({ day: '2024-11-03', minute: 15 }, -30)).toEqual({
      day: '2024-11-02',
      minute: 1425
    });
    expect(
      compareLocal({ day: '2024-03-10', minute: 0 }, { day: '2024-03-09', minute: 1439 })
    ).toBe(1);
  });
  it('formats and parses valid 24-hour times strictly', () => {
    expect(formatTime(parseTime('09:07'))).toBe('09:07');
    expect(parseTime('23:59')).toBe(1439);
    for (const invalid of ['24:00', '9:07', '12:60', 'noon'])
      expect(() => parseTime(invalid)).toThrow();
    expect(() => formatTime(1440)).toThrow();
  });
});
