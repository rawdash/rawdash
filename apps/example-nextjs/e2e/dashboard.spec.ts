import { expect, test } from '@playwright/test';

test('dashboard renders widgets without JS errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText('No data yet')).not.toBeVisible();

  await expect(page.getByText('Latest Run Conclusion')).toBeVisible();
  await expect(page.getByText('Run Count 7d')).toBeVisible();
  await expect(page.getByText('Successful Runs 7d')).toBeVisible();

  expect(errors).toHaveLength(0);
});

test('dashboard shows correct widget values', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByText('success', { exact: true })).toBeVisible();
  await expect(page.getByText('7')).toBeVisible();
  await expect(page.getByText('5')).toBeVisible();
});
