/**
 * Shared AdvancedPanel model types live in a plain TS module so page code does not depend on Vue SFC named type export
 * support during type checking.
 */
export interface GraphwarAdvancedSettingsBounds {
  /** X 轴最小值输入框文本；非法输入应原样交回父页面校验。 */
  minXText: string;
  /** X 轴最大值输入框文本；非法输入应原样交回父页面校验。 */
  maxXText: string;
  /** Y 轴最小值输入框文本；非法输入应原样交回父页面校验。 */
  minYText: string;
  /** Y 轴最大值输入框文本；非法输入应原样交回父页面校验。 */
  maxYText: string;
}

export interface GraphwarAdvancedSettingsSimulator {
  /** 模拟器解析时是否忽略未知字符。 */
  skipUnknownCharacters: boolean;
  /** 模拟器解析时是否把导数表达式当作 y 处理。 */
  parseDerivativeAsY: boolean;
}

export interface GraphwarAdvancedSettingsRecognition {
  /** 最大士兵数量输入框文本。 */
  maximumSoldierCountText: string;
  /** 士兵模板候选顶部比例输入框文本。 */
  candidateTopRatioText: string;
  /** 模板匹配 worker 数输入框文本。 */
  templateMatchingWorkerCountText: string;
  /** 障碍最小面积输入框文本。 */
  obstacleMinAreaText: string;
  /** 障碍最大面积；父页面应按当前 Graphwar 平面尺寸传入。 */
  obstacleMaximumArea: number;
}

export interface GraphwarAdvancedSettingsPathfinding {
  /** 截图识别来源的路径规划障碍外扩输入框文本。 */
  detectionRoutePlanningToleranceText: string;
  /** 截图识别来源的轨迹模拟障碍外扩输入框文本。 */
  detectionObstacleSimulationToleranceText: string;
  /** Agent 来源的路径规划障碍外扩输入框文本。 */
  agentRoutePlanningToleranceText: string;
  /** Agent 来源的轨迹模拟障碍外扩输入框文本。 */
  agentObstacleSimulationToleranceText: string;
  /** 阶跃 y' 邪道模式的路径规划障碍外扩输入框文本。 */
  stepGlitchRoutePlanningToleranceText: string;
  /** 阶跃 y' 邪道模式的轨迹模拟障碍外扩输入框文本。 */
  stepGlitchObstacleSimulationToleranceText: string;
  /** 寻路 worker 数输入框文本。 */
  workerCountText: string;
  /** 一键清图删除检测半径输入框文本。 */
  oneClickClearDeleteCheckRadiusText: string;
  /** 删点关闭时半径没有语义，因此不展示也不参与命令校验。 */
  oneClickClearDeleteCheckRadiusVisible: boolean;
  /** 一键清图删除检测半径最小值，单位为 Graphwar 原始平面像素。 */
  oneClickClearDeleteCheckRadiusMinimumPlanePixels: number;
}

export interface GraphwarAdvancedSettingsActionBar {
  /** 实时点击预览 Worker 数输入框文本。 */
  liveClickPreviewWorkerCountText: string;
  /** 实时点击预览 Worker 数上限；父页面和调度器应使用同一范围。 */
  liveClickPreviewWorkerCountMaximum: number;
}

export interface GraphwarAdvancedSettingsPanelModel {
  /** 托管期间锁定所有会改变识别、公式或寻路输入的高级设置。 */
  interactionDisabled: boolean;
  /** 生成公式工作流专用的识别、寻路和操作栏设置是否可见。 */
  solverSettingsVisible: boolean;
  /** 坐标边界设置展示模型。 */
  bounds: GraphwarAdvancedSettingsBounds;
  /** 模拟器设置展示模型。 */
  simulator: GraphwarAdvancedSettingsSimulator;
  /** 识别设置展示模型。 */
  recognition: GraphwarAdvancedSettingsRecognition;
  /** 寻路设置展示模型。 */
  pathfinding: GraphwarAdvancedSettingsPathfinding;
  /** 操作栏设置展示模型。 */
  actionBar: GraphwarAdvancedSettingsActionBar;
}
