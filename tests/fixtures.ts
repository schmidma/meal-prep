import { test as base, expect } from '@playwright/test';
import { createKitchenPlan } from '../src/lib/kitchen';
import { startOfWeek, todayDay } from '../src/lib/calendar';
import { parseSaveRequest, planKey, type PlanDocument } from '../src/lib/plan-document';

// Interaction tests each own an in-memory HTTP fixture; storage is exercised separately.
export const naturalTest = base.extend({
  page: async ({ page }, use) => {
    let document: PlanDocument = {
      schemaVersion: 2,
      revision: 0,
      updatedAt: new Date().toISOString(),
      plan: createKitchenPlan(startOfWeek(todayDay()))
    };
    await page.route('**/api/plan', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: document });
        return;
      }
      let request;
      try {
        request = parseSaveRequest(route.request().postDataJSON());
      } catch {
        await route.fulfill({ status: 400, json: { error: 'Invalid plan document' } });
        return;
      }
      if (planKey(request.plan) === planKey(document.plan)) {
        await route.fulfill({ json: document });
        return;
      }
      if (request.revision !== document.revision) {
        await route.fulfill({ status: 409, json: { error: 'Conflict' } });
        return;
      }
      document = {
        ...document,
        plan: request.plan,
        revision: document.revision + 1,
        updatedAt: new Date().toISOString()
      };
      await route.fulfill({ json: document });
    });
    await use(page);
    if (!page.isClosed())
      await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
  }
});

// Legacy suites exercise calendar geometry explicitly; natural defaults are covered in ux.spec.ts.
export const test = naturalTest.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => localStorage.setItem('meal-prep:view', 'calendar'));
    await use(page);
  }
});
