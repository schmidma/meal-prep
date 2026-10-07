import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { signIn, householdAction, origin } from './auth-helpers';
test('email sign-in and household creation work through the UI', async ({ page }, info) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in/, { timeout: 15000 });
  const email = `ui-${randomUUID()}@example.test`;
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Send code', exact: true }).click();
  await expect(page.getByText('Local development inbox', { exact: true })).toHaveCount(0);
  const code = (await (await page.request.get('/api/dev/inbox')).json()).find(
    (mail: { email: string }) => mail.email === email
  ).code;
  await page.getByLabel('Sign-in code', { exact: true }).fill(code!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/household$/);
  await page.getByLabel('Household name').fill('Our test kitchen');
  await page.getByRole('button', { name: 'Create household', exact: true }).click();
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Household', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create invite link', exact: true }).click();
  await expect(page.locator('.wp-invite-url')).toHaveText(/\/join\/[a-f0-9]{64}$/);
  await page.screenshot({ path: `/tmp/auth-settings-${info.project.name}.png`, fullPage: true });
  await page
    .locator('.wp-household-settings')
    .getByRole('button', { name: 'Sign out', exact: true })
    .click();
  await expect(page).toHaveURL(/\/sign-in$/);
  expect((await page.request.get('/api/plan')).status()).toBe(401);
});
test('households isolate plans and photos; invitations are single use and removal revokes access', async ({
  playwright
}) => {
  const contexts = await Promise.all(
    [0, 1, 2, 3].map(() => playwright.request.newContext({ baseURL: origin }))
  );
  const [owner, member, outsider, anonymous] = contexts;
  try {
    expect((await anonymous.get('/api/plan')).status()).toBe(401);
    await signIn(owner, `owner-${randomUUID()}@example.test`);
    await signIn(member, `member-${randomUUID()}@example.test`);
    await signIn(outsider, `outsider-${randomUUID()}@example.test`);
    expect((await owner.get('/api/plan')).status()).toBe(403);
    expect(
      (await householdAction(owner, { action: 'create', name: 'Private kitchen' })).ok()
    ).toBeTruthy();
    const original = await (await owner.get('/api/books')).json();
    const save = await owner.post('/api/books', {
      headers: { Origin: origin },
      data: {
        action: 'save',
        book: original.defaultBookId,
        revision: 0,
        image: '',
        recipe: {
          id: randomUUID(),
          name: 'Private recipe',
          yieldQuantity: 2,
          durationMinutes: 20,
          ingredients: [],
          instructions: ''
        }
      }
    });
    expect(save.status(), await save.text()).toBe(200);
    const bytes = Buffer.from([255, 216, 255, 217]);
    const photo = await owner.post('/api/photos', {
      headers: { Origin: origin, 'Content-Type': 'image/jpeg' },
      data: bytes
    });
    expect(photo.status()).toBe(201);
    const id = (await photo.json()).id;
    await householdAction(outsider, { action: 'create', name: 'Other kitchen' });
    expect((await outsider.get(`/api/photos/${id}`)).status()).toBe(404);
    expect(JSON.stringify(await (await outsider.get('/api/books')).json())).not.toContain(
      'Private recipe'
    );
    const invitation = await (await householdAction(owner, { action: 'invite' })).json();
    const token = invitation.url.split('/').pop();
    expect((await householdAction(member, { action: 'join', token })).status()).toBe(200);
    expect((await member.get(`/api/photos/${id}`)).status()).toBe(200);
    expect(JSON.stringify(await (await member.get('/api/books')).json())).toContain(
      'Private recipe'
    );
    expect((await householdAction(member, { action: 'invite' })).status()).toBe(403);
    expect(
      (
        await owner.post('/api/household', {
          headers: { Origin: 'https://evil.example' },
          data: { action: 'invite' }
        })
      ).status()
    ).toBe(403);
    const account = await (await member.get('/api/account')).json();
    expect(
      (await householdAction(owner, { action: 'remove', target: account.user.id })).status()
    ).toBe(200);
    expect((await member.get('/api/plan')).status()).toBe(403);
    expect((await member.get(`/api/photos/${id}`)).status()).toBe(403);
    expect((await householdAction(member, { action: 'join', token })).status()).toBe(400);
    const revoked = await (await householdAction(owner, { action: 'invite' })).json();
    await householdAction(owner, { action: 'revoke' });
    expect(
      (
        await householdAction(member, { action: 'join', token: revoked.url.split('/').pop() })
      ).status()
    ).toBe(400);
  } finally {
    await Promise.all(contexts.map((c) => c.dispose()));
  }
});

test('codes cannot be replayed and repeated wrong guesses invalidate them', async ({
  playwright
}) => {
  const client = await playwright.request.newContext({ baseURL: origin });
  try {
    const email = `code-${randomUUID()}@example.test`;
    const used = await signIn(client, email);
    expect(
      (
        await client.post('/api/auth/sign-in/email-otp', {
          headers: { Origin: origin },
          data: { email, otp: used }
        })
      ).ok()
    ).toBeFalsy();
    const sent = await client.post('/api/auth/email-otp/send-verification-otp', {
      headers: { Origin: origin },
      data: { email, type: 'sign-in' }
    });
    expect(sent.ok()).toBeTruthy();
    const code = (await (await client.get('/api/dev/inbox')).json()).find(
      (m: { email: string }) => m.email === email
    ).code;
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++)
      expect(
        (
          await client.post('/api/auth/sign-in/email-otp', {
            headers: { Origin: origin },
            data: { email, otp: wrong }
          })
        ).ok()
      ).toBeFalsy();
    expect(
      (
        await client.post('/api/auth/sign-in/email-otp', {
          headers: { Origin: origin },
          data: { email, otp: code }
        })
      ).ok()
    ).toBeFalsy();
    expect(
      (await client.get('/api/dev/inbox', { headers: { Origin: 'https://evil.example' } })).status()
    ).toBe(403);
  } finally {
    await client.dispose();
  }
});

test('a stale tab cannot read or write using another account session', async ({ playwright }) => {
  const client = await playwright.request.newContext({ baseURL: origin });
  try {
    await signIn(client, `first-${randomUUID()}@example.test`);
    await householdAction(client, { action: 'create', name: 'First' });
    const first = await (await client.get('/api/account')).json();
    const document = await (await client.get('/api/plan')).json();
    await client.post('/api/auth/sign-out', { headers: { Origin: origin }, data: {} });
    await signIn(client, `second-${randomUUID()}@example.test`);
    await householdAction(client, { action: 'create', name: 'Second' });
    const headers = {
      Origin: origin,
      'X-Meal-Prep-User': first.user.id,
      'X-Meal-Prep-Household': first.household.id
    };
    expect((await client.get('/api/plan', { headers })).status()).toBe(409);
    expect(
      (
        await client.put('/api/plan', {
          headers,
          data: {
            schemaVersion: document.schemaVersion,
            revision: document.revision,
            plan: document.plan
          }
        })
      ).status()
    ).toBe(409);
    expect(
      (
        await client.post('/api/household', {
          headers,
          data: { action: 'rename', target: 'Wrong kitchen' }
        })
      ).status()
    ).toBe(409);
    expect((await (await client.get('/api/account')).json()).household.name).toBe('Second');
  } finally {
    await client.dispose();
  }
});

test('an invitation survives sign-in and shows the household before joining', async ({
  page,
  playwright
}) => {
  const owner = await playwright.request.newContext({ baseURL: origin });
  try {
    await signIn(owner, `invite-owner-${randomUUID()}@example.test`);
    await householdAction(owner, { action: 'create', name: 'Shared supper' });
    const invite = await (await householdAction(owner, { action: 'invite' })).json();
    await page.goto(invite.url);
    await expect(page).toHaveURL(/\/sign-in\?next=/);
    const email = `guest-${randomUUID()}@example.test`;
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByRole('button', { name: 'Send code', exact: true }).click();
    const code = (await (await page.request.get('/api/dev/inbox')).json()).find(
      (mail: { email: string }) => mail.email === email
    ).code;
    await page.getByLabel('Sign-in code', { exact: true }).fill(code);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Join Shared supper', exact: true })
    ).toBeVisible();
    await page.getByRole('button', { name: 'Accept invitation', exact: true }).click();
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
    expect((await (await page.request.get('/api/account')).json()).household.role).toBe('member');
  } finally {
    await owner.dispose();
  }
});

test('sign-in stays light with a dark system preference and old theme setting', async ({
  page
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(() => localStorage.setItem('meal-prep:theme:v1', 'dark'));
  await page.goto('/sign-in');
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(250, 250, 246)');
  await expect(page.getByLabel('Email', { exact: true })).toHaveCSS('color', 'rgb(41, 68, 54)');
});

test('owners can promote a co-owner and step down without losing the household', async ({
  page,
  playwright
}) => {
  const email = `co-owner-${randomUUID()}@example.test`;
  const ownerEmail = `first-owner-${randomUUID()}@example.test`;
  await signIn(page.request, ownerEmail);
  await householdAction(page.request, { action: 'create', name: 'Two owners' });
  const guest = await playwright.request.newContext({ baseURL: origin });
  try {
    await signIn(guest, email);
    const invite = await (await householdAction(page.request, { action: 'invite' })).json();
    await householdAction(guest, { action: 'join', token: invite.url.split('/').pop() });
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page
      .locator('.wp-household-settings')
      .screenshot({ path: `/tmp/household-layout-${page.viewportSize()!.width}.png` });
    const row = page.locator('.wp-members li').filter({ hasText: email });
    const beforeMenu = await row.boundingBox();
    await expect(row.locator('.wp-account-avatar')).toBeVisible();
    await row.locator('summary').click();
    expect(await row.boundingBox()).toEqual(beforeMenu);
    await row.getByRole('button', { name: 'Make owner', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Add an owner?' })
      .getByRole('button', { name: 'Make owner', exact: true })
      .click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await row.locator('summary').click();
    await expect(row.getByRole('button', { name: 'Make member', exact: true })).toBeEnabled();
    await row.locator('summary').click();
    const self = page.locator('.wp-members li').filter({ hasText: ownerEmail });
    await expect(self).toContainText('Owner');
    await self.locator('summary').click();
    await self.getByRole('button', { name: 'Make member', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Change to member?' })
      .getByRole('button', { name: 'Make member', exact: true })
      .click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(self).toContainText('Member');
    await expect(row).toContainText('Owner');
    await expect(page.getByRole('button', { name: 'Make owner', exact: true })).toHaveCount(0);
    expect((await householdAction(guest, { action: 'leave' })).status()).toBe(400);
  } finally {
    await guest.dispose();
  }
});

test('active invitations persist and can be revoked individually', async ({ page }) => {
  await signIn(page.request, `invites-${randomUUID()}@example.test`);
  await householdAction(page.request, { action: 'create', name: 'Invitations' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const create = page.getByRole('button', { name: 'Create invite link', exact: true });
  await create.click();
  await expect(page.locator('.wp-invite-list li')).toHaveCount(1);
  await create.click();
  await expect(page.locator('.wp-invite-list li')).toHaveCount(2);
  await page.reload();
  await expect(page.locator('.wp-invite-list li')).toHaveCount(2);
  const rows = page.locator('.wp-invite-list li');
  const removedUrl = await rows.first().locator('.wp-invite-url').innerText();
  const keptUrl = await rows.last().locator('.wp-invite-url').innerText();
  await rows
    .first()
    .getByRole('button', { name: /^Revoke invite/ })
    .click();
  await page
    .getByRole('dialog', { name: 'Revoke invitation?' })
    .getByRole('button', { name: 'Revoke link', exact: true })
    .click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first().locator('.wp-invite-url')).toHaveText(keptUrl);
  expect(
    (await page.request.get('/api/household?invitation=' + removedUrl.split('/').pop())).status()
  ).toBe(400);
  await page
    .locator('.wp-household-settings')
    .screenshot({ path: `/tmp/household-invites-${page.viewportSize()!.width}.png` });
});

test('two household members plan and shop with automatic updates and independent edit merging', async ({
  page,
  browser
}) => {
  const { openPreparation } = await import('./weekly-fixtures');
  await signIn(page.request, `planning-owner-${randomUUID()}@example.test`);
  await householdAction(page.request, { action: 'create', name: 'Shared planning test' });
  const invitation = await (await householdAction(page.request, { action: 'invite' })).json();
  const phone = await browser.newContext({
    baseURL: origin,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true
  });
  try {
    await signIn(phone.request, `planning-member-${randomUUID()}@example.test`);
    expect(
      (
        await householdAction(phone.request, {
          action: 'join',
          token: invitation.url.split('/').pop()
        })
      ).ok()
    ).toBeTruthy();
    const shopper = await phone.newPage();
    await page.goto('/');
    await openPreparation(page);
    await page.getByRole('button', { name: /^Recipes/ }).click();
    await page.getByRole('button', { name: 'Add a recipe', exact: true }).click();
    await page.getByLabel('Name', { exact: true }).fill('Shared tomato soup');
    await page.getByRole('button', { name: 'Add ingredient', exact: true }).click();
    await page.getByRole('combobox', { name: 'Ingredient 1', exact: true }).fill('4 tomatoes');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
    await page.getByRole('button', { name: 'Agenda', exact: true }).click();
    await openPreparation(page);
    await page.getByRole('button', { name: 'Plan a cook', exact: true }).click();
    await page.getByRole('combobox', { name: 'Meal name', exact: true }).fill('Shared tomato soup');
    await page.getByRole('option', { name: /Shared tomato soup/ }).click();
    await page
      .getByRole('button', { name: /^Cooking day:/ })
      .first()
      .click();
    await page.getByLabel('Add ingredients to shopping list').check();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('button', { name: 'Add dinner on Sunday', exact: true }).click();
    await page.getByRole('button', { name: /Use a planned cook or leftovers/ }).click();
    await page.getByRole('button', { name: /Shared tomato soup.*portions available/ }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
    await shopper.goto('/');
    await openPreparation(shopper);
    await expect(shopper.locator('.wp-meal')).toHaveCount(1);
    await shopper.getByRole('button', { name: /^Shopping/ }).click();
    await page.getByRole('button', { name: /^Shopping/ }).click();
    await page.getByLabel('Shopping item', { exact: true }).fill('Bread');
    const tomatoes = shopper.getByRole('checkbox', { name: /tomato/i });
    await expect(tomatoes).toHaveCount(1);
    const before = await tomatoes
      .locator('xpath=ancestor::*[contains(@class,"wp-shopping-row")]')
      .boundingBox();
    await tomatoes.check();
    await expect(shopper.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
    const after = await tomatoes
      .locator('xpath=ancestor::*[contains(@class,"wp-shopping-row")]')
      .boundingBox();
    expect(after!.y).toBe(before!.y);
    // A second tap reverses an accidental check without moving the item.
    await tomatoes.uncheck();
    await expect(shopper.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
    await tomatoes.check();
    await expect(shopper.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
    await shopper.reload();
    await expect(shopper.getByRole('checkbox', { name: /tomato/i })).toBeChecked();
    // Typing holds background hydration, so saving must merge with the newer check-off.
    await expect(page.getByRole('checkbox', { name: /tomato/i })).not.toBeChecked();
    await page.getByRole('button', { name: 'Add shopping item', exact: true }).click();
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
    await expect(page.getByRole('checkbox', { name: /tomato/i })).toBeChecked();
    // The other member receives the addition without reloading.
    await expect(shopper.getByRole('checkbox', { name: 'Bread', exact: true })).toBeVisible({
      timeout: 12000
    });
    const persisted = await (await shopper.request.get('/api/plan')).json();
    expect(persisted.plan.weekly.shopping.some((item: { checked: boolean }) => item.checked)).toBe(
      true
    );
    expect(
      persisted.plan.weekly.shopping.some((item: { name: string }) => item.name === 'Bread')
    ).toBe(true);
    await shopper.screenshot({ path: '/tmp/household-shopping-phone.png', fullPage: true });
  } finally {
    await phone.close();
  }
});
