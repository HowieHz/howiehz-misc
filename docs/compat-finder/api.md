# API 参考

多数集成场景优先使用 `createCompatibilitySession`。

## 简单会话 API

- `createCompatibilitySession(targets, options?)`：根据目标列表创建兼容性排查会话
- `session.current()`：读取当前步骤或最终结果
- `session.answer(hasIssue)`：提交一次测试结果，并进入下一步
- `session.undo()`：撤销最新一次测试结果，并回到上一步

### 会话步骤

- `status`：`testing` 表示当前需要按 `targets` 进行测试；`complete` 表示已经得到最终结果
- `targets`：来自原始输入列表的目标值
- `targetNumbers`：从 1 开始的目标编号，适合展示或记录日志

`session.answer(true)` 表示当前这组目标会复现问题。  
`session.answer(false)` 表示当前这组目标不会复现问题。  
如果最新一次结果输入错误，可以调用 `session.undo()` 撤销。  
`createCompatibilitySession(targets)` 至少需要一个目标。

### 算法选择

- 默认值：`binary-split`
- 可选值：`leave-one-out`
- 示例：`createCompatibilitySession(targets, { algorithm: "leave-one-out" })`

## 高级 API

底层 API 暴露了基于范围的可变状态机，适用于自定义 UI 与诊断场景。

### 会话流程

- `createCompatibilityTestState(targetCount, options?)`：创建新的排查会话
- `getNextAnswerableCompatibilityTestStep(state)`：读取下一个真正需要回答的步骤，并自动跳过缓存步骤
- `getCurrentCompatibilityTestStep(state)`：读取当前步骤；排查结束时返回 `undefined`
- `applyCompatibilityTestAnswer(state, hasIssue)`：提交一个测试结果并推进会话
- `skipCachedCompatibilityTestSteps(state)`：跳过已经命中的缓存步骤

### 范围工具

- `takeTargetsFromRanges(ranges, limit)`：把范围展开成目标编号列表
- `countTargetsInRanges(ranges)`：统计范围内包含的目标数量
- `intersectTargetRanges(leftRanges, rightRanges)`：求两个范围列表的交集
- `subtractTargetRanges(sourceRanges, excludedRanges)`：从一个范围列表中剔除另一个范围列表

### 核心类型

- `CompatibilityTestState`：可变的排查会话状态
- `CompatibilityTestStep`：当前要展示给调用方的步骤
- `CompatibilityTestDebugStep`：以范围形式表示的内部搜索状态
- `CompatibilityTestAlgorithm`：内置算法名称
- `CompatibilityTestOptions`：会话和状态创建共用的选项对象
- `TargetRange`：闭区间目标编号范围

参数细节和行为约束请直接参考 `src/compatibility-test/` 下的内联 JSDoc 注释。
