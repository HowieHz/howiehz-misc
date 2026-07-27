import { runCanonicalDecimal } from "./decimal";
import { runExpressionBatch } from "./expression";
import { runCurveBatch } from "./formula-curves";
import { runPrepareLaunch } from "./formula-launch";
import {
  DECIMAL_INPUT_BYTE_LENGTH,
  EXPRESSION_INPUT_BYTE_LENGTH,
  FORMULA_COMMAND_CANONICAL_DECIMAL,
  FORMULA_COMMAND_EVALUATE_CURVE_BATCH,
  FORMULA_COMMAND_EVALUATE_EXPRESSION_BATCH,
  FORMULA_COMMAND_EVALUATE_STEP_BATCH,
  FORMULA_COMMAND_NOOP,
  FORMULA_COMMAND_PREPARE_LAUNCH,
  FORMULA_INPUT_BYTE_LENGTH,
} from "./formula-layout";
import { runStepBatch } from "./formula-step";
import { requireArenaInitialized } from "./memory";

@inline
function trap(): void {
  unreachable();
}

/** Dispatches one validated raw formula command without exposing a generic managed RPC surface. */
export function runFormula(command: i32, inputPointer: u32, inputByteLength: u32): u32 {
  requireArenaInitialized();
  if (command == FORMULA_COMMAND_NOOP) {
    if (inputPointer != 0 || inputByteLength != 0) {
      trap();
    }
    return 0;
  }
  if (command == FORMULA_COMMAND_EVALUATE_EXPRESSION_BATCH) {
    if (inputByteLength != EXPRESSION_INPUT_BYTE_LENGTH) {
      trap();
    }
    return runExpressionBatch(inputPointer);
  }
  if (command == FORMULA_COMMAND_EVALUATE_CURVE_BATCH) {
    if (inputByteLength != FORMULA_INPUT_BYTE_LENGTH) {
      trap();
    }
    return runCurveBatch(inputPointer);
  }
  if (command == FORMULA_COMMAND_EVALUATE_STEP_BATCH) {
    if (inputByteLength != FORMULA_INPUT_BYTE_LENGTH) {
      trap();
    }
    return runStepBatch(inputPointer);
  }
  if (command == FORMULA_COMMAND_PREPARE_LAUNCH) {
    if (inputByteLength != FORMULA_INPUT_BYTE_LENGTH) {
      trap();
    }
    return runPrepareLaunch(inputPointer);
  }
  if (command == FORMULA_COMMAND_CANONICAL_DECIMAL) {
    if (inputByteLength != DECIMAL_INPUT_BYTE_LENGTH) {
      trap();
    }
    return runCanonicalDecimal(inputPointer);
  }
  trap();
  return 0;
}
