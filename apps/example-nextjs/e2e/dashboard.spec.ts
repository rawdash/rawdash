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
  await expect(page.getByText('Prs Closed Per Week')).toBeVisible();

  expect(errors).toHaveLength(0);
});

test('renders a multi-connector widget with a per-series legend', async ({
  page,
}) => {
  await page.goto('/');

  await expect(page.getByText('Downloads By Platform')).toBeVisible();
  await expect(page.getByText('iOS', { exact: true })).toBeVisible();
  await expect(page.getByText('Android', { exact: true })).toBeVisible();
});

test('dashboard shows correct widget values', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByText('Success')).toBeVisible();
  await expect(page.getByText('42', { exact: true })).toBeVisible();
  await expect(page.locator('span').filter({ hasText: /^15$/ })).toBeVisible();
});

test('dashboard renders per-widget status (no_data and error)', async ({
  page,
}) => {
  await page.goto('/');

  await expect(page.getByText('Errors Per Hour')).toBeVisible();
  await expect(page.getByText('No matching data')).toBeVisible();

  await expect(page.getByText('Deploy Frequency')).toBeVisible();
  await expect(page.getByText('Show details')).toBeVisible();
  await page.getByText('Show details').click();
  await expect(
    page.getByText('connector auth failed: token expired'),
  ).toBeVisible();
});
