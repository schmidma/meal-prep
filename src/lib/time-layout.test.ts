import { describe, expect, it } from 'vitest';
import type { Activity } from './domain';
import {
  absoluteMinute,
  endpointSegmentDay,
  layoutActivities,
  layoutBlockers,
  resizeSpan,
  segmentForDay,
  snapMinute
} from './time-layout';

const day = '2026-09-21';
const activity = (id: string, minute: number, elapsedMinutes: number): Activity => ({
  id,
  title: id,
  start: { day, minute },
  elapsedMinutes,
  handsOnMinutes: 0,
  requiresHome: false,
  notes: '',
  kind: 'meal'
});

describe('time-grid projection', () => {
  it('keeps exact start times and gives overlapping events separate lanes', () => {
    const cards = layoutActivities(
      [activity('first', 540, 60), activity('overlap', 570, 30), activity('after', 600, 45)],
      day
    );
    expect(cards.map((card) => [card.start, card.lane, card.lanes])).toEqual([
      [540, 0, 3],
      [570, 1, 3],
      [600, 2, 3]
    ]);
  });
  it('keeps fully overlapping blockers independently reachable in separate lanes', () => {
    const blocks = ['Climbing', 'Choir'].map((id) => ({
      id,
      title: id,
      start: { day, minute: 1080 },
      durationMinutes: 180,
      away: true
    }));
    const layout = layoutBlockers(blocks, day);
    expect(layout.map((item) => [item.start, item.end, item.lane, item.lanes])).toEqual([
      [1080, 1260, 0, 2],
      [1080, 1260, 1, 2]
    ]);
  });
  it('places short non-overlapping blockers in the same lane, but splits actual overlaps', () => {
    const blocks = [540, 570, 575].map((minute) => ({
      id: `block-${minute}`,
      title: 'Block',
      start: { day, minute },
      durationMinutes: 15,
      away: true
    }));
    const layout = layoutBlockers(blocks, day);
    expect(layout.map((item) => [item.start, item.lane, item.lanes])).toEqual([
      [540, 0, 1],
      [570, 0, 2],
      [575, 1, 2]
    ]);
  });
  it('projects overnight events on both dates without changing their duration', () => {
    const start = { day, minute: 1410 };
    expect(segmentForDay(start, 60, day)).toEqual({
      start: 1410,
      end: 1440,
      continues: false,
      continuesAfter: true
    });
    expect(segmentForDay(start, 60, '2026-09-22')).toEqual({
      start: 0,
      end: 30,
      continues: true,
      continuesAfter: false
    });
    expect(segmentForDay(start, 60, '2026-09-23')).toBeNull();
  });
  it('locates only actual endpoint segments, including exact midnight without underflow', () => {
    const week = ['2026-09-21', '2026-09-27'];
    const overnight = { day: '2026-09-27', minute: 1380 };
    expect(
      endpointSegmentDay(overnight, 180, { day: '2026-09-28', minute: 120 }, week)
    ).toBeUndefined();
    expect(
      endpointSegmentDay(overnight, 180, { day: '2026-09-28', minute: 120 }, [
        ...week,
        '2026-09-28'
      ])
    ).toBe('2026-09-28');
    expect(endpointSegmentDay(overnight, 60, { day: '2026-09-28', minute: 0 }, week)).toBe(
      '2026-09-27'
    );
    expect(
      endpointSegmentDay({ day: '0001-01-01', minute: 0 }, 0, { day: '0001-01-01', minute: 0 }, [
        '0001-01-01'
      ])
    ).toBe('0001-01-01');
    expect(
      endpointSegmentDay({ day: '0001-01-01', minute: 0 }, 0, { day: '0001-01-01', minute: 0 }, [])
    ).toBeUndefined();
  });
  it('snaps pointer positions but keeps every hour of the day available', () => {
    expect(snapMinute(1)).toBe(0);
    expect(snapMinute(19 * 60 + 8)).toBe(19 * 60 + 15);
    expect(snapMinute(1440)).toBe(1425);
    expect(snapMinute(1440, true)).toBe(1440);
    expect(segmentForDay({ day, minute: 0 }, 0, day)?.start).toBe(0);
  });
  it('resizes either edge while preserving the opposite edge and minimum duration', () => {
    const start = { day, minute: 600 };
    expect(resizeSpan(start, 60, 'start', { day, minute: 570 })).toEqual({
      start: { day, minute: 570 },
      duration: 90
    });
    expect(resizeSpan(start, 60, 'start', { day, minute: 700 })).toEqual({
      start: { day, minute: 645 },
      duration: 15
    });
    expect(resizeSpan(start, 60, 'end', { day, minute: 720 })).toEqual({ start, duration: 120 });
    expect(resizeSpan(start, 60, 'end', { day, minute: 500 })).toEqual({ start, duration: 15 });
    expect(start).toEqual({ day, minute: 600 });
  });
  it('resizes across midnight and civil DST boundaries without breaking supported dates', () => {
    expect(resizeSpan({ day, minute: 1410 }, 60, 'start', { day, minute: 1380 })).toEqual({
      start: { day, minute: 1380 },
      duration: 90
    });
    expect(
      resizeSpan({ day, minute: 1410 }, 60, 'end', { day: '2026-09-22', minute: 60 }).duration
    ).toBe(90);
    expect(
      resizeSpan({ day: '2026-03-28', minute: 1380 }, 120, 'end', { day: '2026-03-30', minute: 0 })
        .duration
    ).toBe(1500);
    expect(() =>
      resizeSpan({ day: '9999-12-31', minute: 1430 }, 0, 'end', { day: '9999-12-31', minute: 1430 })
    ).toThrow();
    expect(() =>
      resizeSpan({ day, minute: 0 }, 60, 'end', { day: '2028-09-21', minute: 0 })
    ).toThrow();
  });
  it('uses civil dates rather than elapsed UTC hours or Date.UTC short-year coercion', () => {
    expect(
      absoluteMinute({ day: '2026-03-30', minute: 0 }) -
        absoluteMinute({ day: '2026-03-29', minute: 0 })
    ).toBe(1440);
    expect(
      absoluteMinute({ day: '0001-01-02', minute: 0 }) -
        absoluteMinute({ day: '0001-01-01', minute: 0 })
    ).toBe(1440);
  });
});
