import type { GraphwarKillerLocale } from "../../../tools/graphwar-killer/locale-types";

export const graphwarKillerLocale = {
  equationModes: [
    {
      value: "y",
      label: "y=",
      description: "Output a step function",
      title: "Output or simulate a standard function for Graphwar's y= mode.",
    },
    {
      value: "dy",
      label: "y'=",
      description: "Output the step function's first derivative",
      title: "Output or simulate a first-derivative function for Graphwar's y'= mode.",
    },
    {
      value: "ddy",
      label: "y''=",
      description: "Output the step function's second derivative",
      title:
        "Output or simulate a second-derivative function for Graphwar's y''= mode; some algorithms are unsupported.",
    },
  ],
  toolWorkflowModes: [
    {
      value: "solver",
      label: "Generate Formula",
      title: "Generate a function from the screenshot and path points for pasting into Graphwar.",
    },
    {
      value: "simulator",
      label: "Simulate Trajectory",
      title: "Enter a function and preview its Graphwar trajectory on the screenshot.",
    },
  ],
  algorithmModes: [
    {
      value: "abs",
      label: "Double absolute-value function",
      title: "Connect path points with double absolute values; expressions are shorter and work well for y= and y'=.",
    },
    {
      value: "step",
      label: "Step function",
      title: "Connect path points with step functions; steepness is adjustable, but expressions are usually longer.",
    },
    {
      value: "pchip",
      label: "PCHIP interpolation",
      title: "Use monotone cubic interpolation for a smooth path that usually tracks hand-picked points closely.",
    },
    {
      value: "akima",
      label: "Akima interpolation",
      title: "Use Akima cubic interpolation for a smooth path that is more stable around local outliers.",
    },
  ],
  validation: {
    boundaryExpansionNegative: "Boundary expansion cannot be negative",
    boundaryExpansionNumber: "Boundary expansion must be a number",
    boundaryExpansionPixelRange: (max) => `Boundary expansion must be between 0px and ${max}`,
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
      obstacle: "Hold left-click to draw or erase detected obstacles; hover to preview the brush footprint.",
      simulatorPath: "Left-click the initial firing soldier; click another soldier to replace it.",
      solverPath:
        "Left-click your soldier's center first, then path-point centers. Drag path points to fine-tune them, right-click a point to delete it, or right-click empty space to undo the latest point.",
    },
    calculation: {
      enterFunction: "Enter a function",
      enterLaunchAngle: "Enter a launch angle",
      selectInitialSoldier: "Select the initial firing soldier first",
      selectPath: "Click your position first, then select at least one path point",
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
      detectingBounds: "Detecting play-area bounds",
      detectingObjects: "Detecting soldiers and obstacles",
      detectedCurrentBounds: (soldiers, elapsed) => `Marked obstacles and ${soldiers} soldiers in ${elapsed}`,
      detectedWithAutoBounds: (soldiers, elapsed) => `Marked bounds, obstacles, and ${soldiers} soldiers in ${elapsed}`,
      failed: (message) => `Detection failed: ${message}`,
      obstacleEditsApplied: (obstacles) => `Updated obstacle boundaries; currently ${obstacles} obstacles`,
      obstacleEditsCleared: (obstacles) => `Cleared obstacle edits; restored ${obstacles} obstacles`,
      updatingObstacleEdits: "Applying obstacle edits",
      noBounds: "Could not detect the Graphwar play-area bounds",
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
    autoGraphPathfindingDisabled: "One-Click Clear is being rebuilt and is unavailable for now",
    pathPointCoordinateNumber: "Point coordinates must be numbers",
    secondOrderAngleHint: (angle) => `Use the Up/Down keys to set the launch angle to about ${angle} deg.`,
    stepPathfindingDisabled: "Step functions do not support Smart Pathfinding yet",
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
        ? "Smart Pathfinding failed: no valid path found"
        : `Smart Pathfinding failed: no valid path found in ${elapsed}`,
    forwardMinimumDouble: "one representable double",
    forwardPath: (minimumStep) =>
      `Each point's Graphwar x must be strictly greater than the previous point by at least ${minimumStep}`,
    inProgress: {
      optimize: "Optimize path nodes",
      search: "Search obstacle route",
      stopSuffix: ", right-click the screenshot to stop",
      trajectory: "Validate function trajectory",
    },
    success: (elapsed) =>
      elapsed === undefined ? "Smart Pathfinding completed" : `Smart Pathfinding completed in ${elapsed}`,
    oneClickClear: {
      inProgress: "Running One-Click Clear; right-click the screenshot to stop",
      needCurrentPath: "One-Click Clear needs an existing path start first",
      noCandidate: "One-Click Clear failed: no selectable target exists on the x+ side of the current path",
      noUsableTarget: (elapsed) => `One-Click Clear failed: no usable target found in ${elapsed}`,
      success: (killCount, elapsed) =>
        `One-Click Clear completed, the full trajectory killed ${killCount} soldier(s) in ${elapsed}`,
      unsupported: "The first One-Click Clear version only supports double absolute-value y= and y'= modes",
    },
  },
  ui: {
    actions: {
      clearPath: "Clear path",
      clearPathTitle: "Clear all path points",
      clearObstacleEdits: "Clear obstacle edits",
      clearObstacleEditsTitle: "Restore the original obstacle area from this detection run.",
      drawObstacle: "Draw obstacle",
      drawObstacleTitle:
        "Enter obstacle-drawing mode: use a circular brush to correct the current detected obstacles. Requires detected obstacles and either Smart Cursor or Smart Pathfinding.",
      eraseObstacle: "Erase mode",
      eraseObstacleTitle: "When enabled, the brush removes area from the current detected obstacles.",
      magnifier: "Magnifier",
      magnifierTitle:
        "Show a zoomed preview next to the screenshot for more precise soldier, bounds, and path picking.",
      magnifierZoom: "Zoom",
      magnifierZoomAriaLabel: "Magnifier zoom",
      magnifierZoomTitle:
        "Adjust magnifier zoom; the slider quickly adjusts 1x to 5x, and the input accepts 1x to 100x.",
      obstacleBrushDiameter: "Brush size",
      obstacleBrushDiameterAriaLabel: "Obstacle brush diameter in raw Graphwar 770x450 plane pixels",
      obstacleBrushDiameterTitle:
        "Circular obstacle brush diameter, in raw Graphwar 770x450 plane pixels; the slider quickly adjusts 1px to 200px, and the input accepts 1px to 1000px.",
      pickBounds: "Pick bounds",
      pickBoundsTitle: "Enter bounds-picking mode: left-click two board corners to calibrate the screenshot bounds.",
      pickPath: "Pick path",
      pickPathTitle: "Enter path-picking mode: click your soldier first, then target path points or target soldiers.",
      title: "Controls",
      toolModeAriaLabel: "Tool mode",
      toolModeTitle: "Choose whether clicks on the screenshot pick board bounds or pick your soldier and path points.",
      undoPoint: "Undo point",
      undoPointTitle: "Undo the most recently added path point",
    },
    detection: {
      autoDetection: "Auto detect",
      autoDetectionTitle: "Automatically run detection when a screenshot loads or detection settings change.",
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
              ? `- Template matching mode: parallel, ${workerCount} worker`
              : mode === "parallel-fallback"
                ? `- Template matching mode: parallel failed then serial, ${workerCount} worker -> 1 worker`
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
          label: "Detect play-area bounds",
          title:
            "Find the usable Graphwar play-area bounds in the screenshot pixels; only appears during automatic bounds detection.",
        },
        "detecting-objects": {
          label: "Detect soldiers and obstacles",
          title: "Detect soldiers, obstacle regions, and hit circles inside the resolved play area.",
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
            "Write detected soldiers, obstacles, and play-area bounds back to page state, then refresh related cache and highlights.",
        },
      },
      debugSummary: "Debug info",
      minObstacleArea: "Minimum obstacle area",
      minObstacleAreaAriaLabel: "Minimum obstacle area in raw Graphwar plane pixels",
      minObstacleAreaTitle:
        "Area threshold for filtering tiny noise; obstacle regions smaller than this are ignored, in raw Graphwar 770x450 plane pixels.",
      smartCursor: "Smart cursor",
      smartCursorTitle:
        "Snap path picking to detected soldier centers and enable obstacle and boundary collision simulation.",
      startDetection: "Start detection",
      startDetectionTitle:
        "Automatically detect the Graphwar board bounds, soldiers, and obstacles from the current screenshot.",
      title: "Detection",
    },
    instructions: {
      items: [
        "Add a Graphwar screenshot by uploading, dragging, or pasting it.",
        "Enter the coordinate range and game mode, or use Start detection to detect bounds, soldiers, and obstacles.",
        "Solver mode: in Pick path, click your soldier first, then the target path points; copy the generated function into Graphwar.",
        "Simulator mode: select the initial firing soldier and enter a function. y'' mode also needs a launch angle.",
        "Turn on Smart Cursor for assisted picking; choose Smart Pathfinding when the route should avoid detected obstacles.",
        "During Smart Pathfinding, right-click the screenshot to cancel.",
        "Graphwar is known to skip unknown characters and parse y' as y; these can be changed in Advanced.",
      ],
      title: "How to Use",
    },
    introLinkText: "Graphwar",
    introPrefix: "In Solver mode, calibrate a ",
    introSuffix:
      " screenshot and pick a path to generate a function expression. In Simulator mode, enter a function expression to simulate the result. All calculations happen locally.",
    pathfinding: {
      allowFriendlyFire: "Allow friendly fire",
      allowFriendlyFireTitle:
        "When enabled, Smart Pathfinding and One-Click Clear may route through your own soldiers; when disabled, your soldiers are avoided as obstacles.",
      boundaryExpansion: "Boundary expansion",
      boundaryExpansionAriaLabel: "Boundary expansion in raw Graphwar 770x450 plane pixels",
      boundaryExpansionTitle:
        "Treat the play-area boundary as expanded inward into the collision area. Unit: raw Graphwar 770x450 plane pixels.",
      debugNoTiming: "No pathfinding timing recorded yet",
      debugDetails: {
        "build-dag-edges": {
          label: "- Build clear DAG edges",
          title:
            "Try x+ geometry routes between soldier centers with the current clear route mask, then record usable edges.",
        },
        "build-dag-targets": {
          label: "- Collect clear DAG targets",
          title: "Convert selectable soldiers into DAG nodes sorted by increasing Graphwar center x.",
        },
        "dag-longest-path": {
          label: "- Run clear DAG longest path",
          title: "Run longest-path DP on the built center-point DAG and choose the route with the most explicit hits.",
        },
        "optimize-path": {
          label: "- Optimize clear path",
          title:
            "Conservatively delete points from the validated clear path and verify each deletion still hits the target hit-circle sequence in order.",
        },
        "remove-failed-edge": {
          label: "- Remove failed clear edge",
          title:
            "When function validation rejects a DAG edge, mark that edge inactive before running longest-path DP again.",
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
            "Re-sample the accepted target sequence with the current full path and confirm the new target hit circle is reached before obstacles.",
        },
        "validate-route": {
          label: "- Validate clear DAG route",
          title:
            "Append the DAG edges selected by longest-path DP one by one, validate each target hit circle, and return the exact failed edge when one fails.",
        },
        "validate-final": {
          label: "- Validate final clear",
          title:
            "Resample the optimized full clear path and confirm it still hits every DAG target hit circle in order.",
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
          title: "Write the final Smart Pathfinding path to the current path state and clear stale path errors.",
        },
        "collect-targets": {
          label: "Collect candidate targets",
          title:
            "When a soldier is clicked, enumerate x+ aim points inside its hit circle using a 1 raw-plane-pixel scan step.",
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
            "This Smart Pathfinding run either used a direct route or failed before obstacle-route search, so no visibility graph was needed.",
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
          title:
            "Build the Smart Pathfinding success or failure message and write it to the pathfinding header status.",
        },
        total: {
          label: "Flow total",
          title: "Wall-clock time from the start of this Smart Pathfinding run until the final status is applied.",
        },
        "validate-trajectory": {
          label: "Validate function trajectory",
          title:
            "Convert the candidate geometry path into a Graphwar function trajectory and check that it hits the target before obstacles or bounds.",
        },
      },
      debugSummary: "Debug info",
      obstacleExpansion: "Obstacle expansion",
      obstacleExpansionTitle:
        "Adjust the safety margin around detected obstacles and board bounds for pathfinding and collision checks.",
      oneClickClearTitle:
        "Start at the current path end, append a route, and try to kill selectable soldiers on the x+ side in order.",
      routePlanningTolerance: "Route planning tolerance",
      routePlanningToleranceAriaLabel: "Route planning tolerance in raw Graphwar 770x450 plane pixels",
      routePlanningToleranceTitle:
        "Single route tolerance used when Smart Pathfinding and One-Click Clear build geometry routes. Unit: raw Graphwar 770x450 plane pixels.",
      searchAnimation: "Search animation",
      searchAnimationTitle:
        "Show Smart Pathfinding candidate points, explored edges, trial paths, and optimization points; turn it off to keep only the final path result.",
      simulationTolerance: "Simulation tolerance",
      simulationToleranceAriaLabel: "Function-simulation tolerance in raw Graphwar 770x450 plane pixels",
      simulationToleranceTitle:
        "Obstacle tolerance used during function simulation and collision checks; it does not affect route selection. Unit: raw Graphwar 770x450 plane pixels.",
      autoGraph: "One-Click Clear",
      smartPathfinding: "Smart Pathfinding",
      smartPathfindingTitle: "After you pick a target soldier, automatically find a route around detected obstacles.",
      title: "Pathfinding",
      unit: "px",
    },
    point: {
      coordinateAriaLabel: (label, axis) => `${label} ${axis} coordinate`,
      coordinateTitle: (label, axis) =>
        `Edit the ${axis} coordinate for ${label}; this also moves the point on the screenshot.`,
      header: "Point",
      pathLabel: (index) => `Path ${index}`,
      selfLabel: "Self",
      svgSelfLabel: "Me",
    },
    result: {
      clearSimulator: "Clear",
      clearSimulatorTitle: "Clear the simulator function, launch angle, and selected starting soldier.",
      copyTitle: "Copy the generated Graphwar function to the clipboard.",
      formulaInputAriaLabel: "Simulator function input",
      formulaInputTitle: "Enter the Graphwar function expression to simulate on the screenshot.",
      launchAngle: "Launch angle",
      launchAngleAriaLabel: "Launch angle for y'' mode",
      launchAngleTitle: "Launch angle required by y''= mode, in degrees.",
      title: "Formula",
    },
    screenshot: {
      capture: "Capture screenshot",
      captureTitle: "Use the browser's screen capture prompt to load a Graphwar screenshot into the tool.",
      placeholder: "Upload, drag in, or paste a screenshot to start calibration",
      title: "Screenshot",
      upload: "Upload image",
      uploadInputTitle: "Choose a Graphwar screenshot from your computer.",
      uploadTitle: "Choose a Graphwar screenshot from your computer; you can also drag in or paste an image.",
    },
    settings: {
      algorithm: "Algorithm",
      algorithmAriaLabel: "Algorithm",
      algorithmTitle: "Choose how path points are converted into a Graphwar function.",
      bounds: {
        heading: "Bounds",
        maxXAriaLabel: "Graphwar board right-edge x coordinate",
        maxXTitle: "X coordinate for the right edge of the Graphwar board.",
        maxYAriaLabel: "Graphwar board top-edge y coordinate",
        maxYTitle: "Y coordinate for the top edge of the Graphwar board.",
        minXAriaLabel: "Graphwar board left-edge x coordinate",
        minXTitle: "X coordinate for the left edge of the Graphwar board.",
        minYAriaLabel: "Graphwar board bottom-edge y coordinate",
        minYTitle: "Y coordinate for the bottom edge of the Graphwar board.",
      },
      advancedSettings: "Advanced",
      debugActivationCountdown: (remainingSeconds) => `Hold ${remainingSeconds}s more to enable debug info`,
      decimalPlaces: "Decimal places",
      decimalPlacesAriaLabel: "Generated function decimal places",
      decimalPlacesTitle:
        "Number of decimal places kept in generated function text; more digits are more precise but make the function longer.",
      debugInfoEnabled: "Debug info enabled",
      gameMode: "Game mode",
      gameModeAriaLabel: "Graphwar game mode",
      gameModeTitle: "Choose the Graphwar input mode: y=, y'=, or y''=.",
      mode: "Workflow",
      modeAriaLabel: "Workflow",
      modeTitle: "Choose whether to generate a copyable function or simulate an existing function's trajectory.",
      overflowProtection: "Overflow protection",
      overflowProtectionTitle:
        "Clamp the step function's exponential terms to reduce overflow risk after pasting into Graphwar.",
      parseDerivativeAsY: "y' -> y",
      parseDerivativeAsYTitle: "Graphwar has a bug: because of the regular expression order, y' is parsed as y.",
      pathfinding: {
        heading: "Pathfinding",
      },
      recognition: {
        candidateTopRatio: "Candidate keep ratio",
        candidateTopRatioAriaLabel: "Soldier template candidate keep ratio",
        candidateTopRatioTitle:
          "Before template matching, keep only top-ranked soldier candidates; 0.1 means the top 10%.",
        heading: "Recognition",
        maximumSoldierCount: "Detected soldier limit",
        maximumSoldierCountAriaLabel: "Detected soldier count limit",
        maximumSoldierCountTitle: "Maximum number of soldiers kept in detection results; default 40.",
        templateMatchingWorkerCount: "Template matching workers",
        templateMatchingWorkerCountAriaLabel: "Number of soldier template matching Workers",
        templateMatchingWorkerCountTitle:
          "Number of Workers to run during soldier template matching; default 4, range 1 to 128, and it will not exceed the candidate count.",
      },
      simulator: "Simulator",
      skipUnknownCharacters: "Skip unknown characters",
      skipUnknownCharactersTitle: "Graphwar skips unknown characters.",
      stepSteepness: "Step steepness a",
      stepSteepnessAriaLabel: "Step function steepness a",
      stepSteepnessTitle:
        "Steepness parameter a for the step function; higher values make turns sharper but increase overflow risk.",
      title: "Settings",
    },
  },
} as const satisfies GraphwarKillerLocale;
