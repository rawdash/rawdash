import { expect, test } from '@playwright/test';

test('dashboard renders widgets without JS errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');

  await expect(page.getByText('No data yet')).not.toBeVisible();

  await expect(page.getByText('Stars')).toBeVisible();
  await expect(page.getByText('Forks')).toBeVisible();
  await expect(page.getByText('Contributors')).toBeVisible();
  await expect(page.getByText('Open Prs')).toBeVisible();
  await expect(page.getByText('Open Issues')).toBeVisible();
  await expect(page.getByText('Ci Status')).toBeVisible();
  await expect(page.getByText('Prs Merged Per Week')).toBeVisible();

  expect(errors).toHaveLength(0);
});

test('dashboard shows correct widget values', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByText('Success')).toBeVisible();
  await expect(page.getByText('42', { exact: true })).toBeVisible();
  await expect(page.getByText('15', { exact: true })).toBeVisible();
});
