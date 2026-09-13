import { expect, test } from '@playwright/test'
import { STORAGE_KEY } from '../src/registration/steps'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY)
})

async function submitStep(
  page: import('@playwright/test').Page,
  x: string,
  y: string
) {
  await page.getByTestId('input-x').fill(x)
  await page.getByTestId('input-y').fill(y)
  await page.getByTestId('submit-step').click()
}

/** 起始页选择微米单位并开始新会话。 */
async function startMicrometerSession(page: import('@playwright/test').Page) {
  page.on('dialog', (d) => d.accept())
  await expect(page.getByTestId('start-panel')).toBeVisible()
  await page.getByTestId('unit-um').check()
  await page.getByTestId('start-new').click()
  await expect(page.getByTestId('measure-panel')).toBeVisible()
}

test.describe('微米单位会话', () => {
  test('从选择微米开始，刷新续作至完成：全程单位统一，结论与诊断数值等价', async ({ page }) => {
    await startMicrometerSession(page)

    // 录入界面全程按微米展示，单位随会话锁定
    await expect(page.getByTestId('session-unit')).toContainText('微米')
    await expect(page.getByTestId('range-hint')).toContainText('-2000 ~ +2000 µm')
    await expect(page.getByTestId('tolerance-hint')).toContainText('150 µm')
    await expect(page.getByTestId('measure-panel')).toContainText('X 偏移 (µm)')
    await expect(page.getByTestId('measure-panel')).toContainText('Y 偏移 (µm)')
    await expect(page.getByTestId('measure-panel')).not.toContainText('mm')

    // 不是 10 的整数倍：当前字段说明原因，不推进、不写盘
    await page.getByTestId('input-x').fill('115')
    await page.getByTestId('input-y').fill('0')
    await page.getByTestId('submit-step').click()
    await expect(page.getByTestId('error-x')).toContainText('10 µm')
    await expect(page.getByTestId('step-no')).toHaveText('第 1 / 8 步')

    // 超出 ±2000：同样原地拒绝
    await page.getByTestId('input-x').fill('2010')
    await page.getByTestId('submit-step').click()
    await expect(page.getByTestId('error-x')).toContainText('范围')
    await expect(page.getByTestId('step-no')).toHaveText('第 1 / 8 步')

    // 两次拒绝均未写盘：检查点仍是 0 条读数
    const afterReject = await page.evaluate((key) => {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as { values: unknown[]; nextIndex: number }) : null
    }, STORAGE_KEY)
    expect(afterReject?.values).toEqual([])
    expect(afterReject?.nextIndex).toBe(0)

    // 合法微米输入：青版四角一致 +200 µm（即 0.20 mm，整版平移）
    await submitStep(page, '200', '0')
    await submitStep(page, '200', '0')
    await submitStep(page, '200', '0')

    // 历史读数按微米显示；落盘仍是毫米（0.01 mm 精度）
    await expect(page.getByTestId('history-row-0')).toContainText('+200')
    await expect(page.getByTestId('history-panel')).toContainText('X (µm)')
    const persisted = await page.evaluate((key) => {
      const raw = localStorage.getItem(key)
      return raw
        ? (JSON.parse(raw) as { unit: string; values: Array<{ x: number; y: number }>; nextIndex: number })
        : null
    }, STORAGE_KEY)
    expect(persisted?.unit).toBe('um')
    expect(persisted?.values).toEqual([
      { x: 0.2, y: 0 },
      { x: 0.2, y: 0 },
      { x: 0.2, y: 0 }
    ])
    expect(persisted?.nextIndex).toBe(3)

    const sessionId = await page.getByTestId('session-id').getAttribute('title')
    expect(sessionId).toBeTruthy()

    // 中途刷新：停在第 4 步，单位仍锁定微米，已提交读数保留
    await page.reload()
    await expect(page.getByTestId('measure-panel')).toBeVisible()
    await expect(page.getByTestId('step-no')).toHaveText('第 4 / 8 步')
    await expect(page.getByTestId('checkpoint-info')).toContainText('已完成 3 / 8 步')
    await expect(page.getByTestId('session-id')).toHaveAttribute('title', sessionId!)
    await expect(page.getByTestId('session-unit')).toContainText('微米')
    await expect(page.getByTestId('range-hint')).toContainText('µm')
    await expect(page.getByTestId('history-row-0')).toContainText('+200')
    await expect(page.getByTestId('history-row-2')).toContainText('+200')
    await expect(page.getByTestId('current-point')).toContainText('青版')
    await expect(page.getByTestId('current-point')).toContainText('左下')

    // 刷新后非法微米输入仍在当前字段报错、不推进
    await page.getByTestId('input-x').fill('45')
    await page.getByTestId('input-y').fill('0')
    await page.getByTestId('submit-step').click()
    await expect(page.getByTestId('error-x')).toContainText('10 µm')
    await expect(page.getByTestId('step-no')).toHaveText('第 4 / 8 步')

    // 续作至完成：品红版前三角 +10 µm，末角 +200 µm（角点不一致）
    await submitStep(page, '200', '0')
    await submitStep(page, '10', '0')
    await submitStep(page, '10', '0')
    await submitStep(page, '10', '0')
    await submitStep(page, '200', '0')

    // 放行结论与毫米用例等价：需复调，超差清单按测量顺序、按微米展示
    await expect(page.getByTestId('verdict-title')).toHaveText('需复调')
    await expect(page.getByTestId('verdict-detail')).toContainText('150 µm')
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
    await expect(page.getByTestId('deviation-0')).toContainText('青版')
    await expect(page.getByTestId('deviation-0')).toContainText('X = +200 µm')
    await expect(page.getByTestId('deviation-7')).toContainText('品红版')
    await expect(page.getByTestId('deviation-7')).toContainText('左下')

    // 诊断数值与毫米用例等价：青版整版平移给反向建议，品红版角点不一致不给建议
    await expect(page.getByTestId('plate-diagnosis')).toContainText('残差阈值 50 µm')
    await expect(page.getByTestId('diagnosis-kind-cyan')).toContainText('整版平移')
    await expect(page.getByTestId('diagnosis-mean-cyan')).toContainText('X = +200 µm')
    await expect(page.getByTestId('diagnosis-mean-cyan')).toContainText('Y = +0 µm')
    await expect(page.getByTestId('advice-x-cyan')).toHaveText('X 调 -200 µm')
    // 零值建议不出现负零
    await expect(page.getByTestId('advice-y-cyan')).toHaveText('Y 调 +0 µm')
    await expect(page.getByTestId('diagnosis-kind-magenta')).toContainText('角点不一致，需逐角复测')
    await expect(page.getByTestId('advice-x-magenta')).toHaveCount(0)
    await expect(page.getByTestId('advice-y-magenta')).toHaveCount(0)

    // 结果区全程不出现毫米单位
    await expect(page.getByTestId('result-panel')).not.toContainText('mm')
  })

  test('微米会话完成后刷新：结论与单位展示保持一致', async ({ page }) => {
    await startMicrometerSession(page)
    for (let i = 0; i < 8; i++) await submitStep(page, '100', '-50')

    await expect(page.getByTestId('verdict-title')).toHaveText('可开印')
    await expect(page.getByTestId('verdict-detail')).toContainText('150 µm')

    await page.reload()
    await expect(page.getByTestId('verdict-title')).toHaveText('可开印')
    await expect(page.getByTestId('session-unit')).toContainText('微米')
    await expect(page.getByTestId('verdict-detail')).toContainText('150 µm')
    await expect(page.getByTestId('result-panel')).not.toContainText('mm')
  })

  test('未含单位字段的旧检查点按毫米载入并可续作', async ({ page }) => {
    await page.evaluate((key) => {
      const steps = [
        ['cyan', 'tl'], ['cyan', 'tr'], ['cyan', 'br'], ['cyan', 'bl'],
        ['magenta', 'tl'], ['magenta', 'tr'], ['magenta', 'br'], ['magenta', 'bl']
      ].map(([plate, corner], index) => ({ index, plate, corner }))
      // 模拟本次功能上线前的 v2 记录：没有 unit 字段
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 2,
          sessionId: 'legacy-no-unit',
          createdAt: Date.now(),
          steps,
          values: [{ x: 0.1, y: -0.05 }],
          nextIndex: 1
        })
      )
    }, STORAGE_KEY)
    await page.reload()

    await expect(page.getByTestId('measure-panel')).toBeVisible()
    await expect(page.getByTestId('session-unit')).toContainText('毫米')
    await expect(page.getByTestId('step-no')).toHaveText('第 2 / 8 步')
    await expect(page.getByTestId('history-row-0')).toContainText('+0.10')
    await expect(page.getByTestId('history-row-0')).toContainText('-0.05')
    await expect(page.getByTestId('range-hint')).toContainText('mm')

    // 按毫米续作一步
    await submitStep(page, '0.05', '0.00')
    await expect(page.getByTestId('step-no')).toHaveText('第 3 / 8 步')
  })

  test('检查点单位取值非法：明确阻断，不猜测单位', async ({ page }) => {
    await page.evaluate((key) => {
      const steps = [
        ['cyan', 'tl'], ['cyan', 'tr'], ['cyan', 'br'], ['cyan', 'bl'],
        ['magenta', 'tl'], ['magenta', 'tr'], ['magenta', 'br'], ['magenta', 'bl']
      ].map(([plate, corner], index) => ({ index, plate, corner }))
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 2,
          sessionId: 'bad-unit',
          createdAt: Date.now(),
          unit: 'inch',
          steps,
          values: [{ x: 0.1, y: 0 }],
          nextIndex: 1
        })
      )
    }, STORAGE_KEY)
    await page.reload()

    await expect(page.getByTestId('blocked-panel')).toBeVisible()
    await expect(page.getByTestId('blocked-message')).toContainText('单位')
    await expect(page.getByTestId('measure-panel')).toHaveCount(0)
  })
})
