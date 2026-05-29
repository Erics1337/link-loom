import { expect, test } from '@playwright/test';

test.describe('marketing site', () => {
  test('loads the homepage hero and primary CTA', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveTitle(/Link Loom/);
    await expect(page.getByRole('heading', { name: 'Link Loom', level: 1 })).toBeVisible();
    await expect(page.getByText(/Turn years of saved tabs into a searchable map/)).toBeVisible();

    const ctaButton = page.getByRole('link', { name: /Join waitlist for early access/ });
    await expect(ctaButton).toBeVisible();
    await expect(ctaButton).toHaveAttribute('href', '#waitlist');
  });

  test('navigates to feature and pricing sections', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('link', { name: 'Workflow' }).first().click();
    await expect(page.getByText('Import browser bookmarks from the extension.')).toBeVisible();
    await expect(page.getByText('Search by meaning')).toBeVisible();

    await page.getByRole('link', { name: 'Pricing' }).first().click();
    await expect(page.getByRole('heading', { name: 'Pro Membership', level: 3 })).toBeVisible();
    await expect(page.getByText('$29', { exact: true })).toBeVisible();
  });

  test('exposes legal footer links', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('footer').getByRole('link', { name: 'Terms' })).toBeVisible();
    await expect(page.locator('footer').getByRole('link', { name: 'Privacy' })).toBeVisible();
    await expect(page.locator('footer').getByRole('link', { name: 'Refunds' })).toBeVisible();
  });
});
