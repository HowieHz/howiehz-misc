import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "../../core/game/constants";
import { MAX_FORMULA_DECIMAL_PLACES } from "../../core/numbers";
import type { BoundsRect, GraphBounds, GraphPoint, PixelPoint } from "../../core/types";
import type { GraphwarExpressionParserOptions } from "../expression/evaluator";
import type { GraphwarTrajectoryCollisionSettings, GraphwarTrajectoryFormulaSettings } from "./sampling";

/** Worker Adapter 共用的有限坐标点校验。 */
export function isGraphwarTrajectoryPoint(value: unknown): value is GraphPoint | PixelPoint {
  return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);
}

/** Worker Adapter 共用的 Graphwar 数值边界校验。 */
export function isGraphwarTrajectoryBounds(value: unknown): value is GraphBounds {
  return (
    isRecord(value) &&
    isFiniteNumber(value.minX) &&
    isFiniteNumber(value.minY) &&
    isFiniteNumber(value.maxX) &&
    isFiniteNumber(value.maxY) &&
    value.minX < value.maxX &&
    value.minY < value.maxY
  );
}

/** Worker Adapter 共用的截图坐标矩形校验。 */
export function isGraphwarTrajectoryBoundsRect(value: unknown): value is BoundsRect {
  return (
    isRecord(value) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.width) &&
    isFiniteNumber(value.height) &&
    value.width > 0 &&
    value.height > 0
  );
}

/** Worker Adapter 共用的碰撞设置校验；存在的 mask 必须是完整 Graphwar plane。 */
export function isGraphwarTrajectoryCollisionSettings(value: unknown): value is GraphwarTrajectoryCollisionSettings {
  return (
    isRecord(value) &&
    (value.boundaryExpansion === undefined || isNonNegativeFiniteNumber(value.boundaryExpansion)) &&
    (value.mask === undefined || isGraphwarPlaneMask(value.mask))
  );
}

/** Worker Adapter 共用的 expression parser option 校验。 */
export function isGraphwarTrajectoryExpressionParserOptions(value: unknown): value is GraphwarExpressionParserOptions {
  return (
    isRecord(value) &&
    typeof value.shouldParseDerivativeAsY === "boolean" &&
    typeof value.shouldSkipUnknownCharacters === "boolean"
  );
}

/** Worker Adapter 共用的 12 Formula Mode 设置校验。 */
export function isGraphwarTrajectoryFormulaSettings(value: unknown): value is GraphwarTrajectoryFormulaSettings {
  return (
    isRecord(value) &&
    (value.algorithm === "abs" ||
      value.algorithm === "step" ||
      value.algorithm === "pchip" ||
      value.algorithm === "akima") &&
    Number.isInteger(value.decimalPlaces) &&
    typeof value.decimalPlaces === "number" &&
    value.decimalPlaces >= 0 &&
    value.decimalPlaces <= MAX_FORMULA_DECIMAL_PLACES &&
    (value.equation === "y" || value.equation === "dy" || value.equation === "ddy") &&
    (value.secondOrderLaunchAngleMode === undefined ||
      value.secondOrderLaunchAngleMode === "full-precision" ||
      value.secondOrderLaunchAngleMode === "display-rounded") &&
    (value.formulaPathSteepness === undefined || isPositiveFiniteNumber(value.formulaPathSteepness)) &&
    isPositiveFiniteNumber(value.steepness) &&
    typeof value.isStepGlitchModeEnabled === "boolean" &&
    (value.stepGlitchObstacleMask === undefined || isGraphwarPlaneMask(value.stepGlitchObstacleMask)) &&
    typeof value.isStepOverflowProtectionEnabled === "boolean"
  );
}

function isGraphwarPlaneMask(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array && value.length === GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT;
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
