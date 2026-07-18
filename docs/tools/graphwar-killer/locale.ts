/** 提供 Graphwar 杀手中文界面文案和状态文本。 */
import type { GraphwarKillerLocale } from "./locale-types";

export const graphwarKillerLocale = {
  equationModes: [
    {
      value: "y",
      label: "y",
      formulaPrefix: "y=",
      description: "输出函数",
      title: "按 y 模式生成或模拟函数",
    },
    {
      value: "dy",
      label: "y'",
      formulaPrefix: "y'=",
      description: "输出函数的一阶导数",
      title: "按 y' 模式生成或模拟一阶导数",
    },
    {
      value: "ddy",
      label: "y''",
      formulaPrefix: "y''=",
      description: "输出函数的二阶导数",
      title: "按 y'' 模式生成或模拟二阶导数",
    },
  ],
  toolWorkflowModes: [
    { value: "solver", label: "生成公式", title: "从路径点生成可复制到 Graphwar 的函数" },
    { value: "simulator", label: "模拟轨迹", title: "输入函数并预览 Graphwar 轨迹" },
  ],
  algorithmModes: [
    { value: "abs", label: "双绝对值函数", title: "用双绝对值连接路径点；y'' 使用平滑二阶导近似" },
    { value: "step", label: "阶跃函数", title: "用阶跃函数连接路径点，可调陡峭度，表达式通常更长" },
    { value: "pchip", label: "PCHIP 插值", title: "用单调三次插值生成平滑路径，通常更贴近手绘路径" },
    { value: "akima", label: "Akima 插值", title: "用 Akima 三次插值生成平滑路径，对局部异常点更稳" },
  ],
  validation: {
    boundsInvalidNumber: "边界坐标需要填写合法数字",
    decimalPlacesInteger: "保留小数位需要填写整数",
    decimalPlacesRange: (max) => `保留小数位需要在 0 到 ${max} 之间`,
    maxXGreaterThanMinX: "-x 要小于 +x",
    maxYGreaterThanMinY: "-y 要小于 +y",
    magnifierZoomNumber: "放大倍率需要填写数字",
    magnifierZoomRange: (min, max) => `放大倍率需要在 ${min}x 到 ${max}x 之间`,
    maximumSoldierCountInteger: "士兵数上限需要填写整数",
    maximumSoldierCountPositive: "士兵数上限需要大于 0",
    obstacleBrushDiameterInteger: "笔刷大小需要填写整数",
    obstacleBrushDiameterRange: (min, max) => `笔刷大小需要在 ${min}px 到 ${max}px 之间`,
    obstacleMinAreaInteger: "障碍最小面积需要填写整数",
    obstacleMinAreaRange: (max) => `障碍最小面积需要在 0 到 ${max} 之间`,
    oneClickClearDeleteCheckRadiusNumber: "一键清图删点命中检查半径需要填写数字",
    oneClickClearDeleteCheckRadiusRange: (min) => `一键清图删点命中检查半径不能小于 ${min}px`,
    pathfindingWorkerCountInteger: "寻路工作线程数需要填写整数",
    pathfindingWorkerCountRange: "寻路工作线程数需要在 1 到 128 之间",
    routePlanningToleranceNumber: "路线规划容差需要填写数字",
    routePlanningTolerancePixelRange: (limit) => `路线规划容差需要在 -${limit}px 到 ${limit}px 之间`,
    simulationToleranceNumber: "函数模拟容差需要填写数字",
    simulationTolerancePixelRange: (limit) => `函数模拟容差需要在 -${limit}px 到 ${limit}px 之间`,
    soldierTemplateCandidateTopRatioNumber: "候选裁剪需要填写数字",
    soldierTemplateCandidateTopRatioRange: "候选裁剪需要大于 0 且不大于 1",
    templateMatchingWorkerCountInteger: "模板匹配工作线程数需要填写整数",
    templateMatchingWorkerCountRange: "模板匹配工作线程数需要在 1 到 128 之间",
    steepnessNumber: "陡峭度需要是大于 0 的数字",
  },
  status: {
    activeEquation: {
      abs: "输出双绝对值连接函数",
      absDerivative: "输出双绝对值连接函数的一阶导数",
      absSecondDerivative: "输出双绝对值路径的平滑二阶导近似",
      akima: "输出 Akima 三次插值的软分段表达式",
      akimaFirstDerivative: "输出 Akima 软分段表达式的严格一阶导数",
      akimaSecondDerivative: "输出 Akima 软分段表达式的严格二阶导数",
      pchip: "输出 PCHIP 单调三次插值的软分段表达式",
      pchipFirstDerivative: "输出 PCHIP 软分段表达式的严格一阶导数",
      pchipSecondDerivative: "输出 PCHIP 软分段表达式的严格二阶导数",
      simulator: "输入函数并按当前游戏模式模拟 Graphwar 轨迹",
    },
    activeToolHint: {
      bounds: "左键点两角落定边界；右键取消已选点",
      obstacle: "左键按住绘制或擦除当前障碍；悬停预览下笔范围",
      simulatorPath: "左键选择初始发射士兵；再次点选会替换当前士兵",
      solverPath: "左键先点自己士兵中心；再点路径点中心；左键拖动路径点微调，右键点路径点删除，右键空白处撤回最近一个",
    },
    liveClickPreview: {
      inProgress: "正在计算实时预览……",
      rendered: (elapsed) => `已渲染实时预览，耗时 ${elapsed}`,
    },
    calculation: {
      enterFunction: "请输入函数",
      enterLaunchAngle: "请输入发射角",
      fallbackWarning: "⚠ 已降级",
      fallbackWarningTitle: (message) => `主轨迹工作线程不可用，已降级为主线程解算和模拟：${message}`,
      inProgress: "正在解算函数并模拟轨迹……",
      selectInitialSoldier: "先选择初始发射士兵",
      selectPath: "先点出自己的位置，再选择至少一个路径点",
      simulateFailed: "模拟轨迹失败",
      solveFailed: "解算函数失败",
      success: (elapsed) => `已解算函数并模拟轨迹，耗时 ${elapsed}`,
    },
    copy: {
      buttonDefault: "复制函数",
      buttonError: "复制失败",
      buttonSuccess: "已复制",
      error: "复制失败，请手动复制",
      success: "函数已复制到剪贴板",
    },
    detection: {
      cancelled: "已中止识别",
      detectingBounds: "正在检测坐标系边界",
      detectingObjects: "正在识别士兵和障碍",
      detectedBounds: (elapsed) => `已标记边界，耗时 ${elapsed}`,
      detectedCurrentBounds: (soldiers, elapsed) => `已标记障碍和 ${soldiers} 个士兵，耗时 ${elapsed}`,
      detectedWithAutoBounds: (soldiers, elapsed) => `已标记边界、障碍和 ${soldiers} 个士兵，耗时 ${elapsed}`,
      failed: (message) => `识别失败：${message}`,
      obstacleEditsApplied: (obstacles) => `已更新障碍边界，当前 ${obstacles} 个障碍`,
      obstacleEditsCleared: (obstacles) => `已清除障碍修改，恢复为 ${obstacles} 个障碍`,
      updatingObstacleEdits: "正在应用障碍修改",
      needBounds: "需要先识别或框选 Graphwar 坐标系边界",
      noBounds: "没有识别到 Graphwar 坐标系边界",
      noPixels: "无法读取截图像素",
      partialWarning: "⚠ 但有部分异常",
      preparingPixels: "正在读取截图像素",
      stopSuffix: "，在截图中右键中止…",
      updatingResults: "正在更新识别结果",
      uploadFirst: "先上传或粘贴截图",
      warningTitle: (warning) =>
        warning.code === "template-matching-worker-fallback"
          ? `并行失败，回退到串行：${warning.message}`
          : warning.message,
    },
    image: {
      defaultStatus: "可以截屏、上传、拖入或直接 Ctrl / Cmd + V 粘贴截图",
      pastedName: "粘贴的截图",
      screenCaptureIncomplete: "未完成截屏",
      screenCaptureName: "屏幕截图",
      screenCaptureUnavailable: "当前环境不支持截屏",
      screenCaptureUnsupported: "当前浏览器不支持 Screen Capture API",
    },
    agent: {
      defaultStatus: "点击“读取状态”从 Graphwar Agent 载入当前游戏信息",
      failed: (message) => `读取状态失败：${message}`,
      failureReason: (kind, message) => {
        switch (message) {
          case "game-data-not-initialized":
            return "Graphwar 游戏数据尚未初始化";
          case "game-not-active":
            return "当前没有进行中的对局";
          case "game-not-started":
            return "游戏尚未开始";
          case "not-in-pre-game-room":
            return "当前不在游戏房间";
          case "state-file-invalid-json":
            return "状态文件不是有效的 JSON";
        }
        switch (kind) {
          case "conflict":
            return "Graphwar 状态已变化，请重试";
          case "incompatible":
            return "Graphwar Agent 版本或返回数据不兼容，请升级 Agent";
          case "invalid-request":
            return "发送给 Graphwar Agent 的请求无效";
          case "transient":
            return "网络或 Graphwar Agent 暂时不可用";
          case "unavailable":
            return `Agent 返回未知状态：${message}`;
          default:
            return message;
        }
      },
      fileFailed: (message) => `读取调试文件失败：${message}`,
      fileIncompatible: "状态文件与障碍文件不匹配或格式不受支持",
      exportFailed: (message) => `导出局面失败：${message}`,
      exported: "已导出当前局面",
      exporting: "正在导出局面",
      fireFailed: (message) => `开火失败：${message}`,
      fired: "已提交函数并开火",
      loaded: (soldiers) => `已读取当前状态：障碍和 ${soldiers} 个士兵`,
      obstacleFileLoaded: "已读取障碍文件，请读取状态文件",
      readFirst: "先读取 Agent 状态",
      reading: "正在读取状态",
      readingFile: "正在读取文件",
      stateFileLoaded: "已读取状态文件，请读取障碍文件",
    },
    pathPointCoordinateNumber: "点坐标需要填写数字",
    secondOrderAngleHint: (angle) => `需要用键盘上下键把发射角调到 ${angle}°`,
    trajectoryWarning: {
      obstacle: "当前公式轨迹会撞到障碍物或边界",
      pathQuality: (error) => `公式已生成，但普通控制点的最大路径误差为 ${error} 个原始平面像素`,
      pathQualityUnreached: "公式已生成，但轨迹没有到达至少一条普通控制线",
      stopped: {
        invalid: "预览已中止：公式出现 NaN 或无穷值，实战中会提前爆炸",
        "max-steps": "预览已中止：达到 Graphwar 最大采样步数，函数过长，实战中会在末端爆炸",
        "out-of-bounds": "预览已中止：轨迹越出 Graphwar 平面，实战中会在边界处提前爆炸",
        "too-steep": "预览已中止：局部太陡，Graphwar 步长缩到最小仍无法继续，实战中会在这里爆炸",
      },
      targetMissed: "当前 y'' 公式按两位小数发射角回放后未命中目标",
    },
  },
  smartPathfinding: {
    cancelled: "已中断寻路",
    currentPathBlocked: "模拟结果未到达当前最后路径点，无法开始寻路任务",
    failure: (elapsed) =>
      elapsed === undefined ? "路径规划失败：未找到可行路径" : `路径规划失败：未找到可行路径，耗时 ${elapsed}`,
    forwardMinimumDouble: "下一个可表示的双精度浮点数",
    forwardPath: (minimumStep) => `每个点的 Graphwar x 都必须严格大于上一个点，至少移动到${minimumStep}`,
    needBounds: "先识别或框选坐标系边界后才能使用路径规划",
    needDetection: "先识别士兵和障碍后才能使用路径规划",
    inProgress: {
      optimize: "优化路径节点",
      search: "搜索绕障路线",
      stopSuffix: "，在截图中右键停止",
      trajectory: "验证函数轨迹",
    },
    success: (elapsed, resultCacheHit) => {
      const cacheText = resultCacheHit ? "（使用结果缓存）" : "";
      return elapsed === undefined ? `路径规划完成${cacheText}` : `路径规划完成${cacheText}，耗时 ${elapsed}`;
    },
    oneClickClear: {
      inProgress: "正在一键清图，在截图中右键停止",
      needDetection: "先识别士兵和障碍后才能使用一键清图",
      needCurrentPath: "一键清图需要先选择当前路径起点",
      noCandidate: "一键清图失败：当前路径 x+ 侧没有可用命中圈目标",
      noUsableTarget: (elapsed) => `一键清图失败：搜索后没有找到可用目标，耗时 ${elapsed}`,
      pathfindingWorkerFailed: (elapsed) => `一键清图失败：寻路工作线程不可用或运行失败，耗时 ${elapsed}`,
      retained: "已保留当前最优结果",
      success: (killCount, elapsed, resultCacheHit) => {
        const cacheText = resultCacheHit ? "（使用结果缓存）" : "";
        return `一键清图完成${cacheText}，整条弹道击杀 ${killCount} 个士兵，耗时 ${elapsed}`;
      },
      unsupported: "一键清图仅支持双绝对值的 y、y'，或阶跃 y、y'、y''",
    },
    managed: {
      backgroundWarning: "页面位于后台，托管发射可能延迟",
      calculationComplete: (targetCount, elapsed) =>
        `托管计算完成，当前最优方案命中 ${targetCount} 个目标，耗时 ${elapsed}`,
      calculating: () => "托管计算中",
      completedWaiting: "托管计算完成，等待己方回合",
      connectionFailed: (message) => `Agent 连接失败，正在重试：${message}`,
      deadlineFired: "剩余 3 秒中断，已发射当前最优方案",
      deadlineNoPlan: "剩余 3 秒中断，无法提交跳过回合公式",
      deadlinePlan: (elapsed) => `托管计算在剩余 3 秒时中断，已采用当前最优方案，耗时 ${elapsed}`,
      enabled: "托管已启用，正在读取游戏状态",
      incompatible: "Agent 接口不兼容，托管已关闭，请升级 Agent",
      readying: "房间内本地玩家尚未准备，正在自动准备",
      searchFailed: "托管计算失败，无法跳过本回合",
      skippingTurn: "没有可用方案，正在跳过本回合",
      skipTurnFired: "没有可用方案，已跳过本回合",
      shotUnknown: (message) => `发射结果未知，本回合不再重试：${message}`,
      stopped: "托管已关闭",
      successFired: "托管计算完成，已发射最优方案",
      waitingForGame: "托管已启用，等待进入房间或对局",
      waitingForTurn: "等待己方回合",
    },
  },
  ui: {
    actions: {
      collisionCheck: "碰撞检查",
      collisionCheckTitle: "检查手工生成和模拟轨迹是否碰到障碍或边界；寻路始终检查碰撞",
      clearPath: "清除路径点",
      clearPathTitle: "清除全部路径点",
      clearObstacleEdits: "清除障碍修改",
      clearObstacleEditsTitle: "恢复当前载入的原始障碍范围",
      drawObstacle: "绘制障碍",
      drawObstacleTitle: "用圆形笔刷修正当前障碍范围",
      eraseObstacle: "擦除模式",
      eraseObstacleTitle: "让笔刷擦除当前障碍区域",
      magnifier: "放大镜",
      magnifierTitle: "放大指针附近的截图，便于精确点选",
      magnifierZoom: "放大倍率",
      magnifierZoomAriaLabel: "放大镜倍率",
      magnifierZoomTitle: "设置放大倍率；滑条范围 1x 到 5x，输入范围 1x 到 100x",
      obstacleBrushDiameter: "笔刷大小",
      obstacleBrushDiameterAriaLabel: "障碍笔刷直径，单位为 Graphwar 原始 770x450 平面像素",
      obstacleBrushDiameterTitle: "设置圆形笔刷直径；滑条范围 1px 到 200px，输入范围 1px 到 1000px",
      liveClickPreview: "实时预览",
      liveClickPreviewTitle: "预览点击当前位置后生成的路径点和路线",
      pickBounds: "点选边界",
      pickBoundsTitle: "点选两个坐标系角点来校准截图边界",
      pickPath: "点选路径",
      pickPathTitle: "先点己方士兵，再点路径点或目标士兵",
      pathPlanning: "路径规划",
      pathPlanningTitle: "点选目标后自动寻找绕开障碍的路线",
      snapSoldiers: "吸附士兵",
      snapSoldiersTitle: "点选时吸附到识别出的士兵，并使用真实命中圈",
      title: "操作栏",
      toolModeAriaLabel: "操作模式",
      toolModeTitle: "选择边界、路径或障碍编辑工具",
      undoPoint: "撤回路径点",
      undoPointTitle: "撤回最近添加的路径点",
    },
    detection: {
      agent: {
        address: "Agent 地址",
        addressAriaLabel: "Graphwar Agent 地址",
        addressTitle: "Graphwar Agent 本机 HTTP 地址，默认 http://127.0.0.1:17900",
        exportOnClearFailure: "清图失败自动导出",
        exportOnClearFailureTitle:
          "一键清图漏杀、搜索失败、工作线程异常或托管截止中断时，自动导出搜索启动时的 Graphwar Agent 局面；同一回合和战场版本只导出一次",
        exportScene: "导出局面",
        exportSceneTitle: "下载当前 Graphwar Agent 状态和障碍文件，供调试模式重新导入",
        exportingScene: "正在导出",
        helpLink: "如何使用 Graphwar Agent",
        readObstacleFile: "读障碍文件",
        readObstacleFileTitle: "读取 Graphwar Agent 保存的障碍二进制文件",
        read: "读取状态",
        reading: "读取中",
        readStateFile: "读状态文件",
        readStateFileTitle: "读取 Graphwar Agent 保存的状态 JSON 文件",
        readTitle: "从 Graphwar Agent 读取当前游戏状态",
        settingsSummary: "Agent 设置",
        toggle: "使用 Agent",
        toggleTitle: "使用 Graphwar Agent 读取游戏状态",
      },
      autoDetection: "自动识别",
      autoDetectionTitle: "加载截图时自动识别边界、士兵和障碍",
      busyOverlay: "识别中，右键中止",
      debugNoTiming: "暂无识别耗时记录",
      debugDetails: {
        "template-matching-dispatch": {
          label: "- 分发模板任务",
          title: "切分候选、复制截图像素并把模板匹配任务发送给子工作线程",
        },
        "template-matching-fallback-serial": {
          label: "- 回退串行模板评分",
          title: "并行模板匹配失败后，在检测工作线程内用串行路径重新评分全部候选",
        },
        "template-matching-merge": {
          label: "- 合并模板结果",
          title: "合并模板评分结果，统一排序、过滤阈值并抑制重叠匹配",
        },
        "template-matching-mode": {
          label: (mode, workerCount) =>
            mode === "parallel"
              ? `- 模板匹配模式：并行，${workerCount} 个工作线程`
              : mode === "parallel-fallback"
                ? `- 模板匹配模式：并行失败后串行，${workerCount} 个工作线程 -> 1 个工作线程`
                : "- 模板匹配模式：串行，1 个工作线程",
          title: "本次士兵模板匹配实际使用的调度模式",
        },
        "template-matching-serial": {
          label: "- 串行模板评分",
          title: "在检测工作线程内串行评分全部士兵候选",
        },
        "template-matching-worker": {
          label: (workerIndex) => `- 工作线程 ${workerIndex} 模板评分`,
          title: "单个模板匹配子工作线程对自己候选切片的评分耗时",
        },
      },
      debugStages: {
        "building-obstacle-mask": {
          label: "构建障碍掩码",
          title: "把截图重采样到 Graphwar 原始 770x450 平面，识别深色地形主体和抗锯齿边缘",
        },
        "collecting-soldier-candidates": {
          label: "生成士兵候选",
          title: "扫描士兵黄色/白色种子像素，并反投票生成可能的士兵源码中心",
        },
        "detecting-bounds": {
          label: "检测坐标系边界",
          title: "在截图像素中寻找 Graphwar 坐标系边界；自动识别边界时才会出现",
        },
        "detecting-objects": {
          label: "识别士兵和障碍",
          title: "在已确定的坐标系边界内识别士兵、障碍区域和命中圈",
        },
        "filtering-obstacle-components": {
          label: "过滤障碍连通域",
          title: "移除坐标轴、边界辅助线、士兵区域和小噪点，并回填通过筛选的真实障碍连通块",
        },
        "matching-soldier-templates": {
          label: "匹配士兵模板",
          title: "对候选中心尝试 Graphwar 士兵动画模板和镜像模板，并筛选重叠匹配",
        },
        "outside-stages": {
          label: "阶段外耗时",
          title: "流程总耗时减去已记录阶段耗时；包含状态绘制等待、工作线程消息传递、异步调度和未单独计量的连接代码",
        },
        "preparing-pixels": {
          label: "读取截图像素",
          title: "从当前截图画布读取图像数据，并准备发送给识别流程",
        },
        "setting-status": {
          label: "设置状态栏",
          title: "生成识别完成或失败文案，并写入识别标题右侧状态",
        },
        total: {
          label: "流程总耗时",
          title: "本次识别从开始到最终状态落地的墙钟耗时",
        },
        "updating-results": {
          label: "更新识别结果",
          title: "把识别出的士兵、障碍和坐标系边界写回页面状态，并刷新相关缓存和高亮",
        },
      },
      debugSummary: "调试信息",
      minObstacleArea: "障碍最小面积",
      minObstacleAreaAriaLabel: "障碍最小面积，单位为 Graphwar 原始平面像素",
      minObstacleAreaTitle: "忽略面积小于该值的障碍噪点",
      detectBounds: "识别边界",
      detectBoundsTitle: "识别当前截图中的坐标系边界",
      detectObjects: "识别士兵/障碍",
      detectObjectsNeedBoundsTitle: "需要先识别或框选 Graphwar 坐标系边界",
      detectObjectsTitle: "识别当前边界内的士兵和障碍",
      title: "数据来源",
    },
    pathfinding: {
      allowFriendlyFire: "允许友伤",
      allowFriendlyFireTitle: "允许寻路和一键清图穿过己方士兵",
      capabilityReasons: {
        "agent-disabled": "请先开启“使用 Agent”",
        "agent-fire-busy": "正在通过 Agent 发射",
        "agent-read-busy": "正在读取 Agent 状态",
        "agent-scene-required": "请先读取当前 Agent 状态",
        "agent-url-invalid": "请填写有效的 Agent 地址",
        "bounds-required": "请先识别或点选坐标边界",
        "delete-check-radius-invalid": "请修正删点命中检查半径",
        "formula-settings-invalid": "请先修正公式设置",
        "formula-unsupported": "当前公式配置不支持一键清图",
        "image-required": "请先载入截图",
        "managed-lock": "托管运行期间此设置被锁定",
        "obstacle-tolerances-invalid": "请修正障碍容差",
        "obstacles-required": "请先识别或读取障碍",
        "path-start-required": "请先选择当前发射士兵",
        "pathfinding-busy": "当前寻路任务结束后才能操作",
        "pathfinding-worker-count-invalid": "请修正寻路工作线程数量",
        "soldiers-required": "请先识别或读取士兵",
        "solver-required": "切换到解算器后生效",
      },
      debugNoTiming: "暂无寻路耗时记录",
      debugDetails: {
        "build-dag-edges": {
          label: "- 清图建立有向无环图边",
          title: "用当前一键清图路线掩码尝试分配目标点之间的 x+ 几何寻路，并记录可用边",
        },
        "dag-edge-mode": {
          label: (mode, workerCount) =>
            mode === "parallel"
              ? `- 清图有向无环图建边模式：并行，${workerCount} 个工作线程`
              : mode === "parallel-fallback"
                ? `- 清图有向无环图建边模式：并行失败后补串行，${workerCount} 个工作线程 -> 1 个工作线程`
                : "- 清图有向无环图建边模式：串行，1 个工作线程",
          title: "本次一键清图有向无环图建边实际使用的调度模式",
        },
        "dag-edge-worker": {
          label: (workerIndex) => `- 清图有向无环图建边工作线程 ${workerIndex}`,
          title: "单个有向无环图建边子工作线程的总耗时；任务由工作线程动态领取，耗时不代表固定边切片",
        },
        "assign-clear-targets": {
          label: "- 清图分配目标",
          title: "为全部一键清图模式选择圆心或严格圆内的 x+ 安全边缘，并按同初始 x 稳定分配命中圈控制点",
        },
        "dag-longest-path": {
          label: "- 清图有向无环图最长路",
          title: "在按最终目标 x 建好的有向无环图上运行最长路动态规划，选择显式击杀数量最多的路线",
        },
        "optimize-path": {
          label: "- 清图删点优化",
          title: "对验证通过的清图路径做保守删点，并确认每次删除后仍命中全部新旧目标",
        },
        "prefix-evidence-hit": {
          label: "- 清图前缀证据命中",
          title: "当前固定路径与上一条成功整式完全一致，直接复用其真实恢复点",
        },
        "prefix-evidence-miss": {
          label: "- 清图前缀证据未命中",
          title: "当前固定路径没有可复用的最终整式证据；直连失败后需要重新准备前缀",
        },
        "prepare-pathfinding-prefix": {
          label: "- 清图准备寻路前缀",
          title: "完整回放当前固定路径，确认旧目标和尾点并取得邪道扫描的真实恢复点",
        },
        "remove-failed-edge": {
          label: "- 清图删除失败边",
          title: "当函数验证发现某条有向无环图边不可用时，将该边标记为不可用并准备重新运行最长路动态规划",
        },
        "route-mask-cache-hit": {
          label: "- 清图路线掩码缓存命中",
          title: "工作线程已复用当前障碍掩码和路线容差对应的清图路线掩码",
        },
        "route-mask-cache-miss": {
          label: "- 清图路线掩码缓存未命中",
          title: "工作线程需要按当前障碍掩码和路线容差重建清图路线掩码",
        },
        "route-map-pixels": {
          label: "- 清图路线映射像素",
          title: "把几何寻路返回的 Graphwar 平面格点转换成截图像素路径，并保留精确分配目标首尾",
        },
        "route-pathfinding": {
          label: "- 清图真实几何寻路",
          title: "搜索两个分配目标点之间满足 x+ 规则的绕障几何路线",
        },
        "scan-step-glitch": {
          label: "- 清图邪道水平扫描",
          title: "按目标 x 递增扫描自由水平行，并用最终量化公式验证每个纵向隧穿候选",
        },
        "segment-graph-rule": {
          label: "- 清图分段 x+ 检查",
          title: "检查候选分段路径中相邻点的 Graphwar x 是否严格递增；同 x 不允许",
        },
        "segment-sample-trajectory": {
          label: "- 清图分段轨迹采样",
          title: "按当前完整路径重采样，确认当前新目标和全部历史目标都在碰撞障碍前被命中",
        },
        "validate-route": {
          label: "- 清图验证有向无环图路线",
          title: "按最长路选出的有向无环图边逐段追加路线，验证每个目标命中圈；失败时返回具体失败边",
        },
        "validate-final": {
          label: "- 清图最终验证",
          title: "对优化后的完整清图路径重新采样，确认全部选中新目标和旧目标仍被命中",
        },
        "validate-direct-trajectory": {
          label: "- 清图验证直连轨迹",
          title: "先完整回放当前路径直接追加目标的最终整式；成功时无需准备旧前缀或扫描绕障候选",
        },
        "visibility-cache-hit": {
          label: "- 清图可视图缓存命中",
          title: "建立清图有向无环图边前，复用当前路线掩码、方向和路线容差对应的障碍轮廓数据",
        },
        "visibility-cache-miss": {
          label: "- 清图可视图缓存未命中",
          title: "建立清图有向无环图边前，没有可复用障碍轮廓数据，需要先建立；本次有向无环图的所有边会复用这份数据",
        },
        "visibility-cache-skipped": {
          label: "- 清图可视图缓存未使用",
          title: "本次一键清图没有进入有向无环图建边阶段，因此没有访问可视图缓存",
        },
        "validate-prefix": {
          label: "- 清图前缀验证",
          title: "验证当前已有路径能命中最后路径点，并保存可复用的轨迹采样状态",
        },
      },
      debugStages: {
        "apply-result": {
          label: "写回路径结果",
          title: "把最终规划路径写入当前路径状态，并清理旧的路径错误提示",
        },
        "collect-targets": {
          label: "生成目标",
          title: "点击士兵时，优先使用士兵中心；中心不满足 x+ 时把几何目标推到命中圈内的最小 x+ 点，弹道仍校验原命中圈",
        },
        "prefix-evidence-hit": {
          label: "前缀证据命中",
          title: "当前旧路径、目标序列、公式设置和模拟环境与最近成功整式完全一致，复用真实恢复点",
        },
        "prefix-evidence-miss": {
          label: "前缀证据未命中",
          title: "没有完全匹配的旧整式证据；直连失败后需要完整回放旧路径一次",
        },
        "prepare-pathfinding-prefix": {
          label: "准备寻路前缀",
          title: "完整回放旧整式，确认已提交目标和当前尾点，并取得邪道扫描器的真实恢复点",
        },
        "result-cache-hit": {
          label: "结果缓存命中",
          title: "当前路径、目标、障碍掩码、容差和公式设置与已缓存的普通寻路结果一致，直接复用完整结果",
        },
        "result-cache-miss": {
          label: "结果缓存未命中",
          title: "当前普通寻路输入没有可复用的完整结果，需要交给寻路工作线程重新搜索和验证",
        },
        "route-mask-cache-hit": {
          label: "路线掩码缓存命中",
          title: "当前障碍掩码和路线容差已有膨胀/腐蚀后的路线掩码，可直接复用",
        },
        "route-mask-cache-miss": {
          label: "路线掩码缓存未命中",
          title: "当前障碍掩码或路线容差没有可复用路线掩码，需要重建",
        },
        "visibility-cache-hit": {
          label: "可视图缓存命中",
          title: "绕障搜索需要可视图，并复用了当前路线掩码、方向和路线容差对应的障碍轮廓数据",
        },
        "visibility-cache-miss": {
          label: "可视图缓存未命中",
          title: "绕障搜索需要可视图，但当前路线掩码、方向或路线容差没有可复用障碍轮廓数据，需要重建",
        },
        "visibility-cache-skipped": {
          label: "可视图缓存未使用",
          title: "本次普通寻路使用 Theta*、直连成功或提前失败，没有进入绕障可视图搜索",
        },
        "optimize-path": {
          label: "优化路径节点",
          title: "逐个尝试删除几何路线中的中间点，并用函数轨迹验证删除后是否仍可命中目标",
        },
        "one-click-clear-apply-result": {
          label: "清图写回路径",
          title: "把一键清图找到的最佳路径写入当前路径状态；没有新增击杀时不会改动原路径",
        },
        "one-click-clear-collect-targets": {
          label: "清图收集目标",
          title: "按当前友伤设置筛选一键清图士兵，并保留圆心或严格圆内 x+ 安全边缘可前进的命中圈候选",
        },
        "one-click-clear-result-cache-hit": {
          label: "清图结果缓存命中",
          title: "当前路径、候选目标、障碍掩码、容差和公式设置与已缓存的一键清图结果一致，直接复用完整结果",
        },
        "one-click-clear-result-cache-miss": {
          label: "清图结果缓存未命中",
          title: "当前一键清图输入没有可复用的完整结果，需要交给寻路工作线程重新搜索和验证",
        },
        "one-click-clear-preflight": {
          label: "清图预检查",
          title: "检查一键清图设置、当前模式、当前路径和障碍掩码，并准备前缀命中目标",
        },
        "one-click-clear-route-mask-cache-hit": {
          label: "清图路线掩码缓存命中",
          title: "当前障碍掩码和路线容差已有清图可用的路线掩码，可直接复用",
        },
        "one-click-clear-route-mask-cache-miss": {
          label: "清图路线掩码缓存未命中",
          title: "当前障碍掩码或路线容差没有清图可用的路线掩码，需要重建",
        },
        "one-click-clear-search": {
          label: "清图搜索验证",
          title:
            "共享分配命中圈目标后，按最终 x 建立普通有向无环图或邪道扫描层，并持续验证到得到可用清图路线或无路可用",
        },
        "one-click-clear-setting-status": {
          label: "清图设置状态栏",
          title: "根据一键清图结果生成成功、失败或不可用原因，并写入寻路标题右侧状态",
        },
        "outside-stages": {
          label: "阶段外耗时",
          title: "流程总耗时减去已记录阶段耗时；包含阶段切换、绘制等待、异步调度和未单独计量的连接代码",
        },
        preflight: {
          label: "预检查当前路径",
          title: "检查当前已有路径的函数轨迹是否能先到达最后路径点，避免在已被障碍截断的路径后继续寻路",
        },
        "search-route": {
          label: "搜索绕障路线",
          title: "在当前障碍掩码和路线外扩值下搜索从当前路径终点到目标点的几何避障路线",
        },
        "setting-status": {
          label: "设置状态栏",
          title: "生成路径规划成功或失败文案，并写入寻路标题右侧状态",
        },
        total: {
          label: "流程总耗时",
          title: "本次路径规划从开始到最终状态落地的墙钟耗时",
        },
        "validate-trajectory": {
          label: "验证函数轨迹",
          title: "把候选几何路径转换为 Graphwar 函数轨迹，检查它是否先命中目标再碰到障碍或边界",
        },
        "validate-direct-trajectory": {
          label: "验证直连轨迹",
          title: "完整回放旧路径直接追加新目标的最终整式；成功时立即返回，不再准备前缀或扫描绕障路线",
        },
      },
      debugSummary: "调试信息",
      deleteOptimization: "删点优化",
      deleteOptimizationTitle: "尝试删除多余控制点；最终仍验证完整轨迹",
      obstacleExpansionAgentMode: "Agent 模式",
      obstacleExpansionDetectionMode: "识别模式",
      obstacleExpansion: "障碍外扩",
      obstacleExpansionTitle: "设置寻路和碰撞检查的障碍安全距离；邪道模式优先使用邪道配置",
      oneClickClearDeleteCheckRadius: "清图删点命中检查半径",
      oneClickClearDeleteCheckRadiusAriaLabel: "一键清图删点命中检查半径，单位为 Graphwar 原始 770x450 平面像素",
      oneClickClearDeleteCheckRadiusTitle: "删点时快速检查局部路径是否仍经过相同士兵；设为 0 时直接验证完整轨迹",
      oneClickClearTitle: "从当前路径末端开始，分配并尽量击杀 x+ 侧命中圈可达的士兵",
      managedFriendlyFireWarning: "托管已允许友伤，友军会作为一键清图候选",
      managedMode: "托管模式",
      managedModeDisableTitle: "关闭托管模式并解锁设置",
      managedModeConfirmation: (settings, repairs, friendlyFireEnabled) => {
        const algorithmStatus = [
          "当前算法设定：",
          ...settings.map(
            (setting) =>
              `${setting.equation}：${setting.algorithm}${setting.properties.length > 0 ? `（${setting.properties.join("，")}）` : ""}`,
          ),
          ...(repairs.length === 0
            ? []
            : [
                "",
                "以下游戏模式需要调整算法设定：",
                ...repairs.map(
                  (repair) =>
                    `${repair.equation}：当前算法不支持一键清图，将设为${repair.algorithm}${repair.properties.length > 0 ? `（${repair.properties.join("，")}）` : ""}`,
                ),
              ]),
        ].join("\n");
        return `托管会自动向 Graphwar 发射\n在房间内会自动准备\n当前${friendlyFireEnabled ? "允许" : "禁止"}友伤\n\n${algorithmStatus}\n\n确认开启托管？`;
      },
      managedModeTitle: "在己方回合自动读取状态、规划并发射",
      routePlanningTolerance: "路线规划容差",
      routePlanningToleranceAriaLabel: "路线规划容差，单位为 Graphwar 原始 770x450 平面像素",
      routePlanningToleranceTitle: "设置路径规划和一键清图的障碍容差",
      routeAlgorithm: "寻路算法",
      routeAlgorithmTitle: "选择路径规划和一键清图使用的寻路算法",
      routeLazyVisibilityGraph: "惰性可视图",
      routeThetaStar: "Theta*",
      routeXPlusScan: "X+ 扫描",
      searchAnimation: "搜索动画",
      searchAnimationTitle: "显示单目标搜索过程，以及一键清图和托管的当前最优公式与轨迹",
      simulationTolerance: "函数模拟容差",
      simulationToleranceAriaLabel: "函数模拟容差，单位为 Graphwar 原始 770x450 平面像素",
      simulationToleranceTitle: "设置函数模拟和碰撞检查的障碍容差；不影响路线选择",
      autoGraph: "一键清图",
      title: "寻路",
      settingsSummary: "寻路设置",
      unit: "px",
    },
    point: {
      coordinateAriaLabel: (label, axis) => `${label} ${axis} 坐标`,
      coordinateTitle: (label, axis) => `编辑${label}的 ${axis} 坐标并同步移动截图上的点`,
      header: "点",
      listSummary: "路径点列表",
      pathLabel: (index) => `路径 ${index}`,
      selfLabel: "己方",
      svgSelfLabel: "己",
    },
    result: {
      clearSimulator: "清空",
      clearSimulatorTitle: "清空模拟器里的函数、发射角和已选初始士兵",
      copyTitle: "复制生成的 Graphwar 函数",
      fire: "开火",
      fireError: "开火失败",
      fireSuccess: "已开火",
      fireTitle: "通过 Graphwar Agent 提交当前函数并开火",
      firing: "开火中",
      fractionOutput: "结果转分数",
      fractionOutputTitle: "将生成函数中的有限小数转换为最简分数",
      formulaInputAriaLabel: "模拟器函数输入",
      formulaInputTitle: "输入要模拟的 Graphwar 函数",
      launchAngle: "发射角",
      launchAngleAriaLabel: "y'' 模式发射角",
      launchAngleTitle: "y'' 模式需要的发射角，单位为度",
      title: "函数",
    },
    screenshot: {
      agentPlaceholder: "读取 Agent 状态后开始规划",
      stepGlitchAgentRecommendation: (agentToggleLabel) => `推荐启用“${agentToggleLabel}”以获取准确的士兵位置`,
      capture: "截取屏幕",
      captureTitle: "截取 Graphwar 画面并载入工具",
      placeholder: "上传、拖入或粘贴截图后开始标定",
      title: "截图",
      upload: "上传图片",
      uploadInputTitle: "从本地选择 Graphwar 截图",
      uploadTitle: "选择 Graphwar 截图，也可以拖入或粘贴图片",
    },
    settings: {
      algorithm: "算法",
      algorithmAriaLabel: "算法",
      algorithmTitle: "选择把路径点转换成 Graphwar 函数的算法",
      bounds: {
        heading: "边界值设定",
        maxXAriaLabel: "Graphwar 坐标系右边界 x 坐标",
        maxXTitle: "坐标系右边界的 x 坐标",
        maxYAriaLabel: "Graphwar 坐标系上边界 y 坐标",
        maxYTitle: "坐标系上边界的 y 坐标",
        minXAriaLabel: "Graphwar 坐标系左边界 x 坐标",
        minXTitle: "坐标系左边界的 x 坐标",
        minYAriaLabel: "Graphwar 坐标系下边界 y 坐标",
        minYTitle: "坐标系下边界的 y 坐标",
      },
      actionBar: {
        heading: "操作栏设定",
        liveClickPreviewWorkerCount: "实时预览工作线程数",
        liveClickPreviewWorkerCountAriaLabel: "实时点击预览工作线程数量",
        liveClickPreviewWorkerCountTitle: "设置实时预览使用的工作线程数；默认 4，范围 1 到 16",
      },
      advancedSettings: "高级设定",
      debugActivationCountdown: (remainingSeconds) => `再长按 ${remainingSeconds}s 开启调试信息`,
      decimalPlaces: "保留小数位",
      decimalPlacesAriaLabel: "生成函数保留小数位数",
      decimalPlacesTitle:
        "设置生成函数通常保留的小数位数；位数越多，函数越精确也越长。邪道模式开启后，为保证门位置和脉冲有效，部分系数可能使用更多小数位",
      debugInfoEnabled: "已启用调试信息",
      gameMode: "游戏模式",
      gameModeAriaLabel: "Graphwar 游戏模式",
      gameModeSettingsHint: "不同游戏模式的设定会分别保存",
      gameModeTitle: "选择 Graphwar 输入框的游戏模式：y、y' 或 y''",
      mode: "工作流",
      modeAriaLabel: "工作流",
      modeTitle: "选择生成可复制函数，或输入已有函数模拟轨迹",
      overflowProtection: "防溢出",
      overflowProtectionTitle: "阶跃导数项可能溢出时自动改用稳定公式",
      parseDerivativeAsY: "y' -> y",
      parseDerivativeAsYTitle: "Graphwar 存在解析缺陷：由于正则表达式顺序，会将 y' 解析为 y",
      pathfinding: {
        heading: "寻路设定",
        workerCount: "寻路工作线程数",
        workerCountAriaLabel: "几何寻路并行工作线程数量",
        workerCountTitle: "设置寻路使用的工作线程数；默认 4，范围 1 到 128",
      },
      recognition: {
        candidateTopRatio: "候选保留比例",
        candidateTopRatioAriaLabel: "士兵模板候选保留比例",
        candidateTopRatioTitle: "模板匹配前只保留投票排名靠前的士兵候选；0.1 表示前 10%",
        heading: "识别设定",
        maximumSoldierCount: "识别士兵上限",
        maximumSoldierCountAriaLabel: "识别士兵数量上限",
        maximumSoldierCountTitle: "设置识别结果保留的士兵上限；默认 40",
        templateMatchingWorkerCount: "模板匹配工作线程数",
        templateMatchingWorkerCountAriaLabel: "士兵模板匹配并行工作线程数量",
        templateMatchingWorkerCountTitle: "设置模板匹配使用的工作线程数；默认 4，范围 1 到 128",
      },
      simulator: "模拟器设定",
      skipUnknownCharacters: "跳过未知字符",
      skipUnknownCharactersTitle: "Graphwar 会跳过未知字符",
      stepGlitchMode: "邪道模式",
      stepGlitchModeAlgorithmInactiveReason: "当前算法不生效",
      stepGlitchModeGameModeInactiveReason: "当前游戏模式不生效",
      stepGlitchModeTitle: "用于阶跃 y' 或 y''；遇到障碍或普通阶跃无法连接时尝试纵向瞬移，障碍数据存在时仍会验证碰撞",
      steepness: "陡峭度 k",
      steepnessAriaLabel: "公式陡峭度 k",
      steepnessTitle: "设置阶跃拐点或双绝对值 y'' 脉冲的陡峭度；值越大，变化越集中",
      title: "设定",
    },
  },
} as const satisfies GraphwarKillerLocale;
