// Console smoke test (#44): page loads, map and chrome render, arming an Asset and confirming sends a Command the Sim host receives.
import { expect, test } from '@playwright/test';

test('Console loads, renders the map and chrome, and confirming an armed Asset reaches the Sim host', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/?seed=4&squads=8');
  await page.getByRole('button', { name: 'Start match' }).click();

  await expect(page.locator('#rail')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#score .pts svg')).toHaveCount(5);
  await expect(page.locator('#squads .tile')).toHaveCount(8);

  // Opening a Squad tile in place into the 264 px card
  await page.locator('#squads .tile').first().click();
  const card = page.locator('#squads .card');
  await expect(card).toBeVisible();
  expect((await card.boundingBox())?.width).toBe(264);

  // Arm Scan UAV (#181: the A cell of the keypad), pin a spot on the map, and confirm: the Sim host receives the Command and starts the active Scan effect
  const scanCell = page.locator('#assets .cell[data-key="A"]');
  await expect(scanCell).toHaveClass(/ready/);
  await scanCell.click();
  await expect(scanCell).toHaveClass(/armed/);

  const mapCanvas = page.locator('canvas:not(#hud)');
  await mapCanvas.click({ position: { x: 750, y: 384 } });
  await expect(page.locator('#confirm')).toBeVisible();
  await page.locator('#confirm').click();

  await expect(scanCell).toHaveClass(/active/);
});

test('#181: the Asset keypad: each key arms the cell in its place, held slots arm nothing, the readout names the cell, the Confirm row shows under it while armed', async ({ page }) => {
  test.slow(); // every step waits on a drawn frame, and headless Chromium's software WebGL draws few while the other browsers run
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/?seed=4&squads=8');
  await page.getByRole('button', { name: 'Start match' }).click();
  await expect(page.locator('#rail')).toBeVisible({ timeout: 15000 });

  const cell = (key: string) => page.locator(`#assets .cell[data-key="${key}"]`);
  const armed = page.locator('#assets .cell.armed');
  const readout = page.locator('#assets .readout');
  const confirmRow = page.locator('#assets .cfrow');
  await expect(page.locator('#assets .cell')).toHaveCount(15);
  expect(await cell('Q').boundingBox()).toMatchObject({ width: 48, height: 48 });
  expect(await page.locator('#assets .pad').boundingBox()).toMatchObject({ x: 16, y: 16, width: 256, height: 212 });

  // At rest: no readout, no Confirm row; the gated Cruise Missile shows the keystone it needs
  await expect(readout).toBeHidden();
  await expect(confirmRow).toBeHidden();
  await expect(cell('R')).toHaveClass(/off/);
  await expect(cell('R').locator('.slot svg')).toHaveCount(1);

  // The pad is the keyboard: A arms the Scan UAV, Z the Supply Drop in its place, Esc cancels
  await page.keyboard.press('a');
  await expect(cell('A')).toHaveClass(/armed/);
  await expect(readout.locator('.nm')).toHaveText('Scan UAV');
  await expect(readout.locator('.st')).toHaveText('');
  await expect(confirmRow).toBeVisible();
  await expect(confirmRow.locator('.cf span')).toHaveText('Tap the map');
  await page.keyboard.press('z');
  await expect(cell('Z')).toHaveClass(/armed/);
  await expect(armed).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(armed).toHaveCount(0);
  await expect(confirmRow).toBeHidden();

  // B is held for vehicle tasking, which has not shipped; the Barrage, EMP Strike and Feint start the match cooling; M is the mixer's: none arms anything
  for (const key of ['b', 'w', 'f', 'g', 'm']) await page.keyboard.press(key);
  await expect(armed).toHaveCount(0);
  await expect(cell('B')).toHaveClass(/held/);
  await expect(cell('F')).toHaveClass(/cooling/);

  // V is the Mark: no Confirm row; Esc leaves Mark mode
  await expect(cell('V').locator('.slot')).toHaveText(/^\d\/3$/);
  await page.keyboard.press('v');
  await expect(cell('V')).toHaveClass(/armed/);
  await expect(readout.locator('.nm')).toHaveText('Mark');
  await expect(confirmRow).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(cell('V')).toHaveClass(/ready/);

  // Hovering a cell names it with its state
  await cell('D').hover();
  await expect(readout.locator('.nm')).toHaveText('Smoke Screen');
  await expect(readout.locator('.st')).toHaveText('READY');
  await cell('R').hover();
  await expect(readout.locator('.st')).toHaveText(/^NEEDS/); // then the keystone's frame
  await expect(readout.locator('.st svg')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('#150: Auental picked on the setup screen offers up to 32 Squads, shows a waiting screen, then its 12 points and 8 Elite Squads on the Squad tiles', async ({ page }) => {
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

test('#147: the score strip stays centred from 1280 × 720 up and, on a narrower window, keeps a panel gap clear of the Asset keypad', async ({ page }) => {
  test.slow(); // Auental's map loads behind a waiting screen
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?map=auental&squads=3');
  await page.getByRole('button', { name: 'Start match' }).click();
  await expect(page.locator('#rail')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('#score .pts svg')).toHaveCount(12); // Auental's strip, the widest

  const strip = page.locator('#score');
  let s = (await strip.boundingBox())!;
  expect(s.x + s.width / 2).toBeCloseTo(640, 0);

  await page.setViewportSize({ width: 1024, height: 768 }); // centred, its left end would run under the pad's T cell
  s = (await strip.boundingBox())!;
  const pad = (await page.locator('#assets').boundingBox())!;
  expect(s.x).toBeCloseTo(pad.x + pad.width + 16, 0);
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
