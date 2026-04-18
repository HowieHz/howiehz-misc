export interface CompatibilityTestStep {
  promptTargets: number[];
  insideTargets: number[];
  outsideTargetGroups: number[][];
  definedTargets: number[];
  requiresAnswer: boolean;
}

export interface CompatibilityTestState {
  numberList: number[];
  insideArrow: string;
  outsideArrows: string[];
  definedTargets: number[];
  cachedResults: Map<string, boolean>;
  stopped: boolean;
  resultTargets: number[];
}

export function createCompatibilityTestState(targetCount: number): CompatibilityTestState {
  return {
    numberList: Array.from({ length: targetCount }, (_, index) => index + 1),
    insideArrow: "l",
    outsideArrows: [],
    definedTargets: [],
    cachedResults: new Map<string, boolean>(),
    stopped: false,
    resultTargets: [],
  };
}

export function getCurrentCompatibilityTestStep(state: CompatibilityTestState): CompatibilityTestStep | undefined {
  if (state.stopped) {
    return undefined;
  }

  const promptTargets = getPromptTargets(state);
  const cacheKey = getTargetSetKey(promptTargets);

  return {
    promptTargets,
    insideTargets: resolveArrow(state, state.insideArrow),
    outsideTargetGroups: state.outsideArrows.map((arrow) => resolveArrow(state, arrow)),
    definedTargets: state.definedTargets.slice(),
    requiresAnswer: !state.cachedResults.has(cacheKey),
  };
}

export function applyCompatibilityTestAnswer(state: CompatibilityTestState, hasIssue: boolean): CompatibilityTestStep | undefined {
  const currentStep = getCurrentCompatibilityTestStep(state);
  if (!currentStep) {
    return undefined;
  }

  const cacheKey = getTargetSetKey(currentStep.promptTargets);
  state.cachedResults.set(cacheKey, hasIssue);
  if (!hasIssue && isFullTargetSet(state, currentStep.promptTargets)) {
    stopCompatibilityTest(state, []);
    return undefined;
  }

  advanceCompatibilityTestState(state, hasIssue);
  return getCurrentCompatibilityTestStep(state);
}

export function skipCachedCompatibilityTestSteps(state: CompatibilityTestState): CompatibilityTestStep | undefined {
  let step = getCurrentCompatibilityTestStep(state);
  while (step && !step.requiresAnswer) {
    if (!state.cachedResults.get(getTargetSetKey(step.promptTargets)) && isFullTargetSet(state, step.promptTargets)) {
      stopCompatibilityTest(state, []);
      return undefined;
    }

    advanceCompatibilityTestState(state, state.cachedResults.get(getTargetSetKey(step.promptTargets)) ?? false);
    step = getCurrentCompatibilityTestStep(state);
  }

  return step;
}

export function resolveArrow(state: CompatibilityTestState, arrow: string): number[] {
  let targets = state.numberList;
  if (arrow === "") {
    return targets;
  }

  for (const sign of arrow) {
    const pivot = Math.floor((targets.length + 1) / 2);
    if (sign === "l") {
      targets = targets.slice(0, pivot);
    } else if (sign === "r") {
      targets = targets.slice(pivot);
    }
  }

  return targets;
}

function getPromptTargets(state: CompatibilityTestState): number[] {
  return [
    ...resolveArrow(state, state.insideArrow),
    ...state.outsideArrows.flatMap((arrow) => resolveArrow(state, arrow)),
    ...state.definedTargets,
  ].sort((left, right) => left - right);
}

function advanceCompatibilityTestState(state: CompatibilityTestState, hasIssue: boolean) {
  if (hasIssue) {
    advanceIssueState(state);
    return;
  }

  advancePassState(state);
}

function advanceIssueState(state: CompatibilityTestState) {
  const insideTargets = resolveArrow(state, state.insideArrow);
  if (insideTargets.length === 1) {
    if (state.outsideArrows.length === 0) {
      state.resultTargets = [...insideTargets, ...state.definedTargets].sort((left, right) => left - right);
      state.stopped = true;
      return;
    }

    state.definedTargets.push(...insideTargets);
    const nextInsideArrow = state.outsideArrows.at(-1);
    if (nextInsideArrow === undefined) {
      state.stopped = true;
      return;
    }

    state.insideArrow = nextInsideArrow;
    state.outsideArrows.pop();
    return;
  }

  state.insideArrow += "l";
}

function advancePassState(state: CompatibilityTestState) {
  if (state.insideArrow.endsWith("l")) {
    state.insideArrow = `${state.insideArrow.slice(0, -1)}r`;
    return;
  }

  state.outsideArrows.push(state.insideArrow);
  state.insideArrow = `${state.insideArrow.slice(0, -1)}ll`;
}

function getTargetSetKey(targets: readonly number[]) {
  return targets.join(",");
}

function isFullTargetSet(state: CompatibilityTestState, targets: readonly number[]) {
  return targets.length === state.numberList.length
    && targets.every((target, index) => target === state.numberList[index]);
}

function stopCompatibilityTest(state: CompatibilityTestState, resultTargets: readonly number[]) {
  state.resultTargets = [...resultTargets];
  state.stopped = true;
}
