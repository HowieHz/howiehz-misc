# API 参考

多数集成场景都应该优先使用[简单会话 API](#简单会话-api)。

## 简单会话 API

- `createCompatibilitySession<Target>(targets: readonly Target[], options?: CompatibilityTestOptions): CompatibilitySession<Target>`：根据目标列表创建兼容性排查会话

### 返回对象：`CompatibilitySession<Target>`

- `current(): CompatibilitySessionStep<Target>`：读取当前步骤或最终结果
- `answer(hasIssue: boolean): CompatibilitySessionStep<Target>`：提交一次测试结果，并进入下一步
- `undo(): CompatibilitySessionStep<Target>`：撤销最新一次测试结果，并回到上一步

### `current()` / `answer()` / `undo()` 返回值

形如：

```js
// status === "testing"
{
  status: "testing",
  targets: ["B", "C"],
  targetNumbers: [2, 3],
}

// status === "complete"
{
  status: "complete",
  targets: ["C"],
  targetNumbers: [3],
}
```

- 当 `status: "testing"`：  
  `targets` 是本轮需要测试的目标值列表  
  `targetNumbers` 是这些目标在原始 `targets` 输入列表中的 1-based 编号
- 当 `status: "complete"`：  
  `targets` 是最终排查出的不兼容目标值列表  
  `targetNumbers` 是这些目标在原始 `targets` 输入列表中的 1-based 编号

### 调用约定

- `answer(true)`：表示当前这组目标会复现问题
- `answer(false)`：表示当前这组目标不会复现问题
- `undo()`：撤销最新一次测试结果
- `createCompatibilitySession(targets)`：`targets` 列表至少包含 1 个元素

### 算法选择

只有在你想切换排查策略时，才需要传入 `algorithm`。

- 不传 `algorithm`：使用默认算法 `binary-split`
- 传入 `algorithm: "leave-one-out"`：改用每轮排除 1 个目标的方式
- 默认用法：`createCompatibilitySession(targets)`
- 切换示例：`createCompatibilitySession(targets, { algorithm: "leave-one-out" })`

想了解更多关于这两个算法的区别，请阅读 [算法性能](./algorithm-performance)。

## 高级 API

底层 API 暴露了基于范围的可变状态机，适合自定义 UI、持久化和诊断场景。

如果你只需要一个可直接驱动交互流程的封装，通常不必从这一层开始。

### 状态工厂

- `createCompatibilityTestState(targetCount: number, options?: CompatibilityTestOptions): CompatibilityTestState`：创建新的排查状态

### 状态对象：`CompatibilityTestState`

- 这是一个可变状态对象，下面几个底层函数都会直接读取或修改它

### 状态操作

- `getNextAnswerableCompatibilityTestStep(state: CompatibilityTestState): CompatibilityTestStep | undefined`：读取下一个真正需要回答的步骤，并自动跳过缓存步骤
- `getCurrentCompatibilityTestStep(state: CompatibilityTestState): CompatibilityTestStep | undefined`：读取当前步骤；排查结束时返回 `undefined`
- `applyCompatibilityTestAnswer(state: CompatibilityTestState, hasIssue: boolean): CompatibilityTestStep | undefined`：提交一个测试结果并推进状态
- `skipCachedCompatibilityTestSteps(state: CompatibilityTestState): CompatibilityTestStep | undefined`：跳过已经命中的缓存步骤

### 步骤返回值：`CompatibilityTestStep`

- `promptTargetRanges`：当前这一步要测试的目标范围列表
- `promptTargetCount`：当前这一步覆盖的目标数量
- `debug`：内部搜索状态，适合调试或自定义 UI
- `requiresAnswer`：是否需要调用方在这一步提供新的测试结果

形如：

```js
{
  promptTargetRanges: [{ start: 2, end: 3 }],
  promptTargetCount: 2,
  debug: {
    activeTargetRange: { start: 1, end: 4 },
    pendingTargetRanges: [],
    confirmedTargetRanges: [],
  },
  requiresAnswer: true,
}
```

### 调用约定

- `createCompatibilityTestState(targetCount)`：`targetCount` 必须是大于等于 `1` 的整数
- `applyCompatibilityTestAnswer(state, true)`：表示当前这一步会复现问题
- `applyCompatibilityTestAnswer(state, false)`：表示当前这一步不会复现问题
- 这些底层函数会直接修改同一个 `state` 对象
- 返回 `undefined`：表示排查已经结束

### 范围工具

- `takeTargetsFromRanges(ranges: readonly TargetRange[], limit: number): number[]`：把范围展开成目标编号列表
- `countTargetsInRanges(ranges: readonly TargetRange[]): number`：统计范围内包含的目标数量
- `intersectTargetRanges(leftRanges: readonly TargetRange[], rightRanges: readonly TargetRange[]): TargetRange[]`：求两个范围列表的交集
- `subtractTargetRanges(sourceRanges: readonly TargetRange[], excludedRanges: readonly TargetRange[]): TargetRange[]`：从一个范围列表中剔除另一个范围列表

### 核心类型

- `CompatibilityTestState`：可变的排查会话状态
- `CompatibilityTestStep`：当前要展示给调用方的步骤
- `CompatibilityTestDebugStep`：以范围形式表示的内部搜索状态
- `CompatibilityTestAlgorithm`：内置算法名称
- `CompatibilityTestOptions`：会话和状态创建共用的选项对象
- `TargetRange`：闭区间目标编号范围

参数细节和行为约束，请直接参考 [src/compatibility-test](https://github.com/HowieHz/howiehz-misc/tree/main/packages/compat-finder/src/compatibility-test) 下的内联 JSDoc 注释。
