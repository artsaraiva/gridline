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

test('#150: Auental picked on the setup screen offers up to 32 Squads, shows a waiting screen, then its 12 points and 8 Elite Squads on the Rails', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/?seed=4&squads=8');
  const squads = page.getByLabel('Squads per Side');
  await expect(squads.locator('option')).toHaveText(['3', '4', '5', '6', '7', '8']);
  await page.getByLabel('Map').selectOption('auental');
  await expect(squads.locator('option')).toHaveText(['3', '4', '5', '6', '7', '8', '16', '24', '32']);
  await expect(squads).toHaveValue('8');
  await squads.selectOption('32');
  await page.getByRole('button', { name: 'Start match' }).click();
  await expect(page.locator('#loading')).toBeVisible();

  await expect(page.locator('#rail')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('#loading')).toBeHidden();
  await expect(page.locator('#score .pts svg')).toHaveCount(12);
  await expect(page.locator('#faction-sub')).toContainText('Auental');
  await expect(page.locator('#squads .tile')).toHaveCount(8); // #153: only the first 8 of 32 are on the Commander's net
  expect(errors).toEqual([]);
});

test('#150: back on Kaltenbach the Squads select drops 16, 24 and 32 and falls back to 8', async ({ page }) => {
  await page.goto('/?map=auental&squads=32');
  const squads = page.getByLabel('Squads per Side');
  await expect(squads).toHaveValue('32');
  await page.getByLabel('Map').selectOption('kaltenbach');
  await expect(squads.locator('option')).toHaveText(['3', '4', '5', '6', '7', '8']);
  await expect(squads).toHaveValue('8');
});

test('the mixer (#85): the speaker button opens the panel, M toggles mute, the levels survive a reload, nothing errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/?seed=4');
  await page.getByRole('button', { name: 'Start match' }).click();
  await expect(page.locator('#radio')).toBeVisible({ timeout: 15000 });
  await page.locator('canvas:not(#hud)').click({ position: { x: 750, y: 384 } }); // one tap unlocks audio

  const panel = page.locator('#mixer');
  await expect(panel).toBeHidden();
  await page.locator('#mixer-toggle').click();
  await expect(panel).toBeVisible();
  for (const [bus, level] of [['radio', '80'], ['chatter', '40'], ['combat', '60']]) await expect(panel.locator(`input[name=${bus}]`)).toHaveValue(level!);

  const mute = panel.getByRole('button');
  await expect(mute).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('m');
  await expect(mute).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('m');
  await expect(mute).toHaveAttribute('aria-pressed', 'false');

  await panel.locator('input[name=combat]').fill('25');
  await page.reload();
  await page.getByRole('button', { name: 'Start match' }).click();
  await expect(page.locator('#radio')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#mixer input[name=combat]')).toHaveValue('25');
  expect(errors).toEqual([]);
});
