import { expect, test } from '@playwright/test';

test.describe('mode chooser', () => {
  test('every visit starts with the Local / API key choice', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('choose-local')).toBeVisible();
    await expect(page.getByTestId('choose-api')).toBeVisible();
    await page.getByTestId('choose-local').click();
    await expect(page).toHaveURL(/\/local\/video$/);
    await expect(page.getByTestId('mode-badge')).toHaveText('Local');
    await page.getByTestId('switch-mode').click();
    await expect(page.getByTestId('choose-api')).toBeVisible();
  });
});

test.describe('Local dashboard (no GPU, no API keys)', () => {
  test('shows only local features', async ({ page }) => {
    await page.goto('/local/video');
    await expect(page.getByTestId('local-shell')).toBeVisible();
    await expect(page.getByTestId('local-nav-video')).toBeVisible();
    await expect(page.getByTestId('local-nav-gallery')).toBeVisible();
    await expect(page.getByTestId('local-nav-settings')).toBeVisible();
    // models.json has no local image models, so there is no Image section.
    await expect(page.getByTestId('local-nav-image')).toHaveCount(0);
    // Cloud-only studios are not part of the Local dashboard.
    await expect(page.getByText('Lip Sync')).toHaveCount(0);
    await expect(page.getByTestId('model-mock-video').getByTestId('status-installed')).toBeVisible();
    await expect(page.getByTestId('model-wan-2.2-t2v').getByTestId('status-unreachable')).toBeVisible();
  });

  test('generates a mock video with live progress and shows it in the gallery', async ({ page }) => {
    await page.goto('/local/video');
    await page.getByTestId('model-mock-video').click();
    const generate = page.getByTestId('generate');
    await expect(generate).toBeDisabled();
    await page.getByTestId('prompt').fill('A paper boat drifting down a rainy street');
    await expect(generate).toBeEnabled();
    await generate.click();

    const card = page.getByTestId('job-card');
    await expect(card).toBeVisible();
    await expect(page.getByRole('progressbar')).toBeVisible();
    await expect(card).toHaveAttribute('data-status', 'succeeded', { timeout: 30_000 });

    const video = page.getByTestId('result-video');
    await expect(video).toBeVisible();
    const src = await video.getAttribute('src');
    expect(src).toMatch(/^\/api\/media\/studio\/[0-9a-f-]+\.mp4$/);
    const media = await page.request.get(src!, { headers: { Range: 'bytes=0-15' } });
    expect(media.status()).toBe(206);

    await page.getByTestId('local-nav-gallery').click();
    await expect(page.getByTestId('gallery-grid').getByText('A paper boat drifting down a rainy street')).toBeVisible();
  });

  test('cancels a running job', async ({ page }) => {
    await page.goto('/local/video');
    await page.getByTestId('model-mock-video').click();
    await page.getByTestId('prompt').fill('cancel me');
    await page.getByTestId('generate').click();
    await page.getByTestId('cancel').click();
    await expect(page.getByTestId('job-card')).toHaveAttribute('data-status', 'cancelled');
  });

  test('local settings show backends and models, not API keys', async ({ page }) => {
    await page.goto('/local/settings');
    await expect(page.getByTestId('wan2gp-url')).toBeVisible();
    await expect(page.getByTestId('model-status-list')).toBeVisible();
    await expect(page.getByTestId('key-input-muapi')).toHaveCount(0);
  });
});

test.describe('API key dashboard', () => {
  test('asks for a Muapi key first and can go back to the chooser', async ({ page }) => {
    await page.goto('/studio');
    await expect(page.getByPlaceholder(/key/i)).toBeVisible();
    await expect(page.getByTestId('local-shell')).toHaveCount(0);
    await page.getByTestId('back-to-modes').click();
    await expect(page.getByTestId('choose-local')).toBeVisible();
  });

  test('its settings page manages keys and never reveals them', async ({ page, request }) => {
    const secret = 'e2e-secret-key-0123456789';
    const saved = await request.put('/api/settings', { data: { keys: { fal: secret } } });
    expect(saved.ok()).toBe(true);
    expect(await saved.text()).not.toContain(secret);

    await page.goto('/settings');
    await expect(page.getByTestId('key-state-fal')).toHaveText('Saved');
    await expect(page.getByTestId('key-state-muapi')).toHaveText('Not set');
    await expect(page.getByTestId('wan2gp-url')).toHaveCount(0);
    expect(await page.content()).not.toContain(secret);

    await request.put('/api/settings', { data: { keys: { fal: '' } } });
  });
});
