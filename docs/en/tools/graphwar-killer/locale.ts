import type { GraphwarKillerLocale } from "../../../tools/graphwar-killer/locale-types";

export const graphwarKillerLocale = {
  equationModes: [
    {
      value: "y",
      label: "y",
      formulaPrefix: "y=",
      description: "Output a function",
      title: "Generate or simulate a function in y mode",
    },
    {
      value: "dy",
      label: "y'",
      formulaPrefix: "y'=",
      description: "Output a function's first derivative",
      title: "Generate or simulate a first derivative in y' mode",
    },
    {
      value: "ddy",
      label: "y''",
      formulaPrefix: "y''=",
      description: "Output a function's second derivative",
      title: "Generate or simulate a second derivative in y'' mode; some algorithms are unavailable",
    },
  ],
  toolWorkflowModes: [
    {
      value: "solver",
      label: "Generate function",
      title: "Generate a Graphwar function from the screenshot and path points",
    },
    {
      value: "simulator",
      label: "Simulate trajectory",
      title: "Preview a Graphwar function on the screenshot",
    },
  ],
  algorithmModes: [
    {
      value: "abs",
      label: "Double absolute value",
      title: "Connect path points with shorter expressions for y and y'",
    },
    {
      value: "step",
      label: "Step function",
      title: "Connect path points with adjustable steepness; expressions are usually longer",
    },
    {
      value: "pchip",
      label: "PCHIP interpolation",
      title: "Create a smooth path that closely follows the selected points",
    },
    {
      value: "akima",
      label: "Akima interpolation",
      title: "Create a smooth path that is stable around local outliers",
    },
  ],
  validation: {
    boundsInvalidNumber: "Bounds coordinates must be valid numbers",
    decimalPlacesInteger: "Decimal places must be an integer",
    decimalPlacesRange: (max) => `Decimal places must be between 0 and ${max}`,
    maxXGreaterThanMinX: "-x must be less than +x",
    maxYGreaterThanMinY: "-y must be less than +y",
    magnifierZoomNumber: "Magnifier zoom must be a number",
    magnifierZoomRange: (min, max) => `Magnifier zoom must be between ${min}x and ${max}x`,
    maximumSoldierCountInteger: "Soldier limit must be an integer",
    maximumSoldierCountPositive: "Soldier limit must be greater than 0",
    obstacleBrushDiameterInteger: "Brush size must be an integer",
    obstacleBrushDiameterRange: (min, max) => `Brush size must be between ${min}px and ${max}px`,
    obstacleMinAreaInteger: "Minimum obstacle area must be an integer",
    obstacleMinAreaRange: (max) => `Minimum obstacle area must be between 0 and ${max}`,
    oneClickClearDeleteCheckRadiusNumber: "One-Click Clear point removal check radius must be a number",
    oneClickClearDeleteCheckRadiusRange: (min) =>
      `One-Click Clear point removal check radius must be at least ${min}px`,
    pathfindingWorkerCountInteger: "Pathfinding worker count must be an integer",
    pathfindingWorkerCountRange: "Pathfinding worker count must be between 1 and 128",
    routePlanningToleranceNumber: "Route planning tolerance must be a number",
    routePlanningTolerancePixelRange: (limit) => `Route planning tolerance must be between -${limit}px and ${limit}px`,
    simulationToleranceNumber: "Simulation tolerance must be a number",
    simulationTolerancePixelRange: (limit) => `Simulation tolerance must be between -${limit}px and ${limit}px`,
    soldierTemplateCandidateTopRatioNumber: "Candidate trim must be a number",
    soldierTemplateCandidateTopRatioRange: "Candidate trim must be greater than 0 and no greater than 1",
    templateMatchingWorkerCountInteger: "Template matching workers must be an integer",
    templateMatchingWorkerCountRange: "Template matching workers must be between 1 and 128",
    stepSteepnessNumber: "Step steepness must be a number greater than 0",
  },
  status: {
    activeEquation: {
      abs: "Output the double absolute-value connector function",
      absDerivative: "Output the first derivative of the double absolute-value connector function",
      akima: "Output the soft-piecewise expression for Akima cubic interpolation",
      akimaFirstDerivative: "Output the exact first derivative of the Akima soft-piecewise expression",
      akimaSecondDerivative: "Output the exact second derivative of the Akima soft-piecewise expression",
      pchip: "Output the soft-piecewise expression for PCHIP monotone cubic interpolation",
      pchipFirstDerivative: "Output the exact first derivative of the PCHIP soft-piecewise expression",
      pchipSecondDerivative: "Output the exact second derivative of the PCHIP soft-piecewise expression",
      simulator: "Enter a function and simulate its Graphwar trajectory for the current game mode",
    },
    activeToolHint: {
      bounds: "Left-click two corners to set bounds; right-click to cancel the selected point.",
      obstacle: "Hold left-click to draw or erase current obstacles; hover to preview the brush footprint.",
      simulatorPath: "Left-click the initial firing soldier; click another soldier to replace it.",
      solverPath:
        "Left-click your soldier's center first, then path-point centers. Drag path points to fine-tune them, right-click a point to delete it, or right-click empty space to undo the latest point.",
    },
    liveClickPreview: {
      inProgress: "Calculating live preview...",
      rendered: (elapsed) => `Rendered live preview in ${elapsed}`,
    },
    calculation: {
      enterFunction: "Enter a function",
      enterLaunchAngle: "Enter a launch angle",
      fallbackWarning: "⚠ fallback",
      fallbackWarningTitle: (message) =>
        `Main trajectory Worker is unavailable; fell back to solving and simulation on the main thread: ${message}`,
      inProgress: "Solving the function and simulating the trajectory...",
      selectInitialSoldier: "Select the initial firing soldier first",
      selectPath: "Click your position first, then select at least one path point",
      simulateFailed: "Failed to simulate the trajectory",
      solveFailed: "Failed to solve the function",
      success: (elapsed) => `Solved the function and simulated the trajectory in ${elapsed}`,
    },
    copy: {
      buttonDefault: "Copy function",
      buttonError: "Copy failed",
      buttonSuccess: "Copied",
      error: "Copy failed. Please copy it manually.",
      success: "Function copied to the clipboard.",
    },
    detection: {
      cancelled: "Detection cancelled",
      detectingBounds: "Detecting coordinate-system bounds",
      detectingObjects: "Detecting soldiers and obstacles",
      detectedBounds: (elapsed) => `Marked bounds in ${elapsed}`,
      detectedCurrentBounds: (soldiers, elapsed) => `Marked obstacles and ${soldiers} soldiers in ${elapsed}`,
      detectedWithAutoBounds: (soldiers, elapsed) => `Marked bounds, obstacles, and ${soldiers} soldiers in ${elapsed}`,
      failed: (message) => `Detection failed: ${message}`,
      obstacleEditsApplied: (obstacles) => `Updated obstacle boundaries; currently ${obstacles} obstacles`,
      obstacleEditsCleared: (obstacles) => `Cleared obstacle edits; restored ${obstacles} obstacles`,
      updatingObstacleEdits: "Applying obstacle edits",
      needBounds: "Detect or pick the Graphwar coordinate-system bounds first",
      noBounds: "Could not detect the Graphwar coordinate-system bounds",
      noPixels: "Could not read screenshot pixels",
      partialWarning: "⚠ partial issue",
      preparingPixels: "Reading screenshot pixels",
      stopSuffix: ", right-click the screenshot to cancel...",
      updatingResults: "Updating detection results",
      uploadFirst: "Upload or paste a screenshot first",
      warningTitle: (warning) =>
        warning.code === "template-matching-worker-fallback"
          ? `Parallel matching failed; fell back to serial: ${warning.message}`
          : warning.message,
    },
    image: {
      defaultStatus: "Capture, upload, drag in, or press Ctrl/Cmd+V to paste a screenshot",
      pastedName: "Pasted screenshot",
      screenCaptureIncomplete: "Screen capture was not completed",
      screenCaptureName: "Screenshot",
      screenCaptureUnavailable: "Screen capture is not available in this environment.",
      screenCaptureUnsupported: "This browser does not support the Screen Capture API.",
    },
    agent: {
      defaultStatus: "Click Read State to load the current game state from Graphwar Agent",
      failed: (message) => `Failed to read state: ${message}`,
      failureReason: (kind, message) => {
        switch (message) {
          case "game-data-not-initialized":
            return "Graphwar game data has not initialized";
          case "game-not-active":
            return "No game is currently active";
          case "game-not-started":
            return "Game has not started";
          case "not-in-pre-game-room":
            return "Not currently in a game room";
          case "state-file-invalid-json":
            return "The state file is not valid JSON";
        }
        switch (kind) {
          case "conflict":
            return "Graphwar state changed; try again";
          case "incompatible":
            return "The Graphwar Agent version or response is incompatible; upgrade the Agent";
          case "invalid-request":
            return "The request sent to Graphwar Agent is invalid";
          case "transient":
            return "The network or Graphwar Agent is temporarily unavailable";
          case "unavailable":
            return `Agent returned an unknown state: ${message}`;
          default:
            return message;
        }
      },
      fileFailed: (message) => `Failed to read debug file: ${message}`,
      fileIncompatible: "The state and obstacle files do not match or use an unsupported format",
      exportFailed: (message) => `Failed to export scene: ${message}`,
      exported: "Current scene exported",
      exporting: "Exporting scene",
      fireFailed: (message) => `Failed to fire: ${message}`,
      fired: "Function submitted and fired.",
      loaded: (soldiers) => `Read current state: obstacles and ${soldiers} ${soldiers === 1 ? "soldier" : "soldiers"}`,
      obstacleFileLoaded: "Obstacle file loaded; select a state file",
      readFirst: "Read Agent state first",
      reading: "Reading state",
      readingFile: "Reading file",
      stateFileLoaded: "State file loaded; select an obstacle file",
    },
    pathPointCoordinateNumber: "Point coordinates must be numbers",
    secondOrderAngleHint: (angle) => `Use the Up/Down keys to set the launch angle to about ${angle} deg.`,
    trajectoryWarning: {
      obstacle: "The current function trajectory hits an obstacle or boundary",
      stopped: {
        invalid: "Preview stopped: the function produced NaN or infinity. In game, it will explode early.",
        "max-steps":
          "Preview stopped: Graphwar's maximum sample count was reached, so the function is too long. In game, it will explode near the end.",
        "out-of-bounds":
          "Preview stopped: the trajectory leaves the Graphwar plane. In game, it will explode early at the boundary.",
        "too-steep":
          "Preview stopped: the local curve is too steep, and Graphwar cannot continue even at its minimum step size. In game, it will explode here.",
      },
    },
  },
  smartPathfinding: {
    cancelled: "Pathfinding canceled",
    currentPathBlocked: "The simulation did not reach the current last path point, so pathfinding cannot start",
    failure: (elapsed) =>
      elapsed === undefined
        ? "Path Planning failed: no valid path found"
        : `Path Planning failed: no valid path found after ${elapsed}`,
    forwardMinimumDouble: "the next representable double-precision floating-point value",
    forwardPath: (minimumStep) =>
      `Each point's Graphwar x must be strictly greater than the previous point, moving at least to ${minimumStep}`,
    needBounds: "Detect or pick coordinate-system bounds before using Path Planning",
    needDetection: "Detect soldiers and obstacles before using Path Planning",
    inProgress: {
      optimize: "Optimize path nodes",
      search: "Search obstacle route",
      stopSuffix: ", right-click the screenshot to stop",
      trajectory: "Validate function trajectory",
    },
    success: (elapsed, resultCacheHit) => {
      const cacheText = resultCacheHit ? " (using result cache)" : "";
      return elapsed === undefined
        ? `Path Planning completed${cacheText}`
        : `Path Planning completed${cacheText} in ${elapsed}`;
    },
    oneClickClear: {
      inProgress: "Running One-Click Clear; right-click the screenshot to stop",
      needDetection: "Detect soldiers and obstacles before using One-Click Clear",
      needCurrentPath: "One-Click Clear needs an existing path start first",
      noCandidate: "One-Click Clear failed: no selectable target exists on the x+ side of the current path",
      noUsableTarget: (elapsed) => `One-Click Clear failed: no usable target found after ${elapsed}`,
      pathfindingWorkerFailed: (elapsed) =>
        `One-Click Clear failed: the pathfinding Worker is unavailable or failed after ${elapsed}`,
      retained: "Kept the best result found so far",
      success: (killCount, elapsed, resultCacheHit) => {
        const cacheText = resultCacheHit ? " (using result cache)" : "";
        return `One-Click Clear completed${cacheText}, the full trajectory killed ${killCount} ${killCount === 1 ? "soldier" : "soldiers"} in ${elapsed}`;
      },
      unsupported: "One-Click Clear supports double absolute-value y and y', or Step y, y', and y''",
    },
    managed: {
      backgroundWarning: "The page is in the background; managed firing may be delayed",
      calculationComplete: (targetCount, elapsed) =>
        `Managed calculation completed in ${elapsed}; the best plan hits ${targetCount} ${targetCount === 1 ? "target" : "targets"}`,
      calculating: () => "Managed mode is calculating",
      completedWaiting: "Managed calculation complete; waiting for a local turn",
      connectionFailed: (message) => `Agent connection failed; retrying: ${message}`,
      deadlineFired: "Stopped with 3 seconds remaining and fired the current best plan",
      deadlineNoPlan: "Stopped with 3 seconds remaining but could not submit the skip-turn function",
      deadlinePlan: (elapsed) =>
        `Managed calculation stopped with 3 seconds remaining and kept the best plan after ${elapsed}`,
      enabled: "Managed mode enabled; reading game state",
      incompatible: "Managed mode stopped because the Agent API is incompatible; upgrade the Agent",
      readying: "A local player is not ready; marking them ready",
      searchFailed: "Managed calculation failed and could not skip this turn",
      skippingTurn: "No usable plan; skipping this turn",
      skipTurnFired: "No usable plan; skipped this turn",
      shotUnknown: (message) => `Shot result is unknown and will not be retried this turn: ${message}`,
      stopped: "Managed mode stopped",
      successFired: "Managed calculation complete; fired the best plan",
      waitingForGame: "Managed mode enabled; waiting for a room or match",
      waitingForTurn: "Waiting for a local turn",
    },
  },
  ui: {
    actions: {
      collisionCheck: "Collision check",
      collisionCheckTitle: "Check manual and simulated trajectories for collisions; pathfinding always checks them",
      clearPath: "Clear path",
      clearPathTitle: "Clear all path points",
      clearObstacleEdits: "Clear obstacle edits",
      clearObstacleEditsTitle: "Restore the original loaded obstacles",
      drawObstacle: "Draw obstacle",
      drawObstacleTitle: "Correct the loaded obstacles with a circular brush",
      eraseObstacle: "Erase mode",
      eraseObstacleTitle: "Erase areas from the loaded obstacles",
      magnifier: "Magnifier",
      magnifierTitle: "Magnify the area around the pointer for precise selections",
      magnifierZoom: "Zoom",
      magnifierZoomAriaLabel: "Magnifier zoom",
      magnifierZoomTitle: "Set magnification; slider range 1x to 5x, input range 1x to 100x",
      obstacleBrushDiameter: "Brush size",
      obstacleBrushDiameterAriaLabel: "Obstacle brush diameter in raw Graphwar 770x450 plane pixels",
      obstacleBrushDiameterTitle:
        "Set the circular brush diameter; slider range 1px to 200px, input range 1px to 1000px",
      liveClickPreview: "Live preview",
      liveClickPreviewTitle: "Preview the path point and route created by clicking here",
      pickBounds: "Pick bounds",
      pickBoundsTitle: "Select two coordinate-system corners to calibrate the screenshot",
      pickPath: "Pick path",
      pickPathTitle: "Select your soldier first, then path points or target soldiers",
      pathPlanning: "Path planning",
      pathPlanningTitle: "Find a route around obstacles after selecting a target",
      snapSoldiers: "Snap soldiers",
      snapSoldiersTitle: "Snap selections to detected soldiers and use their actual hit circles",
      title: "Controls",
      toolModeAriaLabel: "Tool mode",
      toolModeTitle: "Choose the bounds, path, or obstacle editing tool",
      undoPoint: "Undo point",
      undoPointTitle: "Undo the most recently added path point",
    },
    detection: {
      agent: {
        address: "Agent URL",
        addressAriaLabel: "Graphwar Agent URL",
        addressTitle: "Local Graphwar Agent URL; default http://127.0.0.1:17900",
        exportScene: "Export scene",
        exportSceneTitle: "Download the current Graphwar Agent state and obstacle files for debug import",
        exportingScene: "Exporting",
        helpLink: "How to use Graphwar Agent",
        readObstacleFile: "Read obstacle file",
        readObstacleFileTitle: "Read a saved Graphwar Agent obstacle binary file",
        read: "Read state",
        reading: "Reading",
        readStateFile: "Read state file",
        readStateFileTitle: "Read a saved Graphwar Agent state JSON file",
        readTitle: "Read the current game state from Graphwar Agent",
        settingsSummary: "Agent settings",
        toggle: "Use Agent",
        toggleTitle: "Read game state through Graphwar Agent",
      },
      autoDetection: "Auto detect",
      autoDetectionTitle: "Detect bounds, soldiers, and obstacles when a screenshot loads",
      busyOverlay: "Detecting, right-click to cancel",
      debugNoTiming: "No detection timing recorded yet",
      debugDetails: {
        "template-matching-dispatch": {
          label: "- Dispatch template tasks",
          title: "Split candidates, copy screenshot pixels, and send template matching tasks to child Workers.",
        },
        "template-matching-fallback-serial": {
          label: "- Fallback serial template scoring",
          title: "After parallel template matching fails, rescore all candidates serially inside the detection Worker.",
        },
        "template-matching-merge": {
          label: "- Merge template results",
          title: "Merge template scoring results, sort globally, apply thresholds, and suppress overlapping matches.",
        },
        "template-matching-mode": {
          label: (mode, workerCount) =>
            mode === "parallel"
              ? `- Template matching mode: parallel, ${workerCount} ${workerCount === 1 ? "worker" : "workers"}`
              : mode === "parallel-fallback"
                ? `- Template matching mode: parallel-to-serial fallback, ${workerCount} ${workerCount === 1 ? "worker" : "workers"} -> 1 worker`
                : "- Template matching mode: serial, 1 worker",
          title: "The scheduling mode actually used by this soldier template matching run.",
        },
        "template-matching-serial": {
          label: "- Serial template scoring",
          title: "Score all soldier candidates serially inside the detection Worker.",
        },
        "template-matching-worker": {
          label: (workerIndex) => `- Worker ${workerIndex} template scoring`,
          title: "Scoring time for one template matching child Worker's candidate slice.",
        },
      },
      debugStages: {
        "building-obstacle-mask": {
          label: "Build obstacle mask",
          title:
            "Resample the screenshot into Graphwar's raw 770x450 plane and detect dark terrain bodies plus antialiasing edges.",
        },
        "collecting-soldier-candidates": {
          label: "Collect soldier candidates",
          title: "Scan soldier yellow/white seed pixels and reverse-vote possible source centers for soldiers.",
        },
        "detecting-bounds": {
          label: "Detect coordinate-system bounds",
          title:
            "Find the Graphwar coordinate-system bounds in the screenshot pixels; only appears during automatic bounds detection.",
        },
        "detecting-objects": {
          label: "Detect soldiers and obstacles",
          title: "Detect soldiers, obstacle regions, and hit circles inside the resolved coordinate-system bounds.",
        },
        "filtering-obstacle-components": {
          label: "Filter obstacle components",
          title:
            "Remove axes, boundary guide lines, soldier areas, and small noise, then restore accepted real obstacle components.",
        },
        "matching-soldier-templates": {
          label: "Match soldier templates",
          title:
            "Score candidate centers against Graphwar soldier animation templates and mirrored templates, then suppress overlapping matches.",
        },
        "outside-stages": {
          label: "Outside recorded stages",
          title:
            "Total wall-clock time minus recorded stages; includes status paint waits, Worker message transfer, async scheduling, and glue code that is not measured separately.",
        },
        "preparing-pixels": {
          label: "Read screenshot pixels",
          title: "Read ImageData from the current screenshot canvas and prepare it for the detection flow.",
        },
        "setting-status": {
          label: "Set status text",
          title: "Build the detection completion or failure message and write it to the detection header status.",
        },
        total: {
          label: "Flow total",
          title: "Wall-clock time from the start of this detection run until the final status is applied.",
        },
        "updating-results": {
          label: "Update detection results",
          title:
            "Write detected soldiers, obstacles, and coordinate-system bounds back to page state, then refresh related cache and highlights.",
        },
      },
      debugSummary: "Debug info",
      minObstacleArea: "Minimum obstacle area",
      minObstacleAreaAriaLabel: "Minimum obstacle area in raw Graphwar plane pixels",
      minObstacleAreaTitle: "Ignore obstacle noise smaller than this area",
      detectBounds: "Detect bounds",
      detectBoundsTitle: "Detect the coordinate-system bounds in the current screenshot",
      detectObjects: "Detect soldiers/obstacles",
      detectObjectsNeedBoundsTitle: "Detect or select the coordinate-system bounds first",
      detectObjectsTitle: "Detect soldiers and obstacles inside the current bounds",
      title: "Data source",
    },
    pathfinding: {
      allowFriendlyFire: "Allow friendly fire",
      allowFriendlyFireTitle: "Allow Path Planning and One-Click Clear to pass through allied soldiers",
      capabilityReasons: {
        "agent-disabled": "Turn on Use Agent first",
        "agent-fire-busy": "Agent is submitting a shot.",
        "agent-read-busy": "Agent state is being read.",
        "agent-scene-required": "Read the current Agent state first.",
        "agent-url-invalid": "Enter a valid Agent URL.",
        "bounds-required": "Detect or pick coordinate bounds first.",
        "delete-check-radius-invalid": "Fix the point removal check radius.",
        "formula-settings-invalid": "Fix the formula settings first.",
        "formula-unsupported": "The current formula profile does not support One-Click Clear.",
        "image-required": "Load a screenshot first.",
        "managed-lock": "Managed mode owns this setting.",
        "obstacle-tolerances-invalid": "Fix the obstacle tolerances.",
        "obstacles-required": "Detect or read obstacles first.",
        "path-start-required": "Select the firing soldier first.",
        "pathfinding-busy": "Wait for the current pathfinding task.",
        "pathfinding-worker-count-invalid": "Fix the pathfinding Worker count.",
        "soldiers-required": "Detect or read soldiers first.",
        "solver-required": "Switch to Solver to use this setting.",
      },
      debugNoTiming: "No pathfinding timing recorded yet",
      debugDetails: {
        "build-dag-edges": {
          label: "- Build clear DAG edges",
          title:
            "Try x+ geometry routes between soldier centers with the current clear route mask, then record usable edges.",
        },
        "dag-edge-mode": {
          label: (mode, workerCount) =>
            mode === "parallel"
              ? `- Clear DAG edge mode: parallel, ${workerCount} ${workerCount === 1 ? "worker" : "workers"}`
              : mode === "parallel-fallback"
                ? `- Clear DAG edge mode: parallel-to-serial fallback, ${workerCount} ${workerCount === 1 ? "worker" : "workers"} -> 1 worker`
                : "- Clear DAG edge mode: serial, 1 worker",
          title: "The scheduling mode actually used by this One-Click Clear DAG edge build.",
        },
        "dag-edge-worker": {
          label: (workerIndex) => `- Clear DAG edge Worker ${workerIndex}`,
          title:
            "Total time for one DAG edge child Worker; jobs are claimed dynamically, so this is not a fixed edge slice.",
        },
        "build-dag-targets": {
          label: "- Collect clear targets",
          title:
            "Ordinary modes build DAG targets sorted by center x; Glitch Mode allocates strictly increasing hit-circle control points to equal-x soldiers.",
        },
        "dag-longest-path": {
          label: "- Run clear DAG longest path",
          title: "Run longest-path DP on the built center-point DAG and choose the route with the most explicit hits.",
        },
        "optimize-path": {
          label: "- Optimize clear path",
          title:
            "Conservatively delete points from the validated clear path and verify each deletion still hits every new and committed target.",
        },
        "prefix-evidence-hit": {
          label: "- Clear prefix evidence hit",
          title:
            "The fixed path exactly matches the last successful full formula, so its real recovery point is reused.",
        },
        "prefix-evidence-miss": {
          label: "- Clear prefix evidence miss",
          title:
            "No final-formula evidence matches this fixed path, so the prefix must be prepared after direct validation fails.",
        },
        "prepare-pathfinding-prefix": {
          label: "- Prepare clear prefix",
          title:
            "Replay the fixed path once to verify old targets and its tail, then obtain the real Glitch Mode recovery point.",
        },
        "remove-failed-edge": {
          label: "- Remove failed clear edge",
          title:
            "When function validation rejects a DAG edge, mark that edge inactive before running longest-path DP again.",
        },
        "route-mask-cache-hit": {
          label: "- Clear route mask cache hit",
          title: "The Worker reused the clear route mask for the current obstacle mask and route tolerance.",
        },
        "route-mask-cache-miss": {
          label: "- Clear route mask cache miss",
          title: "The Worker rebuilt the clear route mask for the current obstacle mask and route tolerance.",
        },
        "route-map-pixels": {
          label: "- Map clear route pixels",
          title:
            "Convert Graphwar plane grid cells returned by geometry pathfinding into screenshot pixel path points while preserving exact center endpoints.",
        },
        "route-pathfinding": {
          label: "- Run clear geometry search",
          title: "Search for an obstacle-avoiding geometry route between two center points that satisfies x+ rules.",
        },
        "scan-step-glitch": {
          label: "- Scan Step glitch routes",
          title:
            "Scan free horizontal rows in increasing target x order and validate each vertical tunneling candidate by replaying the final formula.",
        },
        "segment-build-formula": {
          label: "- Build clear segment formula",
          title:
            "Convert the full current path, including the validated prefix and new edge, into a Graphwar formula sampling context.",
        },
        "segment-graph-rule": {
          label: "- Check clear segment x+",
          title:
            "Check whether adjacent points in the candidate segment have strictly increasing Graphwar x; equal x is not allowed.",
        },
        "segment-sample-trajectory": {
          label: "- Sample clear segment trajectory",
          title:
            "Re-sample the current full path and confirm the current new target and every historical target are hit before obstacles.",
        },
        "validate-route": {
          label: "- Validate clear DAG route",
          title:
            "Append the DAG edges selected by longest-path DP one by one, validate each target hit circle, and return the exact failed edge when one fails.",
        },
        "validate-final": {
          label: "- Validate final clear",
          title:
            "Resample the optimized full clear path and confirm it still hits every selected new target and every committed target.",
        },
        "validate-direct-trajectory": {
          label: "- Validate direct clear trajectory",
          title:
            "Replay the final formula with the target appended directly; success skips prefix preparation and route scanning.",
        },
        "visibility-cache-hit": {
          label: "- Clear visibility cache hit",
          title:
            "Before building clear DAG edges, reuse obstacle contour data for the current route mask, direction, and route tolerance.",
        },
        "visibility-cache-miss": {
          label: "- Clear visibility cache miss",
          title:
            "Before building clear DAG edges, no reusable obstacle contour data exists, so it is built once and reused by all edges in this DAG.",
        },
        "visibility-cache-skipped": {
          label: "- Clear visibility cache unused",
          title: "This One-Click Clear run did not enter DAG edge building, so the visibility cache was not accessed.",
        },
        "validate-prefix": {
          label: "- Validate clear prefix",
          title: "Validate the existing path reaches its last point before appending a clear route.",
        },
      },
      debugStages: {
        "apply-result": {
          label: "Apply path result",
          title: "Write the final planned path to the current path state and clear stale path errors.",
        },
        "collect-targets": {
          label: "Create target",
          title:
            "When a soldier is clicked, use its center first; if that fails the x+ rule, move the geometry target to the minimum x+ point inside the hit circle while trajectory validation still uses the original hit circle.",
        },
        "prefix-evidence-hit": {
          label: "Prefix evidence hit",
          title:
            "The old path, target sequence, formula settings, and simulation environment exactly match the latest successful formula, so its recovery point is reused.",
        },
        "prefix-evidence-miss": {
          label: "Prefix evidence miss",
          title:
            "No exact old-formula evidence is available; after direct validation fails, the old path must be replayed once.",
        },
        "prepare-pathfinding-prefix": {
          label: "Prepare pathfinding prefix",
          title:
            "Replay the old full formula to verify committed targets and the current tail, then obtain the Glitch Mode scanner recovery point.",
        },
        "result-cache-hit": {
          label: "Result cache hit",
          title:
            "The current path, target, obstacle mask, tolerances, and formula settings match a cached Path Planning result, so the full result is reused.",
        },
        "result-cache-miss": {
          label: "Result cache miss",
          title:
            "No full Path Planning result can be reused for the current input, so the pathfinding Worker must search and validate again.",
        },
        "route-mask-cache-hit": {
          label: "Route mask cache hit",
          title: "The dilated or eroded route mask already exists for the current obstacle mask and route tolerance.",
        },
        "route-mask-cache-miss": {
          label: "Route mask cache miss",
          title: "No reusable route mask exists for the current obstacle mask or route tolerance, so it is rebuilt.",
        },
        "visibility-cache-hit": {
          label: "Visibility cache hit",
          title:
            "Obstacle-route search needed a visibility graph and reused obstacle contour data for the current route mask, direction, and route tolerance.",
        },
        "visibility-cache-miss": {
          label: "Visibility cache miss",
          title:
            "Obstacle-route search needed a visibility graph, but no reusable obstacle contour data exists for the current route mask, direction, or route tolerance.",
        },
        "visibility-cache-skipped": {
          label: "Visibility cache unused",
          title:
            "This Path Planning run used Theta*, used a direct route, or failed before obstacle-route search, so no visibility graph was needed.",
        },
        "optimize-path": {
          label: "Optimize path nodes",
          title:
            "Try removing intermediate geometry-route points one by one, validating each shorter path with the function trajectory.",
        },
        "one-click-clear-apply-result": {
          label: "Apply clear path",
          title:
            "Write the best path found by One-Click Clear to the current path state; keep the original path when no new kill is found.",
        },
        "one-click-clear-collect-targets": {
          label: "Collect clear targets",
          title:
            "Filter selectable soldier-center candidates for One-Click Clear using the current friendly-fire setting and strict x+ rule.",
        },
        "one-click-clear-result-cache-hit": {
          label: "Clear result cache hit",
          title:
            "The current path, candidate targets, obstacle mask, tolerances, and formula settings match a cached One-Click Clear result, so the full result is reused.",
        },
        "one-click-clear-result-cache-miss": {
          label: "Clear result cache miss",
          title:
            "No full One-Click Clear result can be reused for the current input, so the pathfinding Worker must search and validate again.",
        },
        "one-click-clear-preflight": {
          label: "Preflight clear run",
          title:
            "Check One-Click Clear settings, current mode, current path, and obstacle mask, then prepare the prefix hit target.",
        },
        "one-click-clear-route-mask-cache-hit": {
          label: "Clear route mask cache hit",
          title: "The route mask for One-Click Clear already exists for the current obstacle mask and route tolerance.",
        },
        "one-click-clear-route-mask-cache-miss": {
          label: "Clear route mask cache miss",
          title:
            "No route mask for One-Click Clear exists for the current obstacle mask or route tolerance, so it is rebuilt.",
        },
        "one-click-clear-search": {
          label: "Search and validate clear",
          title:
            "Build the center-point DAG, run longest-path DP, delete failed DAG edges during validation, and stop with a usable clear route or no active route.",
        },
        "one-click-clear-setting-status": {
          label: "Set clear status",
          title:
            "Build the One-Click Clear success, failure, or unavailable reason and write it to the pathfinding header status.",
        },
        "outside-stages": {
          label: "Outside recorded stages",
          title:
            "Total wall-clock time minus recorded stages; includes phase switches, paint waits, async scheduling, and glue code that is not measured separately.",
        },
        preflight: {
          label: "Preflight current path",
          title:
            "Check whether the current function trajectory reaches the last path point before any obstacle, so pathfinding does not continue from an already blocked path.",
        },
        "search-route": {
          label: "Search obstacle route",
          title:
            "Search a geometry route from the current path end to the target point using the current obstacle mask and route expansion.",
        },
        "setting-status": {
          label: "Set status text",
          title: "Build the Path Planning success or failure message and write it to the pathfinding header status.",
        },
        total: {
          label: "Flow total",
          title: "Wall-clock time from the start of this Path Planning run until the final status is applied.",
        },
        "validate-trajectory": {
          label: "Validate function trajectory",
          title:
            "Convert the candidate geometry path into a Graphwar function trajectory and check that it hits the target before obstacles or bounds.",
        },
        "validate-direct-trajectory": {
          label: "Validate direct trajectory",
          title:
            "Replay the final formula formed by appending the new target directly; success returns immediately without prefix preparation or route scanning.",
        },
      },
      debugSummary: "Debug info",
      deleteOptimization: "Point removal",
      deleteOptimizationTitle: "Remove unnecessary control points; the full trajectory is still validated",
      obstacleExpansionAgentMode: "Agent mode",
      obstacleExpansionDetectionMode: "Detection mode",
      obstacleExpansion: "Obstacle expansion",
      obstacleExpansionTitle:
        "Set the obstacle margin for routing and collision checks; Glitch Mode uses its own value",
      oneClickClearDeleteCheckRadius: "Point removal check radius",
      oneClickClearDeleteCheckRadiusAriaLabel:
        "One-Click Clear point removal check radius, in raw Graphwar 770x450 plane pixels",
      oneClickClearDeleteCheckRadiusTitle:
        "Quickly check whether a local route still crosses the same soldiers; set to 0 to validate the full trajectory",
      oneClickClearTitle: "Start at the current path end and target usable soldiers to the right",
      managedFriendlyFireWarning: "Managed mode allows friendly fire; allied soldiers are One-Click Clear candidates.",
      managedMode: "Managed mode",
      managedModeDisableTitle: "Turn off Managed Mode and unlock settings",
      managedModeConfirmation: (settings, repairs, friendlyFireEnabled) => {
        const algorithmStatus = [
          "Current algorithm settings:",
          ...settings.map(
            (setting) =>
              `${setting.equation}: ${setting.algorithm}${setting.properties.length > 0 ? ` (${setting.properties.join(", ")})` : ""}`,
          ),
          ...(repairs.length === 0
            ? []
            : [
                "",
                "These game modes need different algorithm settings:",
                ...repairs.map(
                  (repair) =>
                    `${repair.equation}: the current algorithm does not support One-Click Clear; it will be set to ${repair.algorithm}${repair.properties.length > 0 ? ` (${repair.properties.join(", ")})` : ""}`,
                ),
              ]),
        ].join("\n");
        return `Managed mode submits shots to Graphwar automatically\nLocal players in the room are marked ready automatically\nFriendly fire is ${friendlyFireEnabled ? "enabled" : "disabled"}\n\n${algorithmStatus}\n\nEnable managed mode?`;
      },
      managedModeTitle: "Read state, plan, and fire automatically during local turns",
      routePlanningTolerance: "Route planning tolerance",
      routePlanningToleranceAriaLabel: "Route planning tolerance in raw Graphwar 770x450 plane pixels",
      routePlanningToleranceTitle: "Set the obstacle tolerance for Path Planning and One-Click Clear",
      routeAlgorithm: "Routing algorithm",
      routeAlgorithmTitle: "Choose the routing algorithm for Path Planning and One-Click Clear",
      routeLazyVisibilityGraph: "Lazy visibility graph",
      routeThetaStar: "Theta*",
      routeXPlusScan: "X+ Scan",
      searchAnimation: "Search animation",
      searchAnimationTitle:
        "Show single-target search progress and the current best formula and trajectory for One-Click Clear and managed mode",
      simulationTolerance: "Simulation tolerance",
      simulationToleranceAriaLabel: "Function-simulation tolerance in raw Graphwar 770x450 plane pixels",
      simulationToleranceTitle:
        "Set the obstacle tolerance for simulation and collision checks; route selection is unchanged",
      autoGraph: "One-Click Clear",
      title: "Pathfinding",
      settingsSummary: "Pathfinding settings",
      unit: "px",
    },
    point: {
      coordinateAriaLabel: (label, axis) => `${label} ${axis} coordinate`,
      coordinateTitle: (label, axis) => `Edit ${label}'s ${axis} coordinate and move the point on the screenshot`,
      header: "Point",
      pathLabel: (index) => `Path ${index}`,
      selfLabel: "Self",
      svgSelfLabel: "Me",
    },
    result: {
      clearSimulator: "Clear",
      clearSimulatorTitle: "Clear the function, launch angle, and selected firing soldier",
      copyTitle: "Copy the generated Graphwar function",
      fire: "Fire",
      fireError: "Fire failed",
      fireSuccess: "Fired",
      fireTitle: "Submit the current function through Graphwar Agent and fire",
      firing: "Firing",
      formulaInputAriaLabel: "Simulator function input",
      formulaInputTitle: "Enter the Graphwar function to simulate",
      launchAngle: "Launch angle",
      launchAngleAriaLabel: "Launch angle for y'' mode",
      launchAngleTitle: "Launch angle for y'' mode, in degrees",
      title: "Formula",
    },
    screenshot: {
      agentPlaceholder: "Read Agent state to start planning",
      stepGlitchAgentRecommendation: (agentToggleLabel) =>
        `Enable "${agentToggleLabel}" for accurate soldier positions`,
      capture: "Capture screenshot",
      captureTitle: "Capture a Graphwar screenshot and load it into the tool",
      placeholder: "Upload, drag in, or paste a screenshot to start calibration",
      title: "Screenshot",
      upload: "Upload image",
      uploadInputTitle: "Choose a Graphwar screenshot from your computer",
      uploadTitle: "Choose, drag in, or paste a Graphwar screenshot",
    },
    settings: {
      algorithm: "Algorithm",
      algorithmAriaLabel: "Algorithm",
      algorithmTitle: "Choose how path points become a Graphwar function",
      bounds: {
        heading: "Bounds",
        maxXAriaLabel: "Graphwar coordinate-system right-edge x coordinate",
        maxXTitle: "X coordinate of the right boundary",
        maxYAriaLabel: "Graphwar coordinate-system top-edge y coordinate",
        maxYTitle: "Y coordinate of the top boundary",
        minXAriaLabel: "Graphwar coordinate-system left-edge x coordinate",
        minXTitle: "X coordinate of the left boundary",
        minYAriaLabel: "Graphwar coordinate-system bottom-edge y coordinate",
        minYTitle: "Y coordinate of the bottom boundary",
      },
      actionBar: {
        heading: "Action Bar",
        liveClickPreviewWorkerCount: "Live preview workers",
        liveClickPreviewWorkerCountAriaLabel: "Number of live click preview Workers",
        liveClickPreviewWorkerCountTitle: "Set the number of live preview workers; default 4, range 1 to 16",
      },
      advancedSettings: "Advanced",
      debugActivationCountdown: (remainingSeconds) => `Hold ${remainingSeconds}s more to enable debug info`,
      decimalPlaces: "Decimal places",
      decimalPlacesAriaLabel: "Generated function decimal places",
      decimalPlacesTitle:
        "Set decimal places in generated functions; more digits improve precision but increase length",
      debugInfoEnabled: "Debug info enabled",
      gameMode: "Game mode",
      gameModeAriaLabel: "Graphwar game mode",
      gameModeTitle: "Choose the Graphwar input mode: y, y', or y''",
      mode: "Workflow",
      modeAriaLabel: "Workflow",
      modeTitle: "Generate a function or simulate an existing one",
      overflowProtection: "Overflow protection",
      overflowProtectionTitle: "Use a stable formula when Step derivative terms may overflow",
      parseDerivativeAsY: "y' -> y",
      parseDerivativeAsYTitle: "Match Graphwar's behavior of parsing y' as y",
      pathfinding: {
        heading: "Pathfinding",
        workerCount: "Pathfinding workers",
        workerCountAriaLabel: "Number of geometry pathfinding Workers",
        workerCountTitle: "Set the number of pathfinding workers; default 4, range 1 to 128",
      },
      recognition: {
        candidateTopRatio: "Candidate keep ratio",
        candidateTopRatioAriaLabel: "Soldier template candidate keep ratio",
        candidateTopRatioTitle: "Keep only top-ranked soldier candidates before template matching; 0.1 keeps 10%",
        heading: "Recognition",
        maximumSoldierCount: "Detected soldier limit",
        maximumSoldierCountAriaLabel: "Detected soldier count limit",
        maximumSoldierCountTitle: "Set the maximum soldiers kept in detection results; default 40",
        templateMatchingWorkerCount: "Template matching workers",
        templateMatchingWorkerCountAriaLabel: "Number of soldier template matching Workers",
        templateMatchingWorkerCountTitle: "Set the number of template matching workers; default 4, range 1 to 128",
      },
      simulator: "Simulator",
      skipUnknownCharacters: "Skip unknown characters",
      skipUnknownCharactersTitle: "Match Graphwar's behavior of skipping unknown characters",
      stepGlitchMode: "Glitch Mode",
      stepGlitchModeInactiveReason: "Switch to Step y' to use it",
      stepGlitchModeObstacleRequiredReason: "Requires obstacle data",
      stepGlitchModeTitle: "Use with Step y' to tunnel past obstacles; accurate obstacle and soldier data is required",
      stepSteepness: "Step steepness a",
      stepSteepnessAriaLabel: "Step function steepness a",
      stepSteepnessTitle: "Set Step steepness; higher values make sharper turns and trigger overflow protection sooner",
      title: "Settings",
    },
  },
} as const satisfies GraphwarKillerLocale;
