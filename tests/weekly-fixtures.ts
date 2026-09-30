import { test as base, expect } from '@playwright/test';
import { signIn, householdAction } from './auth-helpers';
import { randomUUID } from 'node:crypto';
import { createStarterPlan } from './fixtures/plans';
import { parseSaveRequest, type PlanDocument } from '../src/lib/plan-document';
export { expect };
let authState:
  Awaited<ReturnType<import('@playwright/test').APIRequestContext['storageState']>> | undefined;

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    if (!authState) {
      await signIn(page.request, `fixture-${randomUUID()}@example.test`);
      const created = await householdAction(page.request, {
        action: 'create',
        name: 'Test kitchen'
      });
      expect(created.ok(), await created.text()).toBeTruthy();
      authState = await page.request.storageState();
    } else await page.context().addCookies(authState.cookies);
    let document: PlanDocument = {
      schemaVersion: 2,
      revision: 0,
      updatedAt: new Date().toISOString(),
      plan: createStarterPlan()
    };
    await page.route('**/api/plan*', async (route) => {
      if (route.request().method() === 'PUT') {
        const save = parseSaveRequest(route.request().postDataJSON());
        if (save.revision !== document.revision) {
          await route.fulfill({ status: 409, json: { error: 'Conflict' } });
          return;
        }
        document = { ...document, revision: document.revision + 1, plan: save.plan };
      }
      await route.fulfill({ json: document });
    });
    await use(page);
    if (testInfo.status !== 'skipped')
      await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
  }
});

export async function openPreparation(page: import('@playwright/test').Page) {
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
  const toggle = page.getByRole('button', { name: 'Plan & prepare', exact: true });
  if ((await toggle.isVisible()) && (await toggle.getAttribute('aria-expanded')) === 'false')
    await toggle.click();
}
