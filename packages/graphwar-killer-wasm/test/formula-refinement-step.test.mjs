import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const compilerPath = join(packageRoot, "node_modules", "assemblyscript", "bin", "asc.js");

const constants = new Float64Array([770, 450, 50, 7, 15, 0.01, 20_000, 0.001, 0.00001, Math.PI / 360, 100]);
const gameSoldierRadius = (7 * 50) / 770;
const jumpStartXOffset = 0;
const jumpEndXOffset = 8;
const jumpStepOffset = 16;
const jumpByteLength = 24;
const segmentByteLength = 72;
const scalarResultFlagsOffset = 44;
const scalarResultFlagObstacleHit = 1;

test("ports Step cold hard-glitch candidate math and stable ordering", async () => {
  const { bytes, temporaryDirectory } = await compileHarness();
  try {
    const instance = await WebAssembly.instantiate(bytes);
    const exports = instance.instance.exports;
    initializeGameConstants(exports);

    assert.deepEqual(
      Array.from({ length: 6 }, (_, index) => exports.getStepGlitchRk4ContributionFactor(index)),
      [1, 5 / 6, 2 / 3, 1 / 2, 1 / 3, 1 / 6],
    );
    assert.equal(exports.getStepGlitchInitialWindowDecimalPlaces(), 2);
    assert.throws(() => exports.getStepGlitchRk4ContributionFactor(6), WebAssembly.RuntimeError);

    assert.equal(compareLandingQuality(exports, { hasBest: false }), true);
    assert.equal(
      compareLandingQuality(exports, {
        bestDerivativeError: 0,
        bestPositionError: 1.1,
        candidateDerivativeError: 100,
        candidatePositionError: 1,
      }),
      true,
    );
    assert.equal(
      compareLandingQuality(exports, {
        bestDerivativeError: 0,
        bestPositionError: 3,
        candidateDerivativeError: 100,
        candidatePositionError: 2,
      }),
      true,
    );
    assert.equal(
      compareLandingQuality(exports, {
        bestDerivativeError: 0.2,
        bestPositionError: 0.1,
        candidateDerivativeError: 0.1,
        candidatePositionError: 0.9,
      }),
      true,
    );
    assert.equal(
      compareLandingQuality(exports, {
        bestDerivativeError: 0.1,
        bestPositionError: 0.1,
        bestTieBreaker: 2,
        candidateDerivativeError: 0.1,
        candidatePositionError: 0.9,
        candidateTieBreaker: 1,
        hasTieBreaker: true,
      }),
      true,
    );
    assert.equal(
      compareLandingQuality(exports, {
        bestDerivativeError: 0.1,
        bestPositionError: 0.9,
        candidateDerivativeError: 0.1,
        candidatePositionError: 0.1,
      }),
      true,
    );

    const mark = exports.markArena();
    const jumpPointer = exports.reserveArena(jumpByteLength, 8);
    const segmentPointer = exports.reserveArena(segmentByteLength, 8);
    assert.equal(exports.createStepGlitchJump(1, 2, 0.01, 4, 2, jumpPointer), 1);
    let view = new DataView(exports.memory.buffer);
    assert.equal(view.getFloat64(jumpPointer + jumpStartXOffset, true), 1.99);
    assert.equal(view.getFloat64(jumpPointer + jumpEndXOffset, true), 2);
    const step = 0.01 / 2 ** Math.ceil(Math.log2(0.01 / 0.00001));
    assert.equal(view.getFloat64(jumpPointer + jumpStepOffset, true), step);
    assert.equal(exports.createStepGlitchJump(2, 2, 0.01, 4, 2, jumpPointer), 0);
    view = new DataView(exports.memory.buffer);
    assert.deepEqual(
      [
        view.getFloat64(jumpPointer + jumpStartXOffset, true),
        view.getFloat64(jumpPointer + jumpEndXOffset, true),
        view.getFloat64(jumpPointer + jumpStepOffset, true),
      ],
      [0, 0, 0],
    );
    assert.equal(exports.createStepGlitchJump(1, 2, 0.01, 4, 2, jumpPointer), 1);
    assert.equal(exports.createStepSegmentRefinementStopX(4, 3, 0), 4);
    assert.equal(exports.createStepSegmentRefinementStopX(4, 3, 1), 3);

    const upwardGate = quantizeFormulaOffsetCenter(5 - gameSoldierRadius, 4);
    const downwardGate = quantizeFormulaOffsetCenter(5 + gameSoldierRadius, 4);
    assert.equal(exports.createStepGlitchFormulaGateY(5, 0, 4), 5);
    assert.equal(exports.createStepGlitchFormulaGateY(5, 1, 4), upwardGate);
    assert.equal(exports.createStepGlitchFormulaGateY(5, -1, 4), downwardGate);

    const replacementDeltaY = 3.25;
    const factor = exports.getStepGlitchRk4ContributionFactor(1);
    exports.createStepFirstOrderGlitchSegment(jumpPointer, 5, upwardGate, replacementDeltaY, factor, 4, segmentPointer);
    view = new DataView(exports.memory.buffer);
    assertSegmentBase(view, segmentPointer, { decimalPlaces: 4, endX: 2, equation: 2, startX: 1.99, targetY: 5 });
    assert.equal(view.getFloat64(segmentPointer + 32, true), replacementDeltaY / (factor * step));
    assert.equal(view.getFloat64(segmentPointer + 40, true), upwardGate);
    assert.equal(view.getFloat64(segmentPointer + 48, true), 0);

    const resumeX = 1.99 - step / 2;
    const resumeY = 0;
    const resumeDerivative = 0.25;
    const targetY = 4;
    const directDeltaY = targetY - resumeY - step * resumeDerivative;
    const directAcceleration = (3 * directDeltaY) / step ** 2;
    assert.equal(
      exports.createStepSecondOrderGlitchSegmentCandidate(
        jumpPointer,
        targetY,
        resumeX,
        resumeY,
        resumeDerivative,
        5,
        0,
        segmentPointer,
      ),
      1,
    );
    view = new DataView(exports.memory.buffer);
    assertSegmentBase(view, segmentPointer, { decimalPlaces: 5, endX: 2, equation: 3, startX: 1.99, targetY });
    assert.equal(view.getFloat64(segmentPointer + 32, true), directAcceleration);
    assert.equal(view.getFloat64(segmentPointer + 48, true), (-3 * resumeDerivative) / step - 2 * directAcceleration);
    assert.equal(view.getFloat64(segmentPointer + 64, true), resumeX + 1.25 * step);

    const armStep = step;
    const armedDeltaY = targetY - resumeY - (armStep + step) * resumeDerivative;
    const armedAcceleration = armedDeltaY / ((step * armStep) / 6 + step ** 2 / 2);
    assert.equal(
      exports.createStepSecondOrderGlitchSegmentCandidate(
        jumpPointer,
        targetY,
        resumeX,
        resumeY,
        resumeDerivative,
        5,
        1,
        segmentPointer,
      ),
      1,
    );
    view = new DataView(exports.memory.buffer);
    assert.equal(view.getFloat64(segmentPointer + 32, true), armedAcceleration);
    assert.equal(
      view.getFloat64(segmentPointer + 48, true),
      (-3 * resumeDerivative) / step - (armedAcceleration * (5 + armStep / step)) / 2,
    );
    assert.equal(view.getFloat64(segmentPointer + 64, true), resumeX + armStep + 1.25 * step);
    assert.equal(view.getFloat64(segmentPointer + 40, true), view.getFloat64(segmentPointer + 56, true));

    assert.equal(
      exports.createStepSecondOrderGlitchSegmentCandidate(
        jumpPointer,
        resumeY,
        resumeX,
        resumeY,
        0,
        5,
        0,
        segmentPointer,
      ),
      0,
    );
    assert.throws(
      () =>
        exports.createStepSecondOrderGlitchSegmentCandidate(
          jumpPointer,
          targetY,
          resumeX,
          resumeY,
          resumeDerivative,
          5,
          2,
          segmentPointer,
        ),
      WebAssembly.RuntimeError,
    );

    view = new DataView(exports.memory.buffer);
    view.setFloat64(jumpPointer + jumpStartXOffset, 0.1, true);
    const scalarStopX = 0.11;
    view.setFloat64(jumpPointer + jumpEndXOffset, scalarStopX, true);
    view.setFloat64(jumpPointer + jumpStepOffset, step, true);
    const scalarGate = exports.createStepGlitchFormulaGateY(4, 4, 5);
    let hasSingleAcceptedJump = false;
    const scalarOutcomes = [];
    for (let factorIndex = 0; factorIndex < 6; factorIndex += 1) {
      exports.createStepFirstOrderGlitchSegment(
        jumpPointer,
        4,
        scalarGate,
        4,
        exports.getStepGlitchRk4ContributionFactor(factorIndex),
        5,
        segmentPointer,
      );
      const scalarInputPointer = writeScalarStepInput(exports, segmentPointer);
      const scalarMaterialPointer = exports.runStepBatch(scalarInputPointer);
      const scalarStatePointer = exports.reserveArena(64, 8);
      const scalarResultPointer = exports.reserveArena(48, 8);
      exports.initializeTrajectoryScalarState(scalarStatePointer, 2, 0.1 - step / 2, 0, 0, 0, 0, 0, 0, 0);
      exports.replayFormulaTrajectoryScalarToStopX(
        scalarMaterialPointer,
        2,
        0,
        0,
        -1,
        2,
        -1e9,
        1e9,
        scalarStopX,
        new DataView(exports.memory.buffer).getUint32(scalarInputPointer + 28, true),
        scalarStatePointer,
        scalarResultPointer,
        0,
      );
      view = new DataView(exports.memory.buffer);
      scalarOutcomes.push([
        view.getInt32(scalarResultPointer, true),
        view.getUint32(scalarResultPointer + 40, true),
        view.getFloat64(scalarResultPointer + 16, true),
        view.getFloat64(scalarResultPointer + 24, true),
      ]);
      if (view.getInt32(scalarResultPointer, true) === 1 && view.getUint32(scalarResultPointer + 40, true) === 1) {
        exports.initializeTrajectoryScalarState(scalarStatePointer, 2, 0.1 - step / 2, 0, 0, 0, 0, 0, 0, 0);
        new DataView(exports.memory.buffer).setUint32(scalarStatePointer + 56, 7, true);
        exports.replayFormulaTrajectoryScalarToStopXWithMaskAndJumpWindow(
          scalarMaterialPointer,
          2,
          0,
          0,
          -1,
          2,
          -1e9,
          1e9,
          scalarStopX,
          new DataView(exports.memory.buffer).getUint32(scalarInputPointer + 28, true),
          scalarStatePointer,
          scalarResultPointer,
          0,
          0,
          0.1,
          scalarStopX,
        );
        view = new DataView(exports.memory.buffer);
        assert.equal(view.getUint32(scalarResultPointer + 40, true), 8);
        assert.equal(view.getUint32(scalarResultPointer + scalarResultFlagsOffset, true) >> 1, 1);
        hasSingleAcceptedJump = true;
        break;
      }
    }
    assert.equal(hasSingleAcceptedJump, true, JSON.stringify(scalarOutcomes));

    const rejectedGlitchPointer = exports.reserveArena(segmentByteLength, 8);
    new Uint8Array(exports.memory.buffer, rejectedGlitchPointer, segmentByteLength).fill(0);
    view = new DataView(exports.memory.buffer);
    view.setInt32(rejectedGlitchPointer, 2, true);
    view.setInt32(rejectedGlitchPointer + 4, 5, true);
    view.setFloat64(rejectedGlitchPointer + 8, 0.1, true);
    view.setFloat64(rejectedGlitchPointer + 16, 0.11, true);
    view.setFloat64(rejectedGlitchPointer + 24, 4, true);
    view.setFloat64(rejectedGlitchPointer + 32, 819_200, true);
    view.setFloat64(rejectedGlitchPointer + 40, 4, true);

    const endProtectedInputPointer = writeScalarStepInput(exports, rejectedGlitchPointer, 2);
    const endProtectedMaterialPointer = exports.runStepBatch(endProtectedInputPointer);
    const rejectedStatePointer = exports.reserveArena(64, 8);
    const rejectedResultPointer = exports.reserveArena(48, 8);
    exports.initializeTrajectoryScalarState(rejectedStatePointer, 2, 0.095, 0, 0, 0, 0, 0, 0, 0);
    exports.replayFormulaTrajectoryScalarToStopX(
      endProtectedMaterialPointer,
      2,
      0,
      0,
      -1,
      2,
      -1e9,
      1e9,
      0.0975,
      new DataView(exports.memory.buffer).getUint32(endProtectedInputPointer + 28, true),
      rejectedStatePointer,
      rejectedResultPointer,
      0,
    );
    view = new DataView(exports.memory.buffer);
    assert.equal(view.getInt32(rejectedResultPointer, true), 2);
    assert.equal(view.getUint32(rejectedResultPointer + 8, true), 0);
    assert.equal(view.getUint32(view.getUint32(endProtectedMaterialPointer + 32, true), true) & 1, 1);

    const gateProtectedInputPointer = writeScalarStepInput(exports, rejectedGlitchPointer, 3);
    const gateProtectedMaterialPointer = exports.runStepBatch(gateProtectedInputPointer);
    const acceptedStatePointer = exports.reserveArena(64, 8);
    const acceptedResultPointer = exports.reserveArena(48, 8);
    exports.initializeTrajectoryScalarState(acceptedStatePointer, 2, 0.095, 0, 0, 0, 0, 0, 0, 0);
    exports.replayFormulaTrajectoryScalarToStopX(
      gateProtectedMaterialPointer,
      2,
      0,
      0,
      -1,
      2,
      -1e9,
      1e9,
      0.0975,
      new DataView(exports.memory.buffer).getUint32(gateProtectedInputPointer + 28, true),
      acceptedStatePointer,
      acceptedResultPointer,
      0,
    );
    view = new DataView(exports.memory.buffer);
    assert.equal(view.getInt32(acceptedResultPointer, true), 1);
    assert.equal(view.getUint32(acceptedResultPointer + 8, true), 2);
    assert.equal(view.getFloat64(acceptedResultPointer + 16, true), 0.0975);
    assert.equal(view.getFloat64(acceptedResultPointer + 24, true), 6.313409054807027e-11);

    const maskPointer = exports.reserveArena(770 * 450, 1);
    new Uint8Array(exports.memory.buffer, maskPointer, 770 * 450).fill(0);
    assert.equal(exports.stepGlitchObstacleEnvelopeHitsObstacle(-1, 0, 1, 0, 0, -25, 25, -14, 14, maskPointer), 0);
    new Uint8Array(exports.memory.buffer, maskPointer, 770 * 450)[225 * 770 + 385] = 1;
    assert.equal(exports.stepGlitchObstacleEnvelopeHitsObstacle(-1, 0, 1, 0, 0, -25, 25, -14, 14, maskPointer), 1);

    const zeroGlitchPointer = exports.reserveArena(segmentByteLength, 8);
    new Uint8Array(exports.memory.buffer, zeroGlitchPointer, segmentByteLength).fill(0);
    const collisionInputPointer = writeScalarStepInput(exports, zeroGlitchPointer);
    const collisionMaterialPointer = exports.runStepBatch(collisionInputPointer);
    const collisionStatePointer = exports.reserveArena(64, 8);
    const collisionResultPointer = exports.reserveArena(48, 8);
    new Uint8Array(exports.memory.buffer, maskPointer, 770 * 450).fill(0);
    exports.initializeTrajectoryScalarState(collisionStatePointer, 2, 0, 0, 0, 0, 0, 0, 0, 0);
    exports.replayFormulaTrajectoryScalarToStopXWithMask(
      collisionMaterialPointer,
      2,
      0,
      0,
      -1,
      2,
      -1,
      1,
      0.01,
      new DataView(exports.memory.buffer).getUint32(collisionInputPointer + 28, true),
      collisionStatePointer,
      collisionResultPointer,
      0,
      maskPointer,
    );
    view = new DataView(exports.memory.buffer);
    assert.equal(view.getUint32(collisionResultPointer + scalarResultFlagsOffset, true), 0);
    new Uint8Array(exports.memory.buffer, maskPointer, 770 * 450)[225 * 770 + 256] = 1;
    exports.initializeTrajectoryScalarState(collisionStatePointer, 2, 0, 0, 0, 0, 0, 0, 0, 0);
    exports.replayFormulaTrajectoryScalarToStopXWithMask(
      collisionMaterialPointer,
      2,
      0,
      0,
      -1,
      2,
      -1,
      1,
      0.01,
      new DataView(exports.memory.buffer).getUint32(collisionInputPointer + 28, true),
      collisionStatePointer,
      collisionResultPointer,
      0,
      maskPointer,
    );
    view = new DataView(exports.memory.buffer);
    assert.equal(
      view.getUint32(collisionResultPointer + scalarResultFlagsOffset, true) & scalarResultFlagObstacleHit,
      scalarResultFlagObstacleHit,
    );

    const failedAbsInput = writeAbsFirstOrderColdInput(exports, 0);
    exports.resetHarnessLaunchInitializationCount();
    exports.configureHarnessAbsLaunchInitialization(16, 1);
    assert.equal(
      exports.collectAbsFirstOrderSegmentStartsColdHarness(
        failedAbsInput.inputPointer,
        failedAbsInput.buildInputPointer,
        failedAbsInput.formulaPointXPointer,
        failedAbsInput.formulaPointYPointer,
        failedAbsInput.combinedProtectionPointer,
      ),
      2,
    );
    view = new DataView(exports.memory.buffer);
    assert.equal(view.getUint32(failedAbsInput.combinedProtectionPointer, true) & 16, 16);
    assert.equal(exports.getHarnessLaunchInitializationCount(), 1);

    const successfulPrefixAbsInput = writeAbsFirstOrderColdInput(exports, 0);
    exports.resetHarnessLaunchInitializationCount();
    exports.configureHarnessAbsLaunchInitialization(16, 0);
    assert.equal(
      exports.collectAbsFirstOrderSegmentStartsColdHarness(
        successfulPrefixAbsInput.inputPointer,
        successfulPrefixAbsInput.buildInputPointer,
        successfulPrefixAbsInput.formulaPointXPointer,
        successfulPrefixAbsInput.formulaPointYPointer,
        successfulPrefixAbsInput.combinedProtectionPointer,
      ),
      2,
    );
    view = new DataView(exports.memory.buffer);
    assert.equal(view.getUint32(successfulPrefixAbsInput.combinedProtectionPointer, true) & 16, 16);
    assert.equal(exports.getHarnessLaunchInitializationCount() > 1, true);

    exports.configureHarnessAbsLaunchInitialization(0, 0);
    const absInput = writeAbsFirstOrderColdInput(exports);
    assert.equal(
      exports.collectAbsFirstOrderSegmentStartsColdHarness(
        absInput.inputPointer,
        absInput.buildInputPointer,
        absInput.formulaPointXPointer,
        absInput.formulaPointYPointer,
        absInput.combinedProtectionPointer,
      ),
      1,
    );
    view = new DataView(exports.memory.buffer);
    const disabledPointer = view.getUint32(absInput.buildInputPointer + 120, true);
    const segmentStartXPointer = view.getUint32(absInput.buildInputPointer + 124, true);
    const segmentStartYPointer = view.getUint32(absInput.buildInputPointer + 128, true);
    assert.deepEqual(Array.from(new Uint8Array(exports.memory.buffer, disabledPointer, 2)), [0, 0]);
    const secondSegmentStartX = view.getFloat64(segmentStartXPointer + 8, true);
    const secondSegmentStartY = view.getFloat64(segmentStartYPointer + 8, true);
    assert.equal(secondSegmentStartX > 0.015 && secondSegmentStartX < 0.025, true);
    assert.equal(Number.isFinite(secondSegmentStartY), true);
    const absMaterialResultPointer = exports.runCurveBatch(absInput.buildInputPointer);
    view = new DataView(exports.memory.buffer);
    assert.equal(view.getUint32(absMaterialResultPointer + 8, true), 2);
    const absMaterialPointer = view.getUint32(absMaterialResultPointer + 4, true);
    assert.equal(view.getFloat64(absMaterialPointer + 40 + 8, true), Math.floor(secondSegmentStartX * 1e5) / 1e5);

    const stepInput = writeStepFirstOrderColdInput(exports);
    exports.resetHarnessLaunchInitializationCount();
    assert.equal(
      exports.refineStepFormulaColdHarness(
        stepInput.inputPointer,
        stepInput.buildInputPointer,
        stepInput.formulaPointXPointer,
        stepInput.formulaPointYPointer,
        stepInput.initialFormulaPointXPointer,
        stepInput.combinedProtectionPointer,
      ),
      1,
    );
    view = new DataView(exports.memory.buffer);
    const stepDisabledPointer = view.getUint32(stepInput.buildInputPointer + 120, true);
    const stepSegmentStartXPointer = view.getUint32(stepInput.buildInputPointer + 124, true);
    const stepSegmentStartYPointer = view.getUint32(stepInput.buildInputPointer + 128, true);
    const stepDeltaYPointer = view.getUint32(stepInput.buildInputPointer + 132, true);
    assert.deepEqual(Array.from(new Uint8Array(exports.memory.buffer, stepDisabledPointer, 2)), [0, 0]);
    assert.notEqual(view.getFloat64(stepInput.formulaPointXPointer + 8, true), 0.015);
    assert.equal(Number.isFinite(view.getFloat64(stepSegmentStartXPointer + 8, true)), true);
    assert.equal(Number.isFinite(view.getFloat64(stepSegmentStartYPointer + 8, true)), true);
    assert.equal(Number.isFinite(view.getFloat64(stepDeltaYPointer, true)), true);
    assert.equal(Number.isFinite(view.getFloat64(stepDeltaYPointer + 8, true)), true);
    assert.equal(exports.getHarnessLaunchInitializationCount(), 2);
    exports.resetArena(mark);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

function compareLandingQuality(
  exports,
  {
    bestDerivativeError = 2,
    bestPositionError = 2,
    bestTieBreaker = 2,
    candidateDerivativeError = 1,
    candidatePositionError = 1,
    candidateTieBreaker = 1,
    hasBest = true,
    hasTieBreaker = false,
  } = {},
) {
  return Boolean(
    exports.isStepSecondOrderLandingQualityBetter(
      candidateDerivativeError,
      candidatePositionError,
      bestDerivativeError,
      bestPositionError,
      candidateTieBreaker,
      bestTieBreaker,
      1,
      hasBest,
      hasTieBreaker,
    ),
  );
}

function assertSegmentBase(view, pointer, expected) {
  assert.equal(view.getInt32(pointer, true), expected.equation);
  assert.equal(view.getInt32(pointer + 4, true), expected.decimalPlaces);
  assert.equal(view.getFloat64(pointer + 8, true), expected.startX);
  assert.equal(view.getFloat64(pointer + 16, true), expected.endX);
  assert.equal(view.getFloat64(pointer + 24, true), expected.targetY);
}

function initializeGameConstants(exports) {
  exports.initializeArena(512);
  const mark = exports.markArena();
  const pointer = exports.reserveArena(constants.byteLength, Float64Array.BYTES_PER_ELEMENT);
  new Float64Array(exports.memory.buffer, pointer, constants.length).set(constants);
  assert.equal(
    exports.initializeGraphwarGameConstants(pointer, constants.length),
    calculateGameConstantAcknowledgment(new Uint8Array(constants.buffer)),
  );
  exports.resetArena(mark);
}

function writeScalarStepInput(exports, glitchPointer, protection = 11) {
  const pointXPointer = exports.reserveArena(16, 8);
  const pointYPointer = exports.reserveArena(16, 8);
  const protectionPointer = exports.reserveArena(4, 4);
  const inputPointer = exports.reserveArena(176, 8);
  new Float64Array(exports.memory.buffer, pointXPointer, 2).set([0, 1]);
  new Float64Array(exports.memory.buffer, pointYPointer, 2).set([0, 0]);
  new Uint32Array(exports.memory.buffer, protectionPointer, 1)[0] = protection;
  const view = new DataView(exports.memory.buffer);
  for (let offset = 0; offset < 176; offset += 4) {
    view.setUint32(inputPointer + offset, 0, true);
  }
  view.setInt32(inputPointer, 2, true);
  view.setInt32(inputPointer + 4, 2, true);
  view.setInt32(inputPointer + 8, 5, true);
  view.setUint32(inputPointer + 16, 2, true);
  view.setUint32(inputPointer + 20, pointXPointer, true);
  view.setUint32(inputPointer + 24, pointYPointer, true);
  view.setUint32(inputPointer + 28, protectionPointer, true);
  view.setUint32(inputPointer + 32, 1, true);
  view.setFloat64(inputPointer + 56, 10, true);
  view.setFloat64(inputPointer + 64, -1, true);
  view.setFloat64(inputPointer + 72, 2, true);
  view.setFloat64(inputPointer + 80, -1e9, true);
  view.setFloat64(inputPointer + 88, 1e9, true);
  view.setUint32(inputPointer + 136, glitchPointer, true);
  view.setFloat64(inputPointer + 152, 10, true);
  view.setFloat64(inputPointer + 168, 1, true);
  return inputPointer;
}

function writeAbsFirstOrderColdInput(exports, protection = 31) {
  const formulaPointXPointer = exports.reserveArena(24, 8);
  const formulaPointYPointer = exports.reserveArena(24, 8);
  const rawProtectionPointer = exports.reserveArena(8, 4);
  const activeProtectionPointer = exports.reserveArena(8, 4);
  const combinedProtectionPointer = exports.reserveArena(8, 4);
  const inputPointer = exports.reserveArena(176, 8);
  const buildInputPointer = exports.reserveArena(176, 8);
  new Float64Array(exports.memory.buffer, formulaPointXPointer, 3).set([0, 0.015, 0.03]);
  new Float64Array(exports.memory.buffer, formulaPointYPointer, 3).set([0, 1, 0]);
  new Uint32Array(exports.memory.buffer, rawProtectionPointer, 2).set([0, 0]);
  new Uint32Array(exports.memory.buffer, activeProtectionPointer, 2).fill(protection);
  new Uint32Array(exports.memory.buffer, combinedProtectionPointer, 2).fill(protection);
  const inputBytes = new Uint8Array(exports.memory.buffer, inputPointer, 176);
  inputBytes.fill(0);
  const view = new DataView(exports.memory.buffer);
  view.setInt32(inputPointer, 1, true);
  view.setInt32(inputPointer + 4, 2, true);
  view.setInt32(inputPointer + 8, 5, true);
  view.setUint32(inputPointer + 16, 3, true);
  view.setUint32(inputPointer + 20, formulaPointXPointer, true);
  view.setUint32(inputPointer + 24, formulaPointYPointer, true);
  view.setUint32(inputPointer + 28, rawProtectionPointer, true);
  view.setUint32(inputPointer + 32, 2, true);
  view.setFloat64(inputPointer + 56, 10, true);
  view.setFloat64(inputPointer + 64, -1, true);
  view.setFloat64(inputPointer + 72, 1, true);
  view.setFloat64(inputPointer + 80, -100, true);
  view.setFloat64(inputPointer + 88, 100, true);
  new Uint8Array(exports.memory.buffer, buildInputPointer, 176).set(inputBytes);
  view.setUint32(buildInputPointer + 28, activeProtectionPointer, true);
  return {
    buildInputPointer,
    combinedProtectionPointer,
    formulaPointXPointer,
    formulaPointYPointer,
    inputPointer,
  };
}

function writeStepFirstOrderColdInput(exports) {
  const formulaPointXPointer = exports.reserveArena(24, 8);
  const formulaPointYPointer = exports.reserveArena(24, 8);
  const initialFormulaPointXPointer = exports.reserveArena(24, 8);
  const rawProtectionPointer = exports.reserveArena(8, 4);
  const activeProtectionPointer = exports.reserveArena(8, 4);
  const combinedProtectionPointer = exports.reserveArena(8, 4);
  const rawOverflowRangePointer = exports.reserveArena(16, 8);
  const buildOverflowRangePointer = exports.reserveArena(16, 8);
  const inputPointer = exports.reserveArena(176, 8);
  const buildInputPointer = exports.reserveArena(176, 8);
  new Float64Array(exports.memory.buffer, formulaPointXPointer, 3).set([0, 0.015, 0.03]);
  new Float64Array(exports.memory.buffer, formulaPointYPointer, 3).set([0, 1, 0]);
  new Float64Array(exports.memory.buffer, initialFormulaPointXPointer, 3).set([0, 0.015, 0.03]);
  new Uint32Array(exports.memory.buffer, rawProtectionPointer, 2).set([0, 0]);
  new Uint32Array(exports.memory.buffer, activeProtectionPointer, 2).set([31, 31]);
  new Uint32Array(exports.memory.buffer, combinedProtectionPointer, 2).set([31, 31]);
  new Float64Array(exports.memory.buffer, rawOverflowRangePointer, 2).set([0, 1]);
  new Float64Array(exports.memory.buffer, buildOverflowRangePointer, 2).set([0, 1]);
  const inputBytes = new Uint8Array(exports.memory.buffer, inputPointer, 176);
  inputBytes.fill(0);
  const view = new DataView(exports.memory.buffer);
  view.setInt32(inputPointer, 2, true);
  view.setInt32(inputPointer + 4, 2, true);
  view.setInt32(inputPointer + 8, 5, true);
  view.setUint32(inputPointer + 16, 3, true);
  view.setUint32(inputPointer + 20, formulaPointXPointer, true);
  view.setUint32(inputPointer + 24, formulaPointYPointer, true);
  view.setUint32(inputPointer + 28, rawProtectionPointer, true);
  view.setUint32(inputPointer + 32, 2, true);
  view.setUint32(inputPointer + 52, rawOverflowRangePointer, true);
  view.setFloat64(inputPointer + 56, 10, true);
  view.setFloat64(inputPointer + 64, -1, true);
  view.setFloat64(inputPointer + 72, 1, true);
  view.setFloat64(inputPointer + 80, -100, true);
  view.setFloat64(inputPointer + 88, 100, true);
  view.setUint32(inputPointer + 148, 2, true);
  view.setFloat64(inputPointer + 168, 1, true);
  new Uint8Array(exports.memory.buffer, buildInputPointer, 176).set(inputBytes);
  view.setUint32(buildInputPointer + 28, activeProtectionPointer, true);
  view.setUint32(buildInputPointer + 52, buildOverflowRangePointer, true);
  return {
    buildInputPointer,
    combinedProtectionPointer,
    formulaPointXPointer,
    formulaPointYPointer,
    initialFormulaPointXPointer,
    inputPointer,
  };
}

function calculateGameConstantAcknowledgment(bytes) {
  let hash = 0x811c9dc5;
  for (const value of bytes) {
    hash = Math.imul(hash ^ value, 0x01000193) >>> 0;
  }
  return hash | 0;
}

function quantizeFormulaOffsetCenter(value, decimalPlaces) {
  return -Number((-value).toFixed(decimalPlaces));
}

async function compileHarness() {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "graphwar-step-refinement-test-"));
  const sourcePath = join(packageRoot, "test", `.formula-refinement-step-harness.${process.pid}.${Date.now()}.ts`);
  const outputPath = join(temporaryDirectory, "formula-refinement-step-harness.wasm");
  await writeFile(
    sourcePath,
    [
      'import { refineStepFormulaCold } from "../assembly/formula-refinement-step-cold";',
      'import { collectAbsFirstOrderSegmentStartsCold } from "../assembly/formula-refinement-abs-first-order-cold";',
      'import { FORMULA_RESULT_PROTECTION_POINTER_OFFSET } from "../assembly/formula-layout";',
      'import { initializeTrajectoryScalarState as initializeHarnessTrajectoryState } from "../assembly/trajectory-scalar";',
      "let launchInitializationCount: u32 = 0;",
      "let absLaunchProtectionRole: u32 = 0;",
      "let shouldFailAbsLaunchInitialization = false;",
      "function initializeHarnessLaunchState(",
      "  _materialResultPointer: u32, equation: i32, baseY: f64, _protectionPointer: u32, statePointer: u32, anglePointer: u32, forcedLaunchAngle: f64, _contextPointer: u32",
      "): bool {",
      "  launchInitializationCount += 1;",
      "  const angle = forcedLaunchAngle == forcedLaunchAngle ? forcedLaunchAngle : 0;",
      "  if (anglePointer != 0) store<f64>(anglePointer, angle);",
      "  initializeHarnessTrajectoryState(statePointer, equation, 0, baseY, 0, 0, 0, 0, 0, false);",
      "  return true;",
      "}",
      "function initializeHarnessAbsLaunchState(",
      "  materialResultPointer: u32, equation: i32, baseY: f64, protectionPointer: u32, statePointer: u32, contextPointer: u32",
      "): bool {",
      "  if (launchInitializationCount == 0 && absLaunchProtectionRole != 0) {",
      "    const observedPointer = load<u32>(materialResultPointer + FORMULA_RESULT_PROTECTION_POINTER_OFFSET);",
      "    store<u32>(observedPointer, load<u32>(observedPointer) | absLaunchProtectionRole);",
      "    if (shouldFailAbsLaunchInitialization) { launchInitializationCount += 1; return false; }",
      "  }",
      "  return initializeHarnessLaunchState(",
      "    materialResultPointer, equation, baseY, protectionPointer, statePointer, 0, f64.NaN, contextPointer",
      "  );",
      "}",
      "export function configureHarnessAbsLaunchInitialization(role: u32, shouldFail: bool): void {",
      "  absLaunchProtectionRole = role; shouldFailAbsLaunchInitialization = shouldFail;",
      "}",
      "export function resetHarnessLaunchInitializationCount(): void { launchInitializationCount = 0; }",
      "export function getHarnessLaunchInitializationCount(): u32 { return launchInitializationCount; }",
      "export function collectAbsFirstOrderSegmentStartsColdHarness(",
      "  inputPointer: u32, buildInputPointer: u32, formulaPointXPointer: u32, formulaPointYPointer: u32,",
      "  combinedProtectionPointer: u32",
      "): i32 {",
      "  return collectAbsFirstOrderSegmentStartsCold(",
      "    inputPointer, buildInputPointer, formulaPointXPointer, formulaPointYPointer, combinedProtectionPointer,",
      "    0, initializeHarnessAbsLaunchState",
      "  );",
      "}",
      "export function refineStepFormulaColdHarness(",
      "  inputPointer: u32, buildInputPointer: u32, formulaPointXPointer: u32, formulaPointYPointer: u32,",
      "  initialFormulaPointXPointer: u32, combinedProtectionPointer: u32",
      "): i32 {",
      "  return refineStepFormulaCold(",
      "    inputPointer, buildInputPointer, formulaPointXPointer, formulaPointYPointer, initialFormulaPointXPointer,",
      "    combinedProtectionPointer, 0, 0, initializeHarnessLaunchState",
      "  );",
      "}",
      'export { initializeGraphwarGameConstants } from "../assembly/game-constants";',
      'export { initializeArena, markArena, reserveArena, resetArena } from "../assembly/memory";',
      'export { runCurveBatch } from "../assembly/formula-curves";',
      'export { runStepBatch } from "../assembly/formula-step";',
      "export {",
      "  initializeTrajectoryScalarState,",
      "  replayFormulaTrajectoryScalarToStopX,",
      "  replayFormulaTrajectoryScalarToStopXWithMask,",
      "  replayFormulaTrajectoryScalarToStopXWithMaskAndJumpWindow,",
      '} from "../assembly/trajectory-scalar";',
      "export {",
      "  createStepFirstOrderGlitchSegment,",
      "  createStepGlitchFormulaGateY,",
      "  createStepGlitchJump,",
      "  createStepSecondOrderGlitchSegmentCandidate,",
      "  createStepSegmentRefinementStopX,",
      "  getStepGlitchInitialWindowDecimalPlaces,",
      "  getStepGlitchRk4ContributionFactor,",
      "  isStepSecondOrderLandingQualityBetter,",
      "  stepGlitchObstacleEnvelopeHitsObstacle,",
      '} from "../assembly/formula-refinement-step";',
    ].join("\n"),
    "utf8",
  );
  try {
    await execFileAsync(
      process.execPath,
      [compilerPath, sourcePath, "--runtime", "stub", "--optimize", "--outFile", outputPath],
      { cwd: packageRoot },
    );
    return { bytes: await readFile(outputPath), temporaryDirectory };
  } finally {
    await rm(sourcePath, { force: true });
  }
}
