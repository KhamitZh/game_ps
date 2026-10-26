import { expect, test, type BrowserContext, type Page, type WebSocketRoute } from '@playwright/test';

const PASSWORD = process.env.HOST_PASSWORD ?? 'dev-password';

function watchErrors(page: Page, sink: string[]): void {
  page.on('pageerror', (e) => sink.push(e.message));
}

async function hostCreates(page: Page): Promise<string> {
  await page.goto('/host.html');
  await page.locator('#pw').fill(PASSWORD);
  await page.locator('#tl').fill('5');
  await page.locator('#lv').selectOption('python');
  await page.locator('#st').selectOption('conditions');
  await page.locator('.seg-opt', { has: page.locator('input[value=hard]') }).click();
  await page.locator('form button[type=submit]').click();
  const pinEl = page.locator('.pin');
  await expect(pinEl).toHaveText(/^\d{6}$/);
  await expect(page.locator('.host-head')).toContainText('Python › Шарттар › Қиын');
  return (await pinEl.textContent())!.trim();
}

async function startJoin(ctx: BrowserContext, pin: string, name: string, char: number, errors: string[]): Promise<Page> {
  const page = await ctx.newPage();
  watchErrors(page, errors);
  await page.goto(`/?pin=${pin}`);
  await page.locator('form button[type=submit]').click();
  await page.locator('#name').fill(name);
  await page.locator('form button[type=submit]').click();
  await page.locator('.char').nth(char).click();
  await page.locator('#join').click();
  return page;
}

async function join(ctx: BrowserContext, pin: string, name: string, char: number, errors: string[]): Promise<Page> {
  const page = await startJoin(ctx, pin, name, char, errors);
  await expect(page.locator('#lobbybar')).toBeVisible();
  return page;
}

test('host picker shows subtopics only for split topics and keeps choices', async ({ page }) => {
  await page.goto('/host.html');
  const row = page.locator('#subRow');
  await page.locator('#lv').selectOption('html');
  await expect(row).toBeHidden();
  await page.locator('#lv').selectOption('python');
  await expect(row).toBeVisible();
  await expect(page.locator('#st option')).toHaveCount(7);
  await page.locator('#st').selectOption('loops');
  await page.locator('.seg-opt', { has: page.locator('input[value=medium]') }).click();

  // Switching topic resets the subtopic but keeps the difficulty.
  await page.locator('#lv').selectOption('html');
  await page.locator('#lv').selectOption('python');
  await expect(page.locator('#st')).toHaveValue('all');
  await expect(page.locator('input[name=diff][value=medium]')).toBeChecked();

  // A language switch (top bar chip «Рус») re-renders the form with the same choices.
  await page.locator('#st').selectOption('loops');
  await page.locator('#topbar .chip', { hasText: 'Рус' }).click();
  await expect(page.locator('label[for=st]')).toHaveText('Раздел');
  await expect(page.locator('#st')).toHaveValue('loops');
  await expect(page.locator('input[name=diff][value=medium]')).toBeChecked();
});

test('full round: join, start, play, reload, stop, results', async ({ page, context }) => {
  const errors: string[] = [];
  watchErrors(page, errors);
  const pin = await hostCreates(page);

  const p1 = await join(context, pin, 'Аян', 0, errors);
  const p2 = await join(context, pin, 'Bota', 5, errors);
  await expect(page.locator('#rows tr')).toHaveCount(2);

  // Review Focus 4: same Cyrillic name, other case
  const dup = await startJoin(context, pin, 'аЯН', 2, errors);
  await expect(dup.locator('#name')).toBeVisible();
  await expect(dup.locator('.error')).not.toBeEmpty();
  await dup.close();

  await page.locator('#start').click();
  await expect(p1.locator('#hud')).toBeVisible({ timeout: 10_000 });
  await expect(p1.locator('#hud')).toContainText('0/10');

  await p1.bringToFront();
  await p1.keyboard.down('ArrowRight');
  await p1.waitForTimeout(500);
  await p1.keyboard.up('ArrowRight');

  // Review Focus 2: player reload keeps the game
  await p2.reload();
  await expect(p2.locator('#hud')).toBeVisible({ timeout: 10_000 });
  await expect(p2.locator('#screen')).toBeEmpty();

  // Review Focus 3: host reload keeps the dashboard
  await page.reload();
  await expect(page.locator('.pin')).toHaveText(pin);
  await expect(page.locator('#rows tr')).toHaveCount(2);

  page.once('dialog', (d) => d.accept());
  await page.locator('#stop').click();
  for (const p of [p1, p2]) {
    await expect(p.locator('.results')).toBeVisible();
    await expect(p.locator('.myplace')).toBeVisible();
  }
  await expect(page.locator('.podium')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a locked question modal is cleared after a reconnect', async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'desktop only');
  const errors: string[] = [];
  const pin = await hostCreates(page);

  const p = await context.newPage();
  watchErrors(p, errors);
  const routes: WebSocketRoute[] = [];
  let dropAnswers = false;
  await p.routeWebSocket(/\/ws\/\d{6}$/, (ws) => {
    routes.push(ws);
    const server = ws.connectToServer();
    ws.onMessage((m) => {
      if (dropAnswers && String(m).includes('"answer"')) return;
      server.send(m);
    });
  });
  await p.goto(`/?pin=${pin}`);
  await p.locator('form button[type=submit]').click();
  await p.locator('#name').fill('Net');
  await p.locator('form button[type=submit]').click();
  await p.locator('.char').nth(1).click();
  await p.locator('#join').click();
  await expect(p.locator('#lobbybar')).toBeVisible();

  await page.locator('#start').click();
  await expect(p.locator('#hud')).toBeVisible({ timeout: 10_000 });

  routes.at(-1)!.send(JSON.stringify({ t: 'question', question: { roomId: 'f1r1', q: 'Test?', options: ['a', 'b', 'c', 'd'] } }));
  await expect(p.locator('#modal')).toBeVisible();
  dropAnswers = true;
  await p.locator('.q-opt').first().click();
  await expect(p.locator('.q-close')).toBeDisabled();
  dropAnswers = false;

  await routes.at(-1)!.close({ code: 1011, reason: 'network blip' });
  await expect(p.locator('#modal')).toBeHidden({ timeout: 10_000 });
  await expect(p.locator('#hud')).toBeVisible();
  expect(errors).toEqual([]);
});

test('touch controls fit on a phone', async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'mobile only');
  const errors: string[] = [];
  const pin = await hostCreates(page);
  const p = await join(context, pin, 'Phone', 3, errors);
  await expect(p.locator('#touch .joy')).toBeInViewport();
  await expect(p.locator('#touch .act')).toBeInViewport();
  await expect(p.locator('#topbar')).toBeInViewport();
  expect(errors).toEqual([]);
});
