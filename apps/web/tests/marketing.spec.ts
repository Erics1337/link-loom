import { test, expect } from '@playwright/test';

test.describe('Marketing Page Smoke Tests', () => {
  test('should load the homepage and display main hero content', async ({ page }) => {
    await page.goto('/');

    // Check title and basic branding
    await expect(page).toHaveTitle(/Link Loom/);
    await expect(page.getByText('Link Loom', { exact: true })).toBeVisible();

    // Check hero headline
    await expect(page.getByText('Weave your links into knowledge.')).toBeVisible();
    
    // Check call to action
    const ctaButton = page.getByRole('link', { name: 'Get Started for Free' });
    await expect(ctaButton).toBeVisible();
    await expect(ctaButton).toHaveAttribute('href', '/login');
  });

  test('should navigate to Features section', async ({ page }) => {
    await page.goto('/');
    
    // Click header link
    await page.getByRole('link', { name: 'Features' }).first().click();
    
    // Check if features header is visible
    await expect(page.getByText('Faster Workflow')).toBeVisible();
    await expect(page.getByText('Everything you need to manage your digital brain')).toBeVisible();
    
    // Check core feature points
    await expect(page.locator('dt').filter({ hasText: 'Semantic Search' })).toBeVisible();
    await expect(page.locator('dt').filter({ hasText: 'Auto-Tagging' })).toBeVisible();
    await expect(page.locator('dt').filter({ hasText: 'Shared Knowledge' })).toBeVisible();
  });

  test('should display pricing information correctly', async ({ page }) => {
    await page.goto('/');
    
    // Click pricing link from header navigation
    await page.getByRole('link', { name: 'Pricing' }).first().click();
    
    // Check pricing tier details
    await expect(page.getByRole('heading', { name: 'Pro Membership', level: 3 })).toBeVisible();
    await expect(page.getByText('$10', { exact: true })).toBeVisible();
    await expect(page.getByText('/month', { exact: true })).toBeVisible();
    
    // Verify feature list
    await expect(page.locator('li').filter({ hasText: 'Unlimited Bookmarks' })).toBeVisible();
    await expect(page.locator('li').filter({ hasText: 'Smart Bookmark Renaming' })).toBeVisible();
  });

  test('should contain legal links in footer', async ({ page }) => {
    await page.goto('/');
    
    const termsLink = page.locator('footer').getByRole('link', { name: 'Terms' });
    const privacyLink = page.locator('footer').getByRole('link', { name: 'Privacy' });
    const refundsLink = page.locator('footer').getByRole('link', { name: 'Refunds' });

    await expect(termsLink).toBeVisible();
    await expect(privacyLink).toBeVisible();
    await expect(refundsLink).toBeVisible();
  });
});
