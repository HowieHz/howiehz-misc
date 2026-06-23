declare const pixelPointBrand: unique symbol;
declare const graphPointBrand: unique symbol;

export type EquationMode = "y" | "dy" | "ddy";
export type AlgorithmMode = "step" | "abs";
export type ToolMode = "bounds" | "path";
export type TransferStatus = "idle" | "success" | "error";

interface Point2D {
  x: number;
  y: number;
}

export type PixelPoint = Point2D & {
  readonly [pixelPointBrand]: "PixelPoint";
};

export type GraphPoint = Point2D & {
  readonly [graphPointBrand]: "GraphPoint";
};

export function createPixelPoint(x: number, y: number): PixelPoint {
  return { x, y } as PixelPoint;
}

export function createGraphPoint(x: number, y: number): GraphPoint {
  return { x, y } as GraphPoint;
}

export interface BoundsRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GraphBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface StepTerm {
  x: number;
  deltaY: number;
}

export interface FormulaResult {
  expression: string;
  previewExpression: string;
  terms: StepTerm[];
}
