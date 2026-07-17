/** 定义 Graphwar 杀手各 Module 共享的模式、坐标和状态类型。 */
declare const pixelPointBrand: unique symbol;
declare const graphPointBrand: unique symbol;

/** Graphwar 输入框支持的三种公式解释方式；工具必须用它区分模拟器的积分规则。 */
export type EquationMode = "y" | "dy" | "ddy";
/** 生成可复制公式的曲线拼接策略；每种策略对应不同的稳定性和长度取舍。 */
export type AlgorithmMode = "step" | "abs" | "pchip" | "akima";
/** Y''= 公式的发射角执行精度；调用方显式选择完整 double 或两位小数兼容模型。 */
export type GraphwarSecondOrderLaunchAngleMode = "display-rounded" | "full-precision";
/** 页面舞台当前点击语义，避免边界标定、攻击路径和障碍修正共享同一状态入口。 */
export type ToolMode = "bounds" | "path" | "obstacle";
/** 页面主工作流：生成 Graphwar 公式，或模拟用户手写表达式。 */
export type ToolWorkflowMode = "solver" | "simulator";
/** 复制/导入等短反馈状态，统一用有限集合驱动 UI 文案和样式。 */
export type TransferStatus = "idle" | "success" | "error";

/** 二维点基础结构；品牌类型在它之上区分像素坐标和 Graphwar 坐标。 */
interface Point2D {
  /** 横坐标；单位由具体品牌类型决定。 */
  x: number;
  /** 纵坐标；单位由具体品牌类型决定。 */
  y: number;
}

/** 只暴露响应式值读取能力，避免控制器依赖 Vue Ref 的完整可写接口。 */
export interface ReadonlyValue<T> {
  readonly value: T;
}

/** 截图像素坐标点，使用品牌类型避免误传给 Graphwar 坐标 API。 */
export type PixelPoint = Point2D & {
  readonly [pixelPointBrand]: "PixelPoint";
};

/** Graphwar 游戏坐标点，使用品牌类型避免误传给截图像素 API。 */
export type GraphPoint = Point2D & {
  readonly [graphPointBrand]: "GraphPoint";
};

/**
 * 创建截图像素坐标点。
 *
 * @param x 截图像素横坐标。
 * @param y 截图像素纵坐标。
 */
export function createPixelPoint(x: number, y: number): PixelPoint {
  return { x, y } as PixelPoint;
}

/** 复制截图像素坐标，去掉可能附着在源对象上的响应式代理。 */
export function clonePixelPoint(point: PixelPoint): PixelPoint {
  return createPixelPoint(point.x, point.y);
}

/**
 * 创建 Graphwar 游戏坐标点。
 *
 * @param x Graphwar 横坐标。
 * @param y Graphwar 纵坐标。
 */
export function createGraphPoint(x: number, y: number): GraphPoint {
  return { x, y } as GraphPoint;
}

/** 截图上的矩形区域；用于图片边界、识别框和命中范围。 */
export interface BoundsRect {
  /** 左上角像素 x。 */
  x: number;
  /** 左上角像素 y。 */
  y: number;
  /** 矩形像素宽度。 */
  width: number;
  /** 矩形像素高度。 */
  height: number;
}

/** 用户标定出的 Graphwar 坐标范围，决定像素和游戏坐标的线性映射。 */
export interface GraphBounds {
  /** 左边界对应的 Graphwar x。 */
  minX: number;
  /** 右边界对应的 Graphwar x。 */
  maxX: number;
  /** 下/上边界之一对应的 Graphwar y，具体方向由边界大小决定。 */
  minY: number;
  /** 下/上边界之一对应的 Graphwar y，具体方向由边界大小决定。 */
  maxY: number;
}

/** Step 算法的一段纵向变化；表达式生成阶段会把它转换成 sigmoid 项。 */
export interface StepTerm {
  /** 阶跃中心所在的 Graphwar x。 */
  x: number;
  /** 相对上一点需要累计的 y 变化量。 */
  deltaY: number;
}

/** 公式生成结果；只包含可复制到 Graphwar 的表达式材料。 */
export interface FormulaResult {
  /** 可复制到 Graphwar 的最终公式文本。 */
  expression: string;
  /** Step 模式下的中间项，供调试和后续采样复用。 */
  terms: StepTerm[];
}
