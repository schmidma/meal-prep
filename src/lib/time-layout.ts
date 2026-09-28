import { addMinutes, parseDay } from './calendar';
import { MAX_ACTIVITY_MINUTES, type Activity, type LocalTime } from './domain';
import type { Blocker } from './kitchen';

export const TIME_RAIL_WIDTH = 52;
export const DAY_GUTTER = 16;
export const MIN_DAY_WIDTH = 168;
export const MIN_CARD_HEIGHT = 84;
export const PX_PER_MINUTE = 1.25;
export const HOUR_HEIGHT = PX_PER_MINUTE * 60;
export const DAY_HEIGHT = PX_PER_MINUTE * 1440;
export const SNAP_MINUTES = 15;
export const snapMinute = (minute: number, allowEnd = false) =>
  Math.max(0, Math.min(allowEnd ? 1440 : 1425, Math.round(minute / SNAP_MINUTES) * SNAP_MINUTES));
export type ResizeEdge = 'start' | 'end';

/** Resize one edge while keeping the opposite edge fixed, including across midnight. */
export function resizeSpan(start: LocalTime, duration: number, edge: ResizeEdge, at: LocalTime) {
  const end = addMinutes(start, duration);
  const nextStart =
    edge === 'start'
      ? absoluteMinute(end) - absoluteMinute(at) < SNAP_MINUTES
        ? addMinutes(end, -SNAP_MINUTES)
        : { ...at }
      : { ...start };
  const nextDuration =
    edge === 'start'
      ? absoluteMinute(end) - absoluteMinute(nextStart)
      : Math.max(SNAP_MINUTES, absoluteMinute(at) - absoluteMinute(start));
  if (nextStart.day < '0001-01-01' || nextDuration > MAX_ACTIVITY_MINUTES)
    throw new RangeError('Unsupported time range');
  addMinutes(nextStart, nextDuration);
  return { start: nextStart, duration: nextDuration };
}

/** Civil wall-clock arithmetic, independent of DST and the browser's UTC offset. */
export function absoluteMinute(time: LocalTime): number {
  const date = parseDay(time.day);
  const utc = new Date(0);
  utc.setUTCFullYear(date.getFullYear(), date.getMonth(), date.getDate());
  utc.setUTCHours(0, 0, 0, 0);
  return utc.getTime() / 60000 + time.minute;
}
export function segmentForDay(start: LocalTime, duration: number, day: string) {
  const dayStart = absoluteMinute({ day, minute: 0 });
  const begin = absoluteMinute(start);
  const finish = begin + duration;
  if (duration === 0 && start.day === day)
    return { start: start.minute, end: start.minute, continues: false, continuesAfter: false };
  if (finish <= dayStart || begin >= dayStart + 1440) return null;
  return {
    start: Math.max(0, begin - dayStart),
    end: Math.min(1440, finish - dayStart),
    continues: begin < dayStart,
    continuesAfter: finish > dayStart + 1440
  };
}
/** Resolve an exact endpoint to a rendered segment, including an end at midnight. */
export function endpointSegmentDay(
  start: LocalTime,
  duration: number,
  at: LocalTime,
  days: string[]
): string | undefined {
  const segment = days.includes(at.day) ? segmentForDay(start, duration, at.day) : null;
  if (segment && at.minute >= segment.start && at.minute <= segment.end) return at.day;
  if (at.minute !== 0 || absoluteMinute(start) >= absoluteMinute(at)) return undefined;
  const previous = days.find(
    (day) => absoluteMinute({ day, minute: 0 }) + 1440 === absoluteMinute(at)
  );
  return previous && segmentForDay(start, duration, previous)?.end === 1440 ? previous : undefined;
}
function layoutTimed<T extends { id: string; start: LocalTime }>(
  items: T[],
  duration: (item: T) => number,
  day: string,
  minimumHeight: number
) {
  const entries = items
    .flatMap((item) => {
      const segment = segmentForDay(item.start, duration(item), day);
      return segment ? [{ item, ...segment, lane: 0, lanes: 1 }] : [];
    })
    .sort((a, b) => a.start - b.start || a.end - b.end || a.item.id.localeCompare(b.item.id));
  let cluster: typeof entries = [];
  let laneEnds: number[] = [];
  let clusterEnd = -1;
  const finish = () => {
    for (const entry of cluster) entry.lanes = laneEnds.length;
    cluster = [];
    laneEnds = [];
  };
  for (const entry of entries) {
    // Short events keep a readable minimum height; their duration rail stays exact.
    const visualEnd = Math.max(entry.end, entry.start + minimumHeight / PX_PER_MINUTE);
    if (entry.start >= clusterEnd) {
      finish();
      clusterEnd = -1;
    }
    let lane = laneEnds.findIndex((end) => end <= entry.start);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = visualEnd;
    entry.lane = lane;
    cluster.push(entry);
    clusterEnd = Math.max(clusterEnd, visualEnd);
  }
  finish();
  return entries;
}
export function layoutActivities(activities: Activity[], day: string) {
  return layoutTimed(activities, (activity) => activity.elapsedMinutes, day, MIN_CARD_HEIGHT).map(
    ({ item, ...position }) => ({ activity: item, ...position })
  );
}
export function layoutBlockers(blockers: Blocker[], day: string) {
  return layoutTimed(blockers, (blocker) => blocker.durationMinutes, day, 8).map(
    ({ item, ...position }) => ({ blocker: item, ...position })
  );
}
export function endLabel(start: LocalTime, duration: number): string {
  const end = addMinutes(start, duration);
  const clock = `${String(Math.floor(end.minute / 60)).padStart(2, '0')}:${String(end.minute % 60).padStart(2, '0')}`;
  return end.day === start.day
    ? clock
    : `${clock} (+${Math.round((absoluteMinute({ day: end.day, minute: 0 }) - absoluteMinute({ day: start.day, minute: 0 })) / 1440)}d)`;
}
