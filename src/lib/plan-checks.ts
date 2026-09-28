import { addMinutes, compareLocal, formatTime } from './calendar';
import {
  activityEnd,
  allocationAt,
  batchReadyAt,
  batchTotals,
  type LocalTime,
  type Warning
} from './domain';
import { ingredientTotals, type KitchenPlan } from './kitchen';
import { warningTargets, type WarningTarget } from './relationships';
import { absoluteMinute } from './time-layout';
import { dateLabel, quantity } from './view';

export type CheckAction = WarningTarget & {
  action: string;
  reveal?: 'schedule' | 'availability';
};
export type CheckRow = {
  key: string;
  title: string;
  detail: string;
  evidence?: string;
  action?: CheckAction;
};
export type PlanCheck = {
  key: string;
  warningKeys: string[];
  code: string;
  group: 'food' | 'schedule';
  title: string;
  explanation: string;
  facts: { label: string; value: string }[];
  rows: CheckRow[];
  primary?: CheckAction;
  secondary: CheckAction[];
};
export type ChecksSession = {
  scrollTop: number;
  focusKey: string | null;
  originKey: string | null;
  originTitle: string;
  originGroupKey: string | null;
  originRowTitle: string | null;
  originAt: LocalTime | null;
  returning: boolean;
  filter: 'all' | 'food' | 'schedule';
  orderedFocusKeys: string[];
  focusOffset: number | null;
  expandedKeys: string[];
};
export const warningKey = (warning: Warning) =>
  JSON.stringify([
    warning.code,
    ...(warning.code === 'OVER_ALLOCATED' || warning.code === 'OVER_ALLOCATED_INGREDIENT'
      ? warning.entityIds.slice(0, 1)
      : warning.entityIds)
  ]);
export const checkTime = (at: LocalTime) => `${dateLabel(at.day)} ${formatTime(at.minute)}`;
/** A human-sized interval for timing evidence; timestamps remain exact. */
export function intervalLabel(minutes: number): string {
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const remainder = minutes % 60;
  return [
    days && `${days}d`,
    hours && `${hours}h`,
    (remainder || (!days && !hours)) && `${remainder}min`
  ]
    .filter(Boolean)
    .join(' ');
}
const action = (
  target: WarningTarget,
  label: string,
  reveal?: CheckAction['reveal']
): CheckAction => ({
  ...target,
  action: label,
  ...(reveal ? { reveal } : {})
});
const scheduleAction = (target: WarningTarget, plan: KitchenPlan) =>
  action(
    target,
    plan.activities.find((item) => item.id === target.entity.id)?.kind === 'meal'
      ? 'Review meal timing'
      : 'Review activity timing',
    'schedule'
  );

/** Presentation only: no validation, writes, or message parsing. Keep each allocation identity. */
export function planChecks(plan: KitchenPlan, warnings: Warning[]): PlanCheck[] {
  const checks: PlanCheck[] = [];
  for (const warning of warnings) {
    const key = warningKey(warning);
    const targets = warningTargets(plan, warning);
    const check: PlanCheck = {
      key,
      warningKeys: [key],
      code: warning.code,
      group: 'food',
      title: warning.code
        .toLowerCase()
        .replaceAll('_', ' ')
        .replace(/^./, (letter) => letter.toUpperCase()),
      explanation: warning.message,
      facts: [],
      rows: [],
      primary: targets[0] ? action(targets[0], `Review ${targets[0].label}`) : undefined,
      secondary: targets.slice(1).map((target) => action(target, `View ${target.label}`))
    };
    // Malformed legacy data still gets its fallback and valid navigation targets.
    try {
      if (warning.code === 'OVER_ALLOCATED' || warning.code === 'OVER_ALLOCATED_INGREDIENT') {
        const raw = warning.code === 'OVER_ALLOCATED_INGREDIENT';
        const food = (raw ? plan.ingredients : plan.batches).find((item) =>
          warning.entityIds.includes(item.id)
        );
        if (food) {
          const totals = raw ? ingredientTotals(plan, food.id) : batchTotals(plan, food.id);
          check.title = `${food.name}: ${quantity(-totals.remaining, food.quantity)} short`;
          check.explanation =
            'More is assigned than you have. Adjust the stock quantity or its assignments.';
          check.facts = [
            { label: 'Available', value: quantity(food.quantity) },
            { label: 'Assigned', value: quantity(totals.assigned) },
            { label: 'Short', value: quantity(-totals.remaining, food.quantity) }
          ];
          check.primary = action(
            { entity: { kind: raw ? 'ingredient' : 'batch', id: food.id }, label: food.name },
            'Review quantity & assignments'
          );
          check.secondary = [];
          if (raw) {
            check.rows = plan.ingredientUses
              .filter((use) => use.ingredientId === food.id)
              .map((use) => {
                const activity = plan.activities.find((item) => item.id === use.activityId);
                return {
                  key: use.id,
                  title: activity?.title ?? 'Missing activity',
                  detail: `${quantity(use.quantity)} as ingredient`,
                  evidence: activity ? checkTime(activity.start) : undefined,
                  action: activity
                    ? action(
                        {
                          entity: { kind: 'activity', id: activity.id },
                          label: activity.title,
                          at: activity.start
                        },
                        `View ${activity.title}`
                      )
                    : undefined
                };
              });
          } else {
            check.rows = plan.allocations
              .filter((use) => use.batchId === food.id)
              .map((use) => {
                const activity = plan.activities.find((item) => item.id === use.activityId);
                const at = allocationAt(plan, use);
                return {
                  key: use.id,
                  title: activity?.title ?? 'Missing activity',
                  detail: `${quantity(use.quantity)} / ${use.purpose === 'eat' ? 'eat' : 'ingredient'} at ${use.when}`,
                  evidence: at ? checkTime(at) : undefined,
                  action: activity
                    ? action(
                        {
                          entity: { kind: 'activity', id: activity.id },
                          label: activity.title,
                          at
                        },
                        `View ${activity.title}`
                      )
                    : undefined
                };
              });
          }
        }
      } else if (warning.code === 'BEFORE_READY') {
        const allocation = plan.allocations.find((item) => warning.entityIds.includes(item.id));
        const batch = plan.batches.find((item) => item.id === allocation?.batchId);
        const activity = plan.activities.find((item) => item.id === allocation?.activityId);
        const ready = batch && batchReadyAt(plan, batch);
        const needed = allocation && allocationAt(plan, allocation);
        if (allocation && batch && activity && ready && needed) {
          check.key = `readiness:${batch.id}`;
          check.title = `${batch.name} isn't ready in time`;
          check.explanation = 'Review when this food is ready or when it is needed.';
          check.facts = [{ label: 'Ready', value: checkTime(ready) }];
          check.rows = [
            {
              key,
              title: activity.title,
              detail: `${quantity(allocation.quantity)} needed / ${allocation.purpose === 'eat' ? 'Eat' : 'Ingredient'} at ${allocation.when}`,
              evidence: `${checkTime(needed)} / ${intervalLabel(absoluteMinute(ready) - absoluteMinute(needed))} early`,
              action: scheduleAction(
                {
                  entity: { kind: 'activity', id: activity.id },
                  label: activity.title,
                  at: needed
                },
                plan
              )
            }
          ];
          check.primary = undefined;
          check.secondary = targets
            .filter((target) => target.entity.id !== activity.id)
            .map((target) =>
              action(
                target,
                target.entity.kind === 'batch'
                  ? 'Review food readiness'
                  : 'Review preparation timing',
                target.entity.kind === 'activity'
                  ? 'schedule'
                  : batch.source.kind === 'existing'
                    ? 'availability'
                    : undefined
              )
            );
          const existing = checks.find((item) => item.key === check.key);
          if (existing) {
            existing.warningKeys.push(key);
            existing.rows.push(...check.rows);
            continue;
          }
        }
      } else if (warning.code === 'OWN_INGREDIENT' || warning.code === 'INGREDIENT_CYCLE') {
        const own = warning.code === 'OWN_INGREDIENT';
        const members = new Set(warning.entityIds);
        const allocations = plan.allocations.filter((use) => {
          const batch = plan.batches.find((item) => item.id === use.batchId);
          return (
            use.purpose === 'ingredient' &&
            batch?.source.kind === 'activity' &&
            (own
              ? members.has(use.id)
              : members.has(batch.source.activityId) && members.has(use.activityId))
          );
        });
        const names = plan.activities
          .filter((item) => members.has(item.id))
          .map((item) => item.title);
        if (allocations.length) {
          check.title = own
            ? `${names[0]} needs its own output`
            : `Circular ingredient dependency: ${names.join(' / ')}`;
          check.explanation = own
            ? 'Use another food as the ingredient, or remove this assignment. This activity cannot prepare its own input.'
            : 'These activities need food from each other before they can make it. Replace or remove an ingredient assignment to break the loop.';
          check.facts = [
            { label: 'Ingredient assignments to review', value: String(allocations.length) }
          ];
          check.rows = allocations.map((use) => {
            const batch = plan.batches.find((item) => item.id === use.batchId)!;
            const sourceId = batch.source.kind === 'activity' ? batch.source.activityId : undefined;
            const source = plan.activities.find((item) => item.id === sourceId);
            const consumer = plan.activities.find((item) => item.id === use.activityId)!;
            const at = allocationAt(plan, use);
            return {
              key: use.id,
              title: `${batch.name}: ${source?.title} to ${consumer.title}`,
              detail: `${quantity(use.quantity)} / Ingredient at ${use.when}`,
              evidence: at ? checkTime(at) : undefined,
              action: action(
                { entity: { kind: 'activity', id: consumer.id }, label: consumer.title, at },
                `Review ingredients in ${consumer.title}`
              )
            };
          });
          check.primary = check.rows[0].action;
          check.secondary = [...new Set(allocations.map((use) => use.batchId))].map((id) => {
            const batch = plan.batches.find((item) => item.id === id)!;
            return action(
              { entity: { kind: 'batch', id }, label: batch.name },
              `Review ${batch.name} assignments`
            );
          });
        }
      } else if (warning.code === 'BLOCKED_TIME' || warning.code === 'POSSIBLE_OVERLAP') {
        check.group = 'schedule';
        const activities = warning.entityIds
          .map((id) => plan.activities.find((item) => item.id === id))
          .filter((item) => !!item);
        const first = activities[0];
        const second =
          warning.code === 'BLOCKED_TIME'
            ? plan.blockers.find((item) => warning.entityIds.includes(item.id))
            : activities[1];
        if (first && second) {
          const endA = activityEnd(first);
          const endB =
            'elapsedMinutes' in second
              ? activityEnd(second)
              : addMinutes(second.start, second.durationMinutes);
          const start = compareLocal(first.start, second.start) > 0 ? first.start : second.start;
          const end = compareLocal(endA, endB) < 0 ? endA : endB;
          check.title =
            warning.code === 'BLOCKED_TIME'
              ? `${first.title} overlaps blocked time ${second.title}`
              : `${first.title} overlaps ${second.title}`;
          check.explanation =
            warning.code === 'BLOCKED_TIME'
              ? `Overlaps ${second.title}. Review either schedule if this time should stay free.`
              : 'Possibly intentional: activities can run in parallel. Change the timing only if you need to.';
          check.facts = [
            {
              label: 'Overlap',
              value: `${checkTime(start)} - ${end.day === start.day ? formatTime(end.minute) : checkTime(end)} (${quantity(absoluteMinute(end) - absoluteMinute(start))} min)`
            }
          ];
          check.rows = [
            {
              key: first.id,
              title: first.title,
              detail: `${checkTime(first.start)} - ${endA.day === first.start.day ? formatTime(endA.minute) : checkTime(endA)}`
            },
            {
              key: second.id,
              title: second.title,
              detail: `${checkTime(second.start)} - ${endB.day === second.start.day ? formatTime(endB.minute) : checkTime(endB)}`
            }
          ];
          check.primary = scheduleAction(
            { entity: { kind: 'activity', id: first.id }, label: first.title, at: start },
            plan
          );
          check.secondary = [
            action(
              {
                entity: {
                  kind: warning.code === 'BLOCKED_TIME' ? 'block' : 'activity',
                  id: second.id
                },
                label: second.title,
                at: start
              },
              warning.code === 'BLOCKED_TIME' ? `Review blocked time` : `Review ${second.title}`,
              'schedule'
            )
          ];
        }
      }
    } catch {
      // The domain warning remains visible even if invalid dates cannot be formatted.
    }
    checks.push(check);
  }
  for (const check of checks) {
    if (check.code === 'BEFORE_READY') {
      check.rows.sort((a, b) =>
        a.action?.at && b.action?.at ? compareLocal(a.action.at, b.action.at) : 0
      );
    }
  }
  return checks;
}
