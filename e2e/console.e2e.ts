// Console smoke test (#44): page loads, map and Rails chrome render, arming an Asset and confirming sends a Command the Sim host receives.
import { expect, test } from '@playwright/test';

test('Console loads, renders the map and Rails chrome, and confirming an armed Asset reaches the Sim host', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/?seed=4&squads=8');
  await page.getByRole('button', { name: 'Start match' }).click();

  await expect(page.locator('#rail')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#score .pts svg')).toHaveCount(5);
  await expect(page.locator('#squads .tile')).toHaveCount(8);

  // Opening a Squad tile in place into the 248 px card
  await page.locator('#squads .tile').first().click();
  const card = page.locator('#squads .card');
  await expect(card).toBeVisible();
  expect((await card.boundingBox())?.width).toBe(248);

  // Arm Scan UAV, pin a spot on the map, and confirm: the Sim host receives the Command and starts the active Scan effect
  const scanRow = page.locator('#assets .asset').first();
  await expect(scanRow).toHaveClass(/ready/);
  await scanRow.click();
  await expect(scanRow).toHaveClass(/armed/);

  const mapCanvas = page.locator('canvas:not(#hud)');
  await mapCanvas.click({ position: { x: 750, y: 384 } });
  await expect(page.locator('#confirm')).toBeVisible();
  await page.locator('#confirm').click();

  await expect(scanRow).toHaveClass(/active/);
});
