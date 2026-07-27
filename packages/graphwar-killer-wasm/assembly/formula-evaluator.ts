import { evaluateCurveMaterialValue } from "./formula-curves";
import {
  FORMULA_MATERIAL_STEP,
  FORMULA_RESULT_AUXILIARY_VALUE_OFFSET,
  FORMULA_RESULT_FLAGS_OFFSET,
  FORMULA_RESULT_MATERIAL_COUNT_OFFSET,
  FORMULA_RESULT_MATERIAL_POINTER_OFFSET,
  FORMULA_RESULT_MATERIAL_TYPE_OFFSET,
  FORMULA_RESULT_PROTECTION_POINTER_OFFSET,
} from "./formula-layout";
import { evaluateStepMaterialValue } from "./formula-step";

/** Step result bit preserving the leading negative term's canonical second-derivative zero. */
const STEP_RESULT_FLAG_NORMALIZE_SECOND_DERIVATIVE_ZERO: u32 = 1;

/**
 * Evaluates one already-built canonical formula snapshot.
 *
 * Material construction owns result validation and storage. Callers provide the immutable input protection and the
 * result's caller-owned observed-protection buffer so rejected numerical trials still accumulate sign evidence.
 */
export function evaluateFormulaMaterialValue(
  materialResultPointer: u32,
  equation: i32,
  x: f64,
  y: f64,
  dy: f64,
  baseY: f64,
  protectionPointer: u32,
): f64 {
  const materialType = load<i32>(materialResultPointer + FORMULA_RESULT_MATERIAL_TYPE_OFFSET);
  const materialPointer = load<u32>(materialResultPointer + FORMULA_RESULT_MATERIAL_POINTER_OFFSET);
  const materialCount = load<u32>(materialResultPointer + FORMULA_RESULT_MATERIAL_COUNT_OFFSET);
  const observedPointer = load<u32>(materialResultPointer + FORMULA_RESULT_PROTECTION_POINTER_OFFSET);
  const auxiliaryValue = load<f64>(materialResultPointer + FORMULA_RESULT_AUXILIARY_VALUE_OFFSET);
  if (materialType == FORMULA_MATERIAL_STEP) {
    return evaluateStepMaterialValue(
      equation,
      x,
      y,
      materialPointer,
      materialCount,
      auxiliaryValue,
      baseY,
      protectionPointer,
      observedPointer,
      (load<u32>(materialResultPointer + FORMULA_RESULT_FLAGS_OFFSET) &
        STEP_RESULT_FLAG_NORMALIZE_SECOND_DERIVATIVE_ZERO) !=
        0,
    );
  }
  return evaluateCurveMaterialValue(
    materialType,
    equation,
    x,
    materialPointer,
    materialCount,
    auxiliaryValue,
    protectionPointer,
    observedPointer,
  );
}
