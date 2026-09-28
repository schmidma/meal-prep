import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';
import { textContrast } from './contrast';

async function readable(page: Page, selector: string) {
  const ratio = await textContrast(page.locator(selector).first());
  expect(ratio, `${selector}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
}

for (const scheme of ['light', 'dark'] as const) {
  test(`${scheme} palette keeps content, controls, warnings and popovers readable`, async ({
    page
  }, info) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    await expect(page.locator('[data-time-day]')).toHaveCount(7);
    await expect(page.locator('.home-tray')).toBeVisible();

    const surfaces = await page.evaluate(() =>
      [
        'body',
        '.home-tray',
        'input',
        '.calendar-grid',
        '.calendar-day',
        '.time-card.cook',
        '.time-card.meal',
        '.time-card.other'
      ].map((selector) => getComputedStyle(document.querySelector(selector)!).backgroundColor)
    );
    expect(new Set(surfaces).size).toBe(surfaces.length);
    expect(surfaces[0]).toBe(scheme === 'light' ? 'rgb(246, 247, 242)' : 'rgb(23, 31, 29)');

    for (const selector of [
      '.brand',
      '.workspace-heading h1',
      ...(info.project.name === 'desktop'
        ? ['.tray-intro', '.tray-help']
        : ['.tray-section-title h2']),
      '.food-chip .food-copy strong',
      '.food-chip .food-copy small',
      '.prepared-chip .food-copy strong',
      '.calendar-day-header span',
      '.hour-rail span:nth-child(13)',
      '.time-card.cook .time-card-title strong',
      '.time-card.cook .time-card-meta',
      '.time-card.cook .time-card-food',
      '.time-card.meal .time-card-meta',
      '.block-main small',
      '.calendar-footer .text-button',
      '.app-footer',
      '.secondary-button',
      '.save-status'
    ]) {
      await readable(page, selector);
    }
    for (const selector of [
      '.food-chip .drag-grip',
      '.prepared-chip .drag-grip',
      '.time-card.cook .drag-grip',
      '.time-card.meal .drag-grip',
      '.block-main .drag-grip'
    ])
      expect(
        await textContrast(page.locator(selector).first(), false),
        selector
      ).toBeGreaterThanOrEqual(3);
    for (const selector of [
      '.time-card.cook .resize-handle span',
      '.time-card.meal .resize-handle span',
      '.time-block .resize-handle span'
    ])
      expect(
        await textContrast(page.locator(selector).first(), false, true),
        selector
      ).toBeGreaterThanOrEqual(3);
    const foodAdd = page.locator('.food-add').first();
    await foodAdd.locator('input').fill('Beans');
    await expect(foodAdd.locator('button')).toBeEnabled();
    expect(await textContrast(foodAdd.locator('button'), false)).toBeGreaterThanOrEqual(3);
    await foodAdd.locator('input').clear();
    await page.locator('.secondary-button').first().hover();
    await readable(page, '.secondary-button:hover');
    await page.locator('.calendar-scroll').evaluate((element) => (element.scrollTop = 1000));
    await page.screenshot({
      path: info.outputPath(`${scheme}.png`),
      fullPage: true
    });

    await page
      .getByTestId('activity-cook-curry')
      .getByRole('button', { name: /Edit Cook/ })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Activity', exact: true });
    await expect(dialog).toBeVisible();
    for (const selector of [
      '.quick-popover .popover-eyebrow',
      '.batch-heading label',
      '.batch-heading small',
      '.allocation-line',
      '.quick-popover .popover-footer',
      '.quick-popover .plan-meal-button'
    ]) {
      await readable(page, selector);
    }
    expect(
      await textContrast(dialog.locator('.allocation-line .icon-button').first(), false)
    ).toBeGreaterThanOrEqual(3);
    await page.screenshot({
      path: info.outputPath(`${scheme}-popover.png`),
      fullPage: true
    });
    const tuesday = await page.locator('[data-time-day]').nth(1).getAttribute('data-time-day');
    await dialog.locator('.move-details summary').click();
    await dialog.getByLabel('Activity date').fill(tuesday!);
    await dialog.getByLabel('Activity time').fill('18:30');
    await dialog.getByLabel('Activity time').press('Tab');
    await expect(dialog.locator('.inline-warning').first()).toBeVisible();
    await readable(page, '.inline-warning');
    await readable(page, '.quick-popover .inline-fields input');
    await page.getByRole('button', { name: 'Close details' }).click();
    const card = page.getByTestId('activity-cook-curry');
    await expect(card).toHaveClass(/has-warning/);
    await readable(page, '[data-testid="activity-cook-curry"] .time-card-meta');
    expect(await textContrast(card.locator('.warning-dot'), false)).toBeGreaterThanOrEqual(3);
    const warningBorder = await card.evaluate((element) => getComputedStyle(element).borderColor);
    expect(warningBorder).toBe(scheme === 'light' ? 'rgb(177, 116, 50)' : 'rgb(237, 186, 117)');
    await page.locator('.empty-calendar').first().press('Enter');
    const quick = page.getByRole('dialog', { name: 'Quick add' });
    await expect(quick).toBeVisible();
    await readable(page, '.quick-submit');
    await quick.getByRole('button', { name: /Add to plan/ }).hover();
    await readable(page, '.quick-submit:hover');
    await page.getByRole('button', { name: 'Close details' }).click();
  });
}
