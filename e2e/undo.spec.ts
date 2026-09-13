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

test.describe('撤回最近一次提交', () => {
  test('录入三步后撤回第三步：刷新仍停在第三步，重新提交并完成八步', async ({ page }) => {
    await startSession(page)

    // 首步前（尚无任何提交）：不出现撤回入口
    await expect(page.getByTestId('step-no')).toHaveText('第 1 / 8 步')
    await expect(page.getByTestId('undo-last')).toHaveCount(0)

    await submitStep(page, '0.10', '0.00')
    await submitStep(page, '0.15', '-0.05')
    // 第三步抄录错误：超差值 0.30
    await submitStep(page, '0.30', '0.00')
    await expect(page.getByTestId('step-no')).toHaveText('第 4 / 8 步')
    await expect(page.getByTestId('history-row-2')).toContainText('+0.30')

    // 撤回入口标明将回到的色版角点（第 3 步 = 青版 · 右下）
    const undoButton = page.getByTestId('undo-last')
    await expect(undoButton).toContainText('青版')
    await expect(undoButton).toContainText('右下')

    const sessionId = await page.getByTestId('session-id').getAttribute('title')
    expect(sessionId).toBeTruthy()

    // 取消确认：保留原进度，历史行与检查点不变
    let dialogMessage = ''
    setDialogHandler(page, (d) => {
      dialogMessage = d.message()
      d.dismiss()
    })
    await undoButton.click()
    await expect(page.getByTestId('step-no')).toHaveText('第 4 / 8 步')
    await expect(page.getByTestId('history-row-2')).toBeVisible()
    // 确认框说明将回到哪个色版和角点
    expect(dialogMessage).toContain('青版')
    expect(dialogMessage).toContain('右下')
    const keptAfterDismiss = await page.evaluate((key) => {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as { nextIndex: number }).nextIndex : -1
    }, STORAGE_KEY)
    expect(keptAfterDismiss).toBe(3)

    // 确认撤回：历史表立即移除末行，输入区回到第三步
    setDialogHandler(page, (d) => d.accept())
    await undoButton.click()
    await expect(page.getByTestId('step-no')).toHaveText('第 3 / 8 步')
    await expect(page.getByTestId('current-point')).toContainText('青版')
    await expect(page.getByTestId('current-point')).toContainText('右下')
    await expect(page.getByTestId('checkpoint-info')).toContainText('已完成 2 / 8 步')
    await expect(page.getByTestId('history-row-2')).toHaveCount(0)
    await expect(page.getByTestId('history-row-0')).toContainText('+0.10')
    await expect(page.getByTestId('history-row-1')).toContainText('+0.15')
    // 会话编号与锁定单位保持不变
    await expect(page.getByTestId('session-id')).toHaveAttribute('title', sessionId!)
    await expect(page.getByTestId('session-unit')).toContainText('毫米')

    // 检查点被一次写入替换：读数 2 条、下一步索引 2
    const persisted = await page.evaluate((key) => {
      const raw = localStorage.getItem(key)
      return raw
        ? (JSON.parse(raw) as { nextIndex: number; values: unknown[]; sessionId: string })
        : null
    }, STORAGE_KEY)
    expect(persisted?.nextIndex).toBe(2)
    expect(persisted?.values).toHaveLength(2)
    expect(persisted?.sessionId).toBe(sessionId)

    // 刷新：仍停在第三步，被撤回的读数不复活
    await page.reload()
    await expect(page.getByTestId('measure-panel')).toBeVisible()
    await expect(page.getByTestId('step-no')).toHaveText('第 3 / 8 步')
    await expect(page.getByTestId('checkpoint-info')).toContainText('已完成 2 / 8 步')
    await expect(page.getByTestId('history-row-2')).toHaveCount(0)
    await expect(page.getByTestId('session-id')).toHaveAttribute('title', sessionId!)
    await expect(page.getByTestId('current-point')).toContainText('右下')

    // 重新提交仍经过既有范围校验：非法值原地拒绝、不推进
    await page.getByTestId('input-x').fill('3.00')
    await page.getByTestId('input-y').fill('0.00')
    await page.getByTestId('submit-step').click()
    await expect(page.getByTestId('error-x')).toContainText('范围')
    await expect(page.getByTestId('step-no')).toHaveText('第 3 / 8 步')

    // 用正确值重新提交第三步，随后完成八步
    await submitStep(page, '0.05', '0.00')
    await expect(page.getByTestId('history-row-2')).toContainText('+0.05')
    await submitStep(page, '0.10', '-0.10')
    await submitStep(page, '0.00', '0.05')
    await submitStep(page, '-0.10', '0.00')
    await submitStep(page, '0.05', '0.05')
    await submitStep(page, '0.00', '0.00')

    // 放行结论只基于新的八步数据：被撤回的 0.30 不影响结论
    await expect(page.getByTestId('verdict-title')).toHaveText('可开印')
    await expect(page.getByTestId('deviation-list')).toHaveCount(0)

    // 完成页不出现撤回入口
    await expect(page.getByTestId('undo-last')).toHaveCount(0)
  })

  test('完成后刷新：结果页仍无撤回入口', async ({ page }) => {
    await startSession(page)
    for (let i = 0; i < 8; i++) await submitStep(page, '0.05', '-0.05')
    await expect(page.getByTestId('verdict-title')).toHaveText('可开印')
    await expect(page.getByTestId('undo-last')).toHaveCount(0)

    await page.reload()
    await expect(page.getByTestId('result-panel')).toBeVisible()
    await expect(page.getByTestId('undo-last')).toHaveCount(0)
  })
})
