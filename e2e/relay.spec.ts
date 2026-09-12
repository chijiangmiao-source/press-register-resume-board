import { expect, test } from '@playwright/test'
import { STORAGE_KEY } from '../src/registration/steps'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY)
})

async function startSession(page: import('@playwright/test').Page) {
  // 必须在触发点击前注册，否则 confirm 会被浏览器默认关闭（等同取消）
  page.on('dialog', (d) => d.accept())
  await page.getByTestId('start-new').click()
  await expect(page.getByTestId('measure-panel')).toBeVisible()
}

/** 替换页面 dialog 处理方式（Playwright 要求每个弹窗只能处理一次）。 */
function setDialogHandler(
  page: import('@playwright/test').Page,
  handler: (d: import('@playwright/test').Dialog) => void
): void {
  for (const listener of page.listeners('dialog')) {
    page.removeListener('dialog', listener as (...args: unknown[]) => void)
  }
  page.on('dialog', handler)
}

async function submitStep(
  page: import('@playwright/test').Page,
  x: string,
  y: string
) {
  await page.getByTestId('input-x').fill(x)
  await page.getByTestId('input-y').fill(y)
  await page.getByTestId('submit-step').click()
}

test.describe('四色套准复测接力板', () => {
  test('八步全部合格 -> 可开印', async ({ page }) => {
    await startSession(page)
    for (let i = 0; i < 8; i++) {
      await expect(page.getByTestId('step-no')).toHaveText(`第 ${i + 1} / 8 步`)
      await submitStep(page, '0.10', '-0.05')
    }
    await expect(page.getByTestId('verdict-title')).toHaveText('可开印')
    await expect(page.getByTestId('deviation-list')).toHaveCount(0)
  })

  test('非法输入被拒绝，修正后才推进', async ({ page }) => {
    await startSession(page)
    await page.getByTestId('input-x').fill('3.00')
    await page.getByTestId('input-y').fill('0.00')
    await page.getByTestId('submit-step').click()
    await expect(page.getByTestId('error-x')).toContainText('范围')
    await expect(page.getByTestId('step-no')).toHaveText('第 1 / 8 步')

    await page.getByTestId('input-x').fill('0.001')
    await page.getByTestId('submit-step').click()
    await expect(page.getByTestId('error-x')).toContainText('0.01')

    await page.getByTestId('input-x').fill('0.10')
    await page.getByTestId('submit-step').click()
    await expect(page.getByTestId('step-no')).toHaveText('第 2 / 8 步')
  })

  test('中途刷新：停在同一检查点并保留旧读数，续作后得到需复调结论', async ({ page }) => {
    await startSession(page)
    // 步骤 1 青左上 合格
    await submitStep(page, '0.10', '0.00')
    // 步骤 2 青右上 X 超差
    await submitStep(page, '0.20', '0.00')

    // 记录会话编号用于刷新后比对
    const sessionId = await page.getByTestId('session-id').getAttribute('title')
    expect(sessionId).toBeTruthy()

    // 调机中途误刷新
    await page.reload()
    await expect(page.getByTestId('measure-panel')).toBeVisible()
    await expect(page.getByTestId('step-no')).toHaveText('第 3 / 8 步')
    await expect(page.getByTestId('checkpoint-info')).toContainText('已完成 2 / 8 步')
    await expect(page.getByTestId('session-id')).toHaveAttribute('title', sessionId!)

    // 已提交旧读数原样保留、不可回改
    await expect(page.getByTestId('history-row-0')).toContainText('+0.10')
    await expect(page.getByTestId('history-row-1')).toContainText('+0.20')
    await expect(page.getByTestId('current-point')).toContainText('青版')
    await expect(page.getByTestId('current-point')).toContainText('右下')

    // 3 青右下, 4 青左下
    await submitStep(page, '0.00', '0.00')
    await submitStep(page, '0.00', '0.00')
    // 5 品红左上 X 超差
    await submitStep(page, '0.18', '0.00')
    // 6 品红右上 X 超差
    await submitStep(page, '-0.16', '0.00')
    // 7 品红右下, 8 品红左下
    await submitStep(page, '0.00', '0.00')
    await submitStep(page, '0.00', '0.00')

    await expect(page.getByTestId('verdict-title')).toHaveText('需复调')
    const deviations = page.getByTestId(/^deviation-\d+$/)
    await expect(deviations).toHaveCount(3)
    // 按测量顺序：青右上(2) -> 品红左上(5) -> 品红右上(6)
    await expect(page.getByTestId('deviation-1')).toContainText('青版')
    await expect(page.getByTestId('deviation-1')).toContainText('右上')
    await expect(page.getByTestId('deviation-1')).toContainText('X = +0.20')
    await expect(page.getByTestId('deviation-4')).toContainText('品红版')
    await expect(page.getByTestId('deviation-4')).toContainText('左上')
    await expect(page.getByTestId('deviation-5')).toContainText('品红版')
    await expect(page.getByTestId('deviation-5')).toContainText('右上')
    await expect(page.getByTestId('deviation-5')).toContainText('X = -0.16')
  })

  test('损坏的本地记录：明确阻断，重置后才能开始新会话', async ({ page }) => {
    await page.evaluate((key) => {
      localStorage.setItem(key, '{这不是JSON')
    }, STORAGE_KEY)
    await page.reload()

    await expect(page.getByTestId('blocked-panel')).toBeVisible()
    await expect(page.getByTestId('blocked-title')).toContainText('阻断')
    await expect(page.getByTestId('blocked-message')).toContainText('损坏')
    await expect(page.getByTestId('measure-panel')).toHaveCount(0)

    // 重置需确认；取消对话框时不清除
    const dismiss = (d: import('@playwright/test').Dialog) => d.dismiss()
    const accept = (d: import('@playwright/test').Dialog) => d.accept()
    setDialogHandler(page, dismiss)
    await page.getByTestId('reset-checkpoint').click()
    await expect(page.getByTestId('blocked-panel')).toBeVisible()

    setDialogHandler(page, accept)
    await page.getByTestId('reset-checkpoint').click()
    await expect(page.getByTestId('start-panel')).toBeVisible()

    await page.getByTestId('start-new').click()
    await expect(page.getByTestId('step-no')).toHaveText('第 1 / 8 步')
  })

  test('版本不匹配的本地记录：报版本错误并阻断', async ({ page }) => {
    await page.evaluate((key) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 999,
          sessionId: 'legacy',
          createdAt: Date.now(),
          steps: [],
          values: []
        })
      )
    }, STORAGE_KEY)
    await page.reload()
    await expect(page.getByTestId('blocked-message')).toContainText('版本不匹配')
    await expect(page.getByTestId('measure-panel')).toHaveCount(0)
  })

  test('开始新会话需确认：取消则保留旧检查点，接受才清除', async ({ page }) => {
    await startSession(page)
    for (let i = 0; i < 8; i++) await submitStep(page, '0.05', '-0.05')
    await expect(page.getByTestId('verdict-title')).toBeVisible()

    // 在结果面板点“开始新会话”，取消确认：旧检查点必须原样保留
    const dismiss = (d: import('@playwright/test').Dialog) => d.dismiss()
    const accept = (d: import('@playwright/test').Dialog) => d.accept()
    const keptBefore = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)
    setDialogHandler(page, dismiss)
    await page.getByTestId('restart-after-finish').click()
    await expect(page.getByTestId('result-panel')).toBeVisible()
    const keptAfter = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)
    expect(keptAfter).toBe(keptBefore)

    // 接受确认：清除旧检查点，回到第 1 步的新会话
    setDialogHandler(page, accept)
    await page.getByTestId('restart-after-finish').click()
    await expect(page.getByTestId('step-no')).toHaveText('第 1 / 8 步')
    await expect(page.getByTestId('checkpoint-info')).toContainText('已完成 0 / 8 步')
    const fresh = await page.evaluate((key) => {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as { values: unknown[] }).values.length : -1
    }, STORAGE_KEY)
    expect(fresh).toBe(0)
  })
})
