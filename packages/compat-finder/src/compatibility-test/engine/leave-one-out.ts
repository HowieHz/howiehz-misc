import {
  stopCompatibilityTest,
  subtractTargetRanges,
  type CompatibilityTestDebugStep,
  type CompatibilityTestStateBase,
  type TargetRange,
} from "../core.ts";

export interface LeaveOneOutCompatibilityTestState extends CompatibilityTestStateBase {
  algorithm: "leave-one-out";
  currentExcludedTarget: number;
  confirmingFullSet: boolean;
}

export function createLeaveOneOutCompatibilityTestState(targetCount: number): LeaveOneOutCompatibilityTestState {
  return {
    targetCount,
    algorithm: "leave-one-out",
    currentExcludedTarget: 1,
    confirmingFullSet: false,
    definedTargets: [],
    cachedResults: new Map<string, boolean>(),
    stopped: false,
    resultTargets: [],
  };
}

export function getLeaveOneOutPromptTargetRanges(state: LeaveOneOutCompatibilityTestState): TargetRange[] {
  if (state.confirmingFullSet) {
    return [{ start: 1, end: state.targetCount }];
  }

  if (state.targetCount === 1) {
    return [{ start: 1, end: 1 }];
  }

  return subtractTargetRanges(
    [{ start: 1, end: state.targetCount }],
    [{ start: state.currentExcludedTarget, end: state.currentExcludedTarget }],
  );
}

export function getLeaveOneOutCompatibilityTestDebugStep(
  state: LeaveOneOutCompatibilityTestState,
): CompatibilityTestDebugStep {
  if (state.confirmingFullSet) {
    return {
      activeTargetRange: { start: 1, end: state.targetCount },
      pendingTargetRanges: [],
      confirmedTargetRanges: state.definedTargets.map((target) => ({ start: target, end: target })),
    };
  }

  return {
    activeTargetRange: {
      start: state.currentExcludedTarget,
      end: state.currentExcludedTarget,
    },
    pendingTargetRanges:
      state.currentExcludedTarget < state.targetCount
        ? [{ start: state.currentExcludedTarget + 1, end: state.targetCount }]
        : [],
    confirmedTargetRanges: state.definedTargets.map((target) => ({ start: target, end: target })),
  };
}

export function advanceLeaveOneOutState(state: LeaveOneOutCompatibilityTestState, hasIssue: boolean): void {
  if (state.confirmingFullSet) {
    stopCompatibilityTest(state, state.definedTargets);
    return;
  }

  if (state.targetCount === 1) {
    stopCompatibilityTest(state, hasIssue ? [1] : []);
    return;
  }

  if (!hasIssue) {
    state.definedTargets.push(state.currentExcludedTarget);
  }

  if (state.currentExcludedTarget < state.targetCount) {
    state.currentExcludedTarget += 1;
    return;
  }

  if (state.definedTargets.length === state.targetCount) {
    state.confirmingFullSet = true;
    return;
  }

  stopCompatibilityTest(state, state.definedTargets);
}
