import { test, expect } from '@playwright/test';

const REAL_TREZOR = process.env.REAL_TREZOR === '1';
const ALLOW_PROMPT = process.env.REAL_TREZOR_ALLOW_PROMPT === '1';

test.describe('real trezor (manual device)', () => {
  test.skip(!REAL_TREZOR, 'Set REAL_TREZOR=1 to enable real device checks.');

  test('fetches a batch of Solana addresses via WebUSB', async ({ page }) => {
    test.skip(
      !ALLOW_PROMPT,
      'WebUSB requires an interactive device chooser. Set REAL_TREZOR_ALLOW_PROMPT=1 and run headed.'
    );

    await page.goto('/trezor-test.html');
    const webUsbSupported = await page.evaluate(() => !!(navigator as any).usb);
    test.skip(!webUsbSupported, 'WebUSB is not available in this environment');

    await page.getByTestId('init').click();
    await page.getByTestId('fetch').click();

    const items = page.locator('[data-testid="address-item"]');
    await expect(items).toHaveCount(3, { timeout: 120000 });

    const address0 = await items.nth(0).innerText();
    const address1 = await items.nth(1).innerText();

    expect(address0).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(address1).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(address0).not.toEqual(address1);
  });
});
