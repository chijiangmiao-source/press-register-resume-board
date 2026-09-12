# 四色套准复测接力板

印刷机调校过程中，平板可能被误刷新。本应用是一个**只在浏览器运行**的四色套准复测接力板：
TypeScript + Vue 3 + Vite，无业务后端、不访问任何在线服务。一次会话的进度以检查点形式
原子写入 `localStorage`，刷新、关闭后重开都停在同一步，避免漏检色版或重复采用旧读数。

## 测量规则

- 一次会话固定依次测量 **青版、品红版**（黑版为基准），每版按
  **左上 → 右上 → 右下 → 左下** 提交，共八步，顺序不可调整。
- 每步录入相对黑版的 **X、Y 偏移（mm）**：
  - 范围 **−2.00 ~ +2.00 mm**，精确到 **0.01 mm**；
  - **两个值都合法才推进**；任一非法则行内报错，不前进、不写检查点。
- **已提交步骤不可回改**。
- 每次推进后，会话编号、八步定义、已提交值与下一步索引通过**一次** `setItem`
  原子写入 `localStorage`（键：`registration-relay-board:session:v1`）。
- 八步完成后：
  - 所有 |X|、|Y| 均 **≤ 0.15 mm** → 显示 **“可开印”**；
  - 否则显示 **“需复调”**，并按测量顺序列出全部超差色版、角点及超差轴偏移。
- **新会话必须经确认后才会清除旧检查点**。
- 本地记录损坏或版本不匹配时**明确报错并阻断续作**，提供重置入口，绝不猜测进度。

## 本地开发

```bash
npm install
npm run dev        # http://localhost:5173
```

## 测试

```bash
npm run typecheck  # vue-tsc 类型检查
npm run test       # Vitest：状态迁移 / 恢复 / 非法推进拒绝 / 结论判定
npx playwright install chromium   # 首次需要下载浏览器
npm run e2e        # Playwright：含“中途刷新续作”“损坏记录阻断”等
npm run verify     # 串行执行上述全部验收
```

关键用例：

- `src/registration/store.test.ts` — 八步推进、原子写入、刷新恢复、
  非法/越界/精度不足拒绝、完成后锁定、损坏与版本不匹配阻断、放行与超差清单顺序。
- `e2e/relay.spec.ts` — 真实浏览器中提交两步后 `reload()`，校验停在第 3 步、
  旧读数保留、会话编号不变，续作完成后得到“需复调”及按序超差清单。

## Docker Compose

```bash
# 构建并启动 Web（宿主端口默认 8080，可用 WEB_PORT 覆盖）
WEB_PORT=9000 docker compose up --build web

# 一次性验收服务：类型检查 + Vitest + Playwright（访问 compose 内的 web 服务）
docker compose run --rm verify
```

- `web`：使用 `vite preview` 托管纯静态产物，容器内固定监听 4173；
  宿主端口由 `WEB_PORT`（默认 `8080`）控制。
- `verify`：一次性服务，结束即退出，退出码代表验收结果。
