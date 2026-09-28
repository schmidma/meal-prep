import { expect, type Route } from '@playwright/test';
import { test } from './fixtures';

const themeChoice = (page: import('@playwright/test').Page) => page.locator('button.theme-toggle');
const theme = (page: import('@playwright/test').Page, value: string) =>
  expect(page.locator('html')).toHaveAttribute('data-theme', value);

async function contrast(page: import('@playwright/test').Page, selector: string) {
  return page
    .locator(selector)
    .first()
    .evaluate((element) => {
      const color = (value: string) => {
        const parts =
          value
            .match(/[\d.]+/g)
            ?.slice(0, 3)
            .map(Number) ?? [];
        return parts.map((n) => {
          const x = n / 255;
          return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
        });
      };
      const luminance = (value: string) => {
        const [r, g, b] = color(value);
        return r * 0.2126 + g * 0.7152 + b * 0.0722;
      };
      const style = getComputedStyle(element);
      const foreground = luminance(style.color);
      let ancestor: Element | null = element;
      let background = '';
      while (ancestor) {
        const candidate = getComputedStyle(ancestor).backgroundColor;
        if (candidate !== 'rgba(0, 0, 0, 0)' && candidate !== 'transparent') {
          background = candidate;
          break;
        }
        ancestor = ancestor.parentElement;
      }
      const surface = luminance(background);
      return (Math.max(foreground, surface) + 0.05) / (Math.min(foreground, surface) + 0.05);
    });
}

test('system follows live changes, overrides persist, and returning to system clears preference without saving plan', async ({
  page
}) => {
  let writes = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/plan') && request.method() === 'PUT') writes++;
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await theme(page, 'dark');
  await expect(themeChoice(page)).toHaveAttribute('data-theme-choice', 'system');
  await page.emulateMedia({ colorScheme: 'light' });
  await theme(page, 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await theme(page, 'dark');
  await themeChoice(page).click();
  await expect(themeChoice(page)).toHaveAttribute('data-theme-choice', 'light');
  await theme(page, 'light');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await theme(page, 'light');
  await page.reload();
  await theme(page, 'light');
  await expect(themeChoice(page)).toHaveAttribute('data-theme-choice', 'light');
  expect(await page.evaluate(() => localStorage.getItem('meal-prep:theme:v1'))).toBe('light');
  await themeChoice(page).click();
  await theme(page, 'dark');
  await page.reload();
  await theme(page, 'dark');
  await expect(themeChoice(page)).toHaveAttribute('data-theme-choice', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('meal-prep:theme:v1'))).toBe('dark');
  await themeChoice(page).click();
  await theme(page, 'dark');
  expect(await page.evaluate(() => localStorage.getItem('meal-prep:theme:v1'))).toBeNull();
  await page.emulateMedia({ colorScheme: 'light' });
  await theme(page, 'light');
  await page.reload();
  await expect(themeChoice(page)).toHaveAttribute('data-theme-choice', 'system');
  await theme(page, 'light');
  expect(writes).toBe(0);
});

test('theme button cycles System, Light, Dark and back using mouse and keyboard', async ({
  page
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const button = themeChoice(page);
  await expect(button).toHaveAttribute('data-theme-choice', 'system');
  await expect(button).toHaveAttribute('aria-label', 'Theme: System. Switch to light theme');
  await expect(button).toHaveAttribute('title', 'Theme: System. Switch to light theme');
  await button.click();
  await expect(button).toHaveAttribute('data-theme-choice', 'light');
  await expect(button).toHaveAttribute('aria-label', 'Theme: Light. Switch to dark theme');
  await button.focus();
  await button.press('Enter');
  await expect(button).toHaveAttribute('data-theme-choice', 'dark');
  await theme(page, 'dark');
  await expect(button).toHaveAttribute('aria-label', 'Theme: Dark. Switch to system theme');
  await button.press('Space');
  await expect(button).toHaveAttribute('data-theme-choice', 'system');
  await theme(page, 'light');
  expect(await page.evaluate(() => localStorage.getItem('meal-prep:theme:v1'))).toBeNull();
});

test('saved dark choice applies before application scripts load', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(() => localStorage.setItem('meal-prep:theme:v1', 'dark'));
  const blockScripts = (route: Route) =>
    route.request().resourceType() === 'script' ? route.abort() : route.fallback();
  await page.route('**/*', blockScripts);
  await page.goto('/');
  await theme(page, 'dark');
  await expect(page.locator('.workspace')).toHaveCount(0);
  const initial = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return { scheme: style.colorScheme, background: style.backgroundColor };
  });
  expect(initial.scheme).toBe('dark');
  expect(
    initial.background
      .match(/\d+/g)
      ?.slice(0, 3)
      .map(Number)
      .every((channel) => channel < 65)
  ).toBe(true);
  await page.unroute('**/*', blockScripts);
  await page.reload();
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
  await theme(page, 'dark');
});

test('light system preference is the initial light appearance', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await theme(page, 'light');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(
    'light'
  );
});

test('invalid choice falls back to system; blocked storage still allows explicit choices', async ({
  page
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(() => {
    try {
      localStorage.setItem('meal-prep:theme:v1', 'invalid');
    } catch {
      /* The second load deliberately blocks storage. */
    }
  });
  await page.goto('/');
  await theme(page, 'dark');
  await expect(themeChoice(page)).toHaveAttribute('data-theme-choice', 'system');
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('Storage blocked');
      }
    });
  });
  await page.reload();
  await theme(page, 'dark');
  await expect(themeChoice(page)).toHaveAttribute('data-theme-choice', 'system');
  await themeChoice(page).click();
  await theme(page, 'light');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await theme(page, 'light');
  await themeChoice(page).click();
  await theme(page, 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await theme(page, 'dark');
  await themeChoice(page).click();
  await expect(themeChoice(page)).toHaveAttribute('data-theme-choice', 'system');
  await theme(page, 'light');
});

test('storage updates synchronize overrides and returning to system', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.setItem('meal-prep:theme:v1', 'light');
    window.dispatchEvent(new StorageEvent('storage', { key: 'meal-prep:theme:v1' }));
  });
  await expect(themeChoice(page)).toHaveAttribute('data-theme-choice', 'light');
  await theme(page, 'light');
  await page.evaluate(() => {
    localStorage.removeItem('meal-prep:theme:v1');
    window.dispatchEvent(new StorageEvent('storage', { key: 'meal-prep:theme:v1' }));
  });
  await expect(themeChoice(page)).toHaveAttribute('data-theme-choice', 'system');
  await theme(page, 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await theme(page, 'light');
});

test('dark calendar, tray, native controls and popover remain readable', async ({ page }, info) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await theme(page, 'dark');
  await expect(page.locator('[data-time-day]')).toHaveCount(7);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(
    'dark'
  );
  expect(await page.locator('meta[name="theme-color"]').getAttribute('content')).toBe('#171f1d');
  for (const selector of [
    '.brand',
    '.workspace-heading h1',
    '.calendar-day-header strong',
    '.food-copy strong',
    '.secondary-button',
    '.jump-date'
  ]) {
    expect(await contrast(page, selector), selector).toBeGreaterThan(4.5);
  }
  await expect(page.locator('.home-tray')).toBeVisible();
  await page.locator('.calendar-scroll').evaluate((element) => {
    element.scrollTop = 1000;
  });
  await page.screenshot({ path: info.outputPath('dark.png'), fullPage: true });
  await page
    .getByTestId('activity-cook-curry')
    .getByRole('button', { name: /Edit Cook/ })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Activity', exact: true });
  await expect(dialog).toBeVisible();
  expect(await contrast(page, '.quick-popover .popover-eyebrow')).toBeGreaterThan(4.5);
  expect(await contrast(page, '.batch-heading label')).toBeGreaterThan(4.5);
  await page.screenshot({
    path: info.outputPath('dark-popover.png'),
    fullPage: true
  });
  await page.getByRole('button', { name: 'Close details' }).click();
  await page.locator('.empty-calendar').first().press('Enter');
  const quick = page.getByRole('dialog', { name: 'Quick add' });
  await expect(quick).toBeVisible();
  expect(await contrast(page, '.quick-submit')).toBeGreaterThan(4.5);
  await quick.getByRole('button', { name: /Add to plan/ }).hover();
  expect(await contrast(page, '.quick-submit')).toBeGreaterThan(4.5);
  await page.getByRole('button', { name: 'Close details' }).click();
});
