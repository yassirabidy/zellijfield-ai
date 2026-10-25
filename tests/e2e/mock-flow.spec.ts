import { expect, test } from '@playwright/test';

test.describe('mock generation flow (no GPU, no API keys)', () => {
  test('opens Video Studio in Local mode without asking for a key', async ({ page }) => {
    await page.goto('/studio');
    await expect(page.getByTestId('local-video-studio')).toBeVisible();
    await expect(page.getByTestId('video-mode-local')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('model-mock-video').getByTestId('status-installed')).toBeVisible();
    // GPU backends are not running in this test environment.
    await expect(page.getByTestId('model-wan-2.2-t2v').getByTestId('status-unreachable')).toBeVisible();
  });

  test('generates a mock video with live progress and shows it in the gallery', async ({ page }) => {
    await page.goto('/studio/video');
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

    await page.goto('/gallery');
    await expect(page.getByTestId('gallery-grid').getByText('A paper boat drifting down a rainy street')).toBeVisible();
  });

  test('cancels a running job', async ({ page }) => {
    await page.goto('/studio/video');
    await page.getByTestId('model-mock-video').click();
    await page.getByTestId('prompt').fill('cancel me');
    await page.getByTestId('generate').click();
    await page.getByTestId('cancel').click();
    await expect(page.getByTestId('job-card')).toHaveAttribute('data-status', 'cancelled');
  });

  test('Muapi studios explain they need a key instead of blocking the app', async ({ page }) => {
    await page.goto('/studio/image');
    await expect(page.getByTestId('muapi-required')).toBeVisible();
  });

  test('settings never reveal keys', async ({ page, request }) => {
    const secret = 'e2e-secret-key-0123456789';
    const saved = await request.put('/api/settings', { data: { keys: { fal: secret } } });
    expect(saved.ok()).toBe(true);
    expect(await saved.text()).not.toContain(secret);

    await page.goto('/settings');
    await expect(page.getByTestId('key-state-fal')).toHaveText('Saved');
    await expect(page.getByTestId('key-state-muapi')).toHaveText('Not set');
    expect(await page.content()).not.toContain(secret);

    await request.put('/api/settings', { data: { keys: { fal: '' } } });
  });
});
