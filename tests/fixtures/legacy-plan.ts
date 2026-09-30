import { addDays } from '../../src/lib/calendar';
import type { Activity, Allocation, Batch, Day, Plan } from '../../src/lib/domain';

export function createExamplePlan(anchor: Day): Plan {
  const [mon, tue, wed, thu, fri, sat, sun] = Array.from({ length: 7 }, (_, index) =>
    addDays(anchor, index)
  );
  const previousSun = addDays(anchor, -1);
  const activity = (
    id: string,
    title: string,
    kind: Activity['kind'],
    day: Day,
    minute: number,
    elapsedMinutes: number,
    handsOnMinutes: number,
    requiresHome: boolean,
    notes: string
  ): Activity => ({
    id,
    title,
    kind,
    start: { day, minute },
    elapsedMinutes,
    handsOnMinutes,
    requiresHome,
    notes
  });
  const activities: Activity[] = [
    activity(
      'lunch-mon',
      'Roasted vegetable lunch',
      'meal',
      mon,
      12 * 60 + 30,
      25,
      0,
      false,
      'Use two portions of weekend-roasted vegetables with a quick dressing.'
    ),
    activity(
      'bread-mon',
      'Bread and cheese dinner',
      'meal',
      mon,
      18 * 60 + 30,
      30,
      0,
      false,
      'Keep dinner simple before the curry session.'
    ),
    activity(
      'cook-curry',
      'Cook coconut curry',
      'cook',
      mon,
      19 * 60 + 15,
      50,
      25,
      true,
      'Chop vegetables, simmer with coconut milk, and pack four portions.'
    ),
    activity(
      'lunch-tue',
      'Curry lunch',
      'meal',
      tue,
      12 * 60 + 30,
      30,
      0,
      false,
      'Reheat two portions of curry.'
    ),
    activity(
      'salad-tue',
      'Vegetable salad',
      'meal',
      tue,
      18 * 60 + 30,
      25,
      0,
      false,
      'Use one portion of roast vegetables with greens.'
    ),
    activity(
      'lunch-wed',
      'Curry lunch',
      'meal',
      wed,
      12 * 60 + 30,
      30,
      0,
      false,
      'Finish the curry leftovers.'
    ),
    activity(
      'cook-grains',
      'Cook grains and eat',
      'cook',
      wed,
      18 * 60,
      45,
      20,
      true,
      'Simmer grains and vegetables; eat two portions when ready, then pack six.'
    ),
    activity(
      'lunch-thu',
      'Grain bowl lunch',
      'meal',
      thu,
      12 * 60 + 30,
      30,
      0,
      false,
      'Pack two portions with a lemon dressing.'
    ),
    activity(
      'dinner-thu',
      'Cafeteria dinner',
      'meal',
      thu,
      19 * 60,
      30,
      0,
      false,
      'Eat out after a busy evening.'
    ),
    activity(
      'lunch-fri',
      'Grain bowl lunch',
      'meal',
      fri,
      12 * 60 + 30,
      30,
      0,
      false,
      'Use two grain portions with fresh herbs.'
    ),
    activity(
      'bake-cake',
      'Bake cake',
      'cook',
      fri,
      17 * 60 + 30,
      65,
      20,
      true,
      'Mix batter and bake; cool before packing for friends.'
    ),
    activity(
      'cake-friends',
      'Cake with friends',
      'meal',
      sat,
      15 * 60,
      45,
      0,
      false,
      'Bring six slices to share.'
    ),
    activity(
      'travel-sun',
      'Travel',
      'other',
      sun,
      9 * 60,
      180,
      0,
      false,
      'Away from home for the morning.'
    )
  ];
  const batches: Batch[] = [
    {
      id: 'stock-veg',
      name: 'Roasted vegetables',
      quantity: 4,
      unit: 'portions',
      source: { kind: 'existing', availableAt: { day: previousSun, minute: 18 * 60 } }
    },
    {
      id: 'curry',
      name: 'Coconut curry',
      quantity: 4,
      unit: 'portions',
      source: { kind: 'activity', activityId: 'cook-curry' }
    },
    {
      id: 'grains',
      name: 'Grain bowls',
      quantity: 8,
      unit: 'portions',
      source: { kind: 'activity', activityId: 'cook-grains' }
    },
    {
      id: 'cake',
      name: 'Cake',
      quantity: 8,
      unit: 'slices',
      source: { kind: 'activity', activityId: 'bake-cake' }
    }
  ];
  const allocations: Allocation[] = [
    {
      id: 'veg-mon',
      batchId: 'stock-veg',
      activityId: 'lunch-mon',
      quantity: 2,
      purpose: 'eat',
      when: 'start'
    },
    {
      id: 'veg-tue',
      batchId: 'stock-veg',
      activityId: 'salad-tue',
      quantity: 1,
      purpose: 'eat',
      when: 'start'
    },
    {
      id: 'curry-tue',
      batchId: 'curry',
      activityId: 'lunch-tue',
      quantity: 2,
      purpose: 'eat',
      when: 'start'
    },
    {
      id: 'curry-wed',
      batchId: 'curry',
      activityId: 'lunch-wed',
      quantity: 2,
      purpose: 'eat',
      when: 'start'
    },
    {
      id: 'grains-now',
      batchId: 'grains',
      activityId: 'cook-grains',
      quantity: 2,
      purpose: 'eat',
      when: 'end'
    },
    {
      id: 'grains-thu',
      batchId: 'grains',
      activityId: 'lunch-thu',
      quantity: 2,
      purpose: 'eat',
      when: 'start'
    },
    {
      id: 'grains-fri',
      batchId: 'grains',
      activityId: 'lunch-fri',
      quantity: 2,
      purpose: 'eat',
      when: 'start'
    },
    {
      id: 'cake-sat',
      batchId: 'cake',
      activityId: 'cake-friends',
      quantity: 6,
      purpose: 'eat',
      when: 'start'
    }
  ];
  return {
    activities,
    batches,
    allocations,
    availability: {
      [mon]: {
        label: 'Home after work',
        cookable: [{ start: 18 * 60, end: 22 * 60 }],
        atHome: [{ start: 18 * 60, end: 1440 }]
      },
      [tue]: {
        label: 'Away in the evening',
        cookable: [{ start: 7 * 60, end: 8 * 60 }],
        atHome: [
          { start: 0, end: 8 * 60 },
          { start: 21 * 60, end: 1440 }
        ]
      },
      [wed]: {
        label: 'Home after work',
        cookable: [{ start: 17 * 60, end: 21 * 60 }],
        atHome: [{ start: 17 * 60, end: 1440 }]
      },
      [thu]: {
        label: 'Busy evening',
        cookable: [{ start: 7 * 60, end: 8 * 60 }],
        atHome: [
          { start: 0, end: 8 * 60 },
          { start: 22 * 60, end: 1440 }
        ]
      },
      [fri]: {
        label: 'Baking after work',
        cookable: [{ start: 17 * 60, end: 20 * 60 }],
        atHome: [{ start: 17 * 60, end: 1440 }]
      }
    }
  };
}

import type { KitchenPlan } from '../../src/lib/kitchen';
export function createKitchenPlan(anchor: Day): KitchenPlan {
  const example = createExamplePlan(anchor);
  return {
    ...example,
    activities: example.activities.map((activity) => ({
      ...activity,
      handsOnMinutes: 0,
      requiresHome: false
    })),
    batches: example.batches.map((batch) => ({ ...batch, unit: '' })),
    availability: {},
    ingredients: [
      { id: 'ing-paprika', name: 'Paprika', quantity: 2, unit: '' },
      { id: 'ing-spinach', name: 'Spinach', quantity: 200, unit: '' }
    ],
    ingredientUses: [],
    recipes: [],
    activityRequirements: [],
    blockers: [
      {
        id: 'block-climbing',
        title: 'Climbing',
        start: { day: addDays(anchor, 1), minute: 1080 },
        durationMinutes: 180,
        away: false
      },
      {
        id: 'block-evening',
        title: 'Busy evening',
        start: { day: addDays(anchor, 3), minute: 1080 },
        durationMinutes: 180,
        away: false
      }
    ]
  };
}
