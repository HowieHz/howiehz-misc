import type { GraphwarTrajectorySamplingState } from "../../formula/simulation/simulator";
import { createGraphPoint } from "../types";
import type { EquationMode, GraphPoint } from "../types";
import { GraphwarWasmAdapterError, validateGraphwarWasmFiniteNumber, validateGraphwarWasmU32 } from "./abi";

/** Physical continuation state makes second-order derivative history an indivisible atom. */
export type GraphwarWasmTrajectoryPhysicalState =
  | {
      currentPoint: GraphPoint;
      equation: "dy" | "y";
      previousPoint?: GraphPoint;
      sampleIndex: number;
    }
  | {
      currentDy: number;
      currentPoint: GraphPoint;
      equation: "ddy";
      previous?: { dy: number; point: GraphPoint };
      sampleIndex: number;
    };

/** Converts sampler state into the only physical-state shapes accepted by the WASM ABI. */
export function createGraphwarWasmTrajectoryPhysicalStateFromSamplingState(
  state: GraphwarTrajectorySamplingState,
  equation: EquationMode,
  fieldName: string,
): GraphwarWasmTrajectoryPhysicalState {
  const sampleIndex = validateGraphwarWasmU32(state.sampleIndex, `${fieldName}.sampleIndex`, "input");
  const currentPoint = createGraphPoint(
    validateGraphwarWasmFiniteNumber(state.currentPoint.x, `${fieldName}.currentPoint.x`, "input"),
    validateGraphwarWasmFiniteNumber(state.currentPoint.y, `${fieldName}.currentPoint.y`, "input"),
  );
  const previousPoint = state.previousPoint;
  const hasPreviousPoint = previousPoint !== undefined;
  if ((sampleIndex === 0) === hasPreviousPoint) {
    throw new GraphwarWasmAdapterError(
      "invalid-formula-input",
      `${fieldName} previous state does not match its sample index`,
      "input",
    );
  }

  if (equation === "ddy") {
    const hasPreviousDy = state.previousDy !== undefined;
    if (state.dy === undefined || hasPreviousDy !== hasPreviousPoint) {
      throw new GraphwarWasmAdapterError(
        "invalid-formula-input",
        `${fieldName} second-order derivative state is incomplete`,
        "input",
      );
    }
    const currentDy = validateGraphwarWasmFiniteNumber(state.dy, `${fieldName}.currentDy`, "input");
    if (previousPoint && state.previousDy !== undefined) {
      return {
        currentDy,
        currentPoint,
        equation,
        previous: {
          dy: validateGraphwarWasmFiniteNumber(state.previousDy, `${fieldName}.previous.dy`, "input"),
          point: createGraphPoint(
            validateGraphwarWasmFiniteNumber(previousPoint.x, `${fieldName}.previous.point.x`, "input"),
            validateGraphwarWasmFiniteNumber(previousPoint.y, `${fieldName}.previous.point.y`, "input"),
          ),
        },
        sampleIndex,
      };
    }
    return { currentDy, currentPoint, equation, sampleIndex };
  }

  if (state.dy !== undefined || state.previousDy !== undefined) {
    throw new GraphwarWasmAdapterError(
      "invalid-formula-input",
      `${fieldName} contains derivative state for a non-second-order equation`,
      "input",
    );
  }
  return {
    currentPoint,
    equation,
    ...(previousPoint
      ? {
          previousPoint: createGraphPoint(
            validateGraphwarWasmFiniteNumber(previousPoint.x, `${fieldName}.previousPoint.x`, "input"),
            validateGraphwarWasmFiniteNumber(previousPoint.y, `${fieldName}.previousPoint.y`, "input"),
          ),
        }
      : {}),
    sampleIndex,
  };
}
