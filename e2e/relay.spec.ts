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

  test('字段改回合法值后旧行内错误立即消失，无需再次提交', async ({ page }) => {
    await startSession(page)
    await page.getByTestId('input-x').fill('3.00')
    await page.getByTestId('input-y').fill('0.00')
    await page.getByTestId('submit-step').click()
    await expect(page.getByTestId('error-x')).toContainText('范围')

    // 只把 X 改成合法值、不点击提交：旧错误应随输入同步消失，仍停在第 1 步
    await page.getByTestId('input-x').fill('0.10')
    await expect(page.getByTestId('error-x')).toHaveCount(0)
    await expect(page.getByTestId('step-no')).toHaveText('第 1 / 8 步')

    // 双轴报错时只修正一轴：另一轴错误保留
    await page.getByTestId('input-x').fill('9')
    await page.getByTestId('input-y').fill('abc')
    await page.getByTestId('submit-step').click()
    await expect(page.getByTestId('error-x')).toBeVisible()
    await expect(page.getByTestId('error-y')).toBeVisible()
    await page.getByTestId('input-x').fill('0.10')
    await expect(page.getByTestId('error-x')).toHaveCount(0)
    await expect(page.getByTestId('error-y')).toBeVisible()

    // 再修正 Y 后正常提交推进
    await page.getByTestId('input-y').fill('0.00')
    await expect(page.getByTestId('error-y')).toHaveCount(0)
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

    // 下一步索引是独立落盘字段，不靠旧读数数量反推
    const persisted = await page.evaluate((key) => {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as { nextIndex: number; values: unknown[] }) : null
    }, STORAGE_KEY)
    expect(persisted?.nextIndex).toBe(2)
    expect(persisted?.values).toHaveLength(2)    // 已提交旧读数原样保留、不可回改
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

  test('需复调：逐版诊断随对应色版展示（整版平移给反方向建议，角点不一致不给建议）', async ({ page }) => {
    await startSession(page)
    // 青版四角一致 +0.20（X 超差但属整版平移）
    for (let i = 0; i < 4; i++) await submitStep(page, '0.20', '0.00')
    // 品红版：前三角 +0.01，第四角 X 突出 +0.20 → 角点不一致
    for (let i = 0; i < 3; i++) await submitStep(page, '0.01', '0.00')
    await submitStep(page, '0.20', '0.00')

    await expect(page.getByTestId('verdict-title')).toHaveText('需复调')
    // 超差清单仍按测量顺序：青版四角 1..4，品红第 8 步
    const deviations = page.getByTestId(/^deviation-\d+$/)
    await expect(deviations).toHaveCount(5)
    const deviationIndexes = await deviations.evaluateAll((els) =>
      els.map((el) => (el as HTMLElement).dataset.testid)
    )
    expect(deviationIndexes).toEqual([
      'deviation-0',
      'deviation-1',
      'deviation-2',
      'deviation-3',
      'deviation-7'
    ])

    // 诊断区随原结论一并呈现，青版在前、品红版在后
    const diag = page.getByTestId('plate-diagnosis')
    await expect(diag).toBeVisible()
    const cyan = page.getByTestId('diagnosis-cyan')
    const magenta = page.getByTestId('diagnosis-magenta')
    await expect(cyan).toContainText('青版')
    await expect(magenta).toContainText('品红版')

    // 青版：整版平移，建议与均值方向相反，按 0.01 给出；无负零
    await expect(page.getByTestId('diagnosis-kind-cyan')).toContainText('整版平移')
    await expect(page.getByTestId('diagnosis-mean-cyan')).toContainText('X = +0.20')
    await expect(page.getByTestId('diagnosis-mean-cyan')).toContainText('Y = +0.00')
    await expect(page.getByTestId('advice-x-cyan')).toHaveText('X 调 -0.20 mm')
    await expect(page.getByTestId('advice-y-cyan')).toHaveText('Y 调 +0.00 mm')

    // 品红版：角点不一致，只给复测提示，不输出任何可能误导的调整量
    await expect(page.getByTestId('diagnosis-kind-magenta')).toContainText('角点不一致，需逐角复测')
    await expect(page.getByTestId('advice-x-magenta')).toHaveCount(0)
    await expect(page.getByTestId('advice-y-magenta')).toHaveCount(0)
  })

  test('可开印结论下不展示复调诊断建议', async ({ page }) => {
    await startSession(page)
    for (let i = 0; i < 8; i++) await submitStep(page, '0.00', '0.00')
    await expect(page.getByTestId('verdict-title')).toHaveText('可开印')
    await expect(page.getByTestId('plate-diagnosis')).toHaveCount(0)
    await expect(page.getByTestId('deviation-list')).toHaveCount(0)
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
          values: [],
          nextIndex: 0
        })
      )
    }, STORAGE_KEY)
    await page.reload()
    await expect(page.getByTestId('blocked-message')).toContainText('版本不匹配')
    await expect(page.getByTestId('measure-panel')).toHaveCount(0)
  })

  test('旧版记录（无独立下一步索引）：报版本错误，不能按读数数量猜进度', async ({ page }) => {
    await page.evaluate((key) => {
      // 模拟 v1 记录：只有 values，没有 nextIndex
      const steps = [
        ['cyan', 'tl'], ['cyan', 'tr'], ['cyan', 'br'], ['cyan', 'bl'],
        ['magenta', 'tl'], ['magenta', 'tr'], ['magenta', 'br'], ['magenta', 'bl']
      ].map(([plate, corner], index) => ({ index, plate, corner }))
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          sessionId: 'legacy-session',
          createdAt: Date.now(),
          steps,
          values: [{ x: 0.1, y: 0 }]
        })
      )
    }, STORAGE_KEY)
    await page.reload()
    await expect(page.getByTestId('blocked-panel')).toBeVisible()
    await expect(page.getByTestId('blocked-message')).toContainText('版本不匹配')
  })

  test('下一步索引与读数数量不一致：明确阻断，不按读数数量反推进度', async ({ page }) => {
    await startSession(page)
    await submitStep(page, '0.10', '0.00')
    await submitStep(page, '0.10', '0.00')

    // 篡改独立落盘的下一步索引（读数仍是 2 条）
    await page.evaluate((key) => {
      const raw = localStorage.getItem(key)
      const data = JSON.parse(raw ?? '{}') as { nextIndex: number }
      data.nextIndex = 5
      localStorage.setItem(key, JSON.stringify(data))
    }, STORAGE_KEY)

    await page.reload()
    await expect(page.getByTestId('blocked-panel')).toBeVisible()
    await expect(page.getByTestId('blocked-message')).toContainText('不一致')
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

  test('浏览器没有任何旧检查点时：首次开始测量不弹清除确认', async ({ page }) => {
    let dialogSeen = false
    page.on('dialog', (d) => {
      dialogSeen = true
      d.dismiss()
    })
    await expect(page.getByTestId('start-panel')).toBeVisible()
    await page.getByTestId('start-new').click()

    await expect(page.getByTestId('measure-panel')).toBeVisible()
    await expect(page.getByTestId('step-no')).toHaveText('第 1 / 8 步')
    expect(dialogSeen).toBe(false)
  })

  test('创建时间为有限但超出日期可表示范围的记录：明确报错并阻断续作', async ({ page }) => {
    await page.evaluate((key) => {
      const steps = [
        ['cyan', 'tl'], ['cyan', 'tr'], ['cyan', 'br'], ['cyan', 'bl'],
        ['magenta', 'tl'], ['magenta', 'tr'], ['magenta', 'br'], ['magenta', 'bl']
      ].map(([plate, corner], index) => ({ index, plate, corner }))
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 2,
          sessionId: 'broken-time',
          createdAt: 1e20, // 有限数值，但 new Date(1e20) 为 Invalid Date
          steps,
          values: [{ x: 0.1, y: 0 }],
          nextIndex: 1
        })
      )
    }, STORAGE_KEY)

    await page.reload()
    await expect(page.getByTestId('blocked-panel')).toBeVisible()
    await expect(page.getByTestId('blocked-message')).toContainText('创建时间')
    await expect(page.getByTestId('measure-panel')).toHaveCount(0)
    // 界面不得渲染出 NaN 时间
    await expect(page.getByTestId('session-created')).toHaveCount(0)
  })
})
