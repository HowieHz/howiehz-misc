/** Formula command tags used by the single raw `runFormula` entry point. */
export const FORMULA_COMMAND_NOOP: i32 = 0;
export const FORMULA_COMMAND_EVALUATE_EXPRESSION_BATCH: i32 = 1;
export const FORMULA_COMMAND_EVALUATE_CURVE_BATCH: i32 = 2;
export const FORMULA_COMMAND_EVALUATE_STEP_BATCH: i32 = 3;
export const FORMULA_COMMAND_PREPARE_LAUNCH: i32 = 4;
export const FORMULA_COMMAND_CANONICAL_DECIMAL: i32 = 5;

/** Formula algorithm tags mirror the TypeScript Adapter contract. */
export const FORMULA_ALGORITHM_ABS: i32 = 1;
export const FORMULA_ALGORITHM_STEP: i32 = 2;
export const FORMULA_ALGORITHM_PCHIP: i32 = 3;
export const FORMULA_ALGORITHM_AKIMA: i32 = 4;

/** Equation tags mirror the TypeScript Adapter contract. */
export const FORMULA_EQUATION_Y: i32 = 1;
export const FORMULA_EQUATION_DY: i32 = 2;
export const FORMULA_EQUATION_DDY: i32 = 3;

/** Material tags make each result descriptor a closed raw-memory union. */
export const FORMULA_MATERIAL_ABS_CONNECTOR: i32 = 1;
export const FORMULA_MATERIAL_ABS_SECOND_DERIVATIVE: i32 = 2;
export const FORMULA_MATERIAL_SOFT_CUBIC: i32 = 3;
export const FORMULA_MATERIAL_STEP: i32 = 4;

/** Expression batch input offsets. */
export const EXPRESSION_INPUT_OPCODE_POINTER_OFFSET: u32 = 0;
export const EXPRESSION_INPUT_OPCODE_COUNT_OFFSET: u32 = 4;
export const EXPRESSION_INPUT_CONSTANT_POINTER_OFFSET: u32 = 8;
export const EXPRESSION_INPUT_CONSTANT_COUNT_OFFSET: u32 = 12;
export const EXPRESSION_INPUT_MAXIMUM_STACK_SIZE_OFFSET: u32 = 16;
export const EXPRESSION_INPUT_X_POINTER_OFFSET: u32 = 20;
export const EXPRESSION_INPUT_Y_POINTER_OFFSET: u32 = 24;
export const EXPRESSION_INPUT_DY_POINTER_OFFSET: u32 = 28;
export const EXPRESSION_INPUT_VALUE_COUNT_OFFSET: u32 = 32;
export const EXPRESSION_INPUT_BYTE_LENGTH: u32 = 36;

/** Shared expression/curve/Step batch result offsets. */
export const FORMULA_RESULT_MATERIAL_TYPE_OFFSET: u32 = 0;
export const FORMULA_RESULT_MATERIAL_POINTER_OFFSET: u32 = 4;
export const FORMULA_RESULT_MATERIAL_COUNT_OFFSET: u32 = 8;
export const FORMULA_RESULT_MATERIAL_STRIDE_OFFSET: u32 = 12;
export const FORMULA_RESULT_VALUE_POINTER_OFFSET: u32 = 16;
export const FORMULA_RESULT_VALUE_COUNT_OFFSET: u32 = 20;
export const FORMULA_RESULT_AUXILIARY_VALUE_OFFSET: u32 = 24;
export const FORMULA_RESULT_PROTECTION_POINTER_OFFSET: u32 = 32;
export const FORMULA_RESULT_PROTECTION_COUNT_OFFSET: u32 = 36;
export const FORMULA_RESULT_FLAGS_OFFSET: u32 = 40;
export const FORMULA_RESULT_BYTE_LENGTH: u32 = 48;

/** ABS connector and second-derivative pulse record layouts. */
export const ABS_CONNECTOR_COEFFICIENT_OFFSET: u32 = 0;
export const ABS_CONNECTOR_START_X_OFFSET: u32 = 8;
export const ABS_CONNECTOR_END_X_OFFSET: u32 = 16;
export const ABS_CONNECTOR_WIDTH_OFFSET: u32 = 24;
export const ABS_CONNECTOR_SOURCE_SEGMENT_OFFSET: u32 = 32;
export const ABS_CONNECTOR_BYTE_LENGTH: u32 = 40;
export const ABS_PULSE_COEFFICIENT_OFFSET: u32 = 0;
export const ABS_PULSE_CENTER_X_OFFSET: u32 = 8;
export const ABS_PULSE_BYTE_LENGTH: u32 = 16;

/** Soft PCHIP/Akima material records keep every independently rounded coefficient. */
export const SOFT_CUBIC_COEFFICIENT_OFFSET: u32 = 0;
export const SOFT_FIRST_CUBIC_COEFFICIENT_OFFSET: u32 = 32;
export const SOFT_FIRST_POWER_COEFFICIENT_OFFSET: u32 = 64;
export const SOFT_HALF_WIDTH_OFFSET: u32 = 72;
export const SOFT_SECOND_CUBIC_COEFFICIENT_OFFSET: u32 = 80;
export const SOFT_SECOND_POWER_COEFFICIENT_OFFSET: u32 = 112;
export const SOFT_CENTER_X_OFFSET: u32 = 120;
export const SOFT_START_X_OFFSET: u32 = 128;
export const SOFT_WIDTH_OFFSET: u32 = 136;
export const SOFT_CUBIC_BYTE_LENGTH: u32 = 144;

/** Raw structured-formula input shared by curve, Step, and launch commands. */
export const FORMULA_INPUT_ALGORITHM_OFFSET: u32 = 0;
export const FORMULA_INPUT_EQUATION_OFFSET: u32 = 4;
export const FORMULA_INPUT_DECIMAL_PLACES_OFFSET: u32 = 8;
export const FORMULA_INPUT_FLAGS_OFFSET: u32 = 12;
export const FORMULA_INPUT_POINT_COUNT_OFFSET: u32 = 16;
export const FORMULA_INPUT_POINT_X_POINTER_OFFSET: u32 = 20;
export const FORMULA_INPUT_POINT_Y_POINTER_OFFSET: u32 = 24;
export const FORMULA_INPUT_SIGN_PROTECTION_POINTER_OFFSET: u32 = 28;
export const FORMULA_INPUT_SIGN_PROTECTION_COUNT_OFFSET: u32 = 32;
export const FORMULA_INPUT_VALUE_COUNT_OFFSET: u32 = 36;
export const FORMULA_INPUT_VALUE_X_POINTER_OFFSET: u32 = 40;
export const FORMULA_INPUT_VALUE_Y_POINTER_OFFSET: u32 = 44;
export const FORMULA_INPUT_VALUE_DY_POINTER_OFFSET: u32 = 48;
/** Optional two-f64 Step overflow range; pointer/count occupy otherwise unused u32 padding slots. */
export const FORMULA_INPUT_STEP_OVERFLOW_RANGE_POINTER_OFFSET: u32 = 52;
export const FORMULA_INPUT_STEEPNESS_OFFSET: u32 = 56;
export const FORMULA_INPUT_BOUNDS_MIN_X_OFFSET: u32 = 64;
export const FORMULA_INPUT_BOUNDS_MAX_X_OFFSET: u32 = 72;
export const FORMULA_INPUT_BOUNDS_MIN_Y_OFFSET: u32 = 80;
export const FORMULA_INPUT_BOUNDS_MAX_Y_OFFSET: u32 = 88;
export const FORMULA_INPUT_SOLDIER_X_OFFSET: u32 = 96;
export const FORMULA_INPUT_SOLDIER_Y_OFFSET: u32 = 104;
export const FORMULA_INPUT_LAUNCH_ANGLE_OFFSET: u32 = 112;
export const FORMULA_INPUT_DISABLED_SEGMENT_POINTER_OFFSET: u32 = 120;
export const FORMULA_INPUT_SEGMENT_START_X_POINTER_OFFSET: u32 = 124;
export const FORMULA_INPUT_SEGMENT_START_Y_POINTER_OFFSET: u32 = 128;
export const FORMULA_INPUT_STEP_DELTA_Y_POINTER_OFFSET: u32 = 132;
export const FORMULA_INPUT_GLITCH_SEGMENT_POINTER_OFFSET: u32 = 136;
export const FORMULA_INPUT_ABS_PULSE_DELTA_SLOPE_POINTER_OFFSET: u32 = 140;
export const FORMULA_INPUT_ABS_PULSE_CENTER_X_POINTER_OFFSET: u32 = 144;
export const FORMULA_INPUT_STEP_OVERFLOW_RANGE_COUNT_OFFSET: u32 = 148;
/** Step path-center refinement may deliberately use a different steepness from the final formula. */
export const FORMULA_INPUT_PATH_STEEPNESS_OFFSET: u32 = 152;
/** Optional raw obstacle mask used by production cold refinement; dimensions remain the canonical plane constants. */
export const FORMULA_INPUT_MASK_POINTER_OFFSET: u32 = 160;
export const FORMULA_INPUT_MASK_BYTE_LENGTH_OFFSET: u32 = 164;
/** Canonical position-quality target supplied by the TypeScript settings boundary. */
export const FORMULA_INPUT_QUALITY_TARGET_PLANE_PIXELS_OFFSET: u32 = 168;
export const FORMULA_INPUT_BYTE_LENGTH: u32 = 176;

/** Formula flags describe only orthogonal runtime choices, never optional half-state. */
export const FORMULA_FLAG_STEP_OVERFLOW_PROTECTION: u32 = 1;
export const FORMULA_FLAG_DISPLAY_ROUNDED_ANGLE: u32 = 2;
export const FORMULA_FLAG_HAS_USER_LAUNCH_ANGLE: u32 = 4;
export const FORMULA_FLAG_STEP_GLITCH_MODE: u32 = 8;
/** Scanner-owned launch input uses the glitch pointer for per-segment fixed X windows, not compiled segments. */
export const FORMULA_FLAG_STEP_GLITCH_FIXED_WINDOWS: u32 = 16;

export const STEP_GLITCH_FIXED_WINDOW_PRESENCE_OFFSET: u32 = 0;
export const STEP_GLITCH_FIXED_WINDOW_RESERVED_OFFSET: u32 = 4;
export const STEP_GLITCH_FIXED_WINDOW_START_X_OFFSET: u32 = 8;
export const STEP_GLITCH_FIXED_WINDOW_END_X_OFFSET: u32 = 16;
export const STEP_GLITCH_FIXED_WINDOW_BYTE_LENGTH: u32 = 24;

/** Optional Step-glitch records are indexed by original path segment. */
export const STEP_GLITCH_RECORD_EQUATION_OFFSET: u32 = 0;
export const STEP_GLITCH_RECORD_DECIMAL_PLACES_OFFSET: u32 = 4;
export const STEP_GLITCH_RECORD_START_X_OFFSET: u32 = 8;
export const STEP_GLITCH_RECORD_END_X_OFFSET: u32 = 16;
export const STEP_GLITCH_RECORD_TARGET_Y_OFFSET: u32 = 24;
export const STEP_GLITCH_RECORD_PRIMARY_OFFSET: u32 = 32;
export const STEP_GLITCH_RECORD_GATE_Y_OFFSET: u32 = 40;
export const STEP_GLITCH_RECORD_BRAKING_OFFSET: u32 = 48;
export const STEP_GLITCH_RECORD_BRAKING_GATE_Y_OFFSET: u32 = 56;
export const STEP_GLITCH_RECORD_PULSE_END_X_OFFSET: u32 = 64;
export const STEP_GLITCH_RECORD_BYTE_LENGTH: u32 = 72;

/** Compiled Step records preserve final text-equivalent coefficients and source identity. */
export const STEP_MATERIAL_CENTER_X_OFFSET: u32 = 0;
export const STEP_MATERIAL_FIRST_COEFFICIENT_OFFSET: u32 = 8;
export const STEP_MATERIAL_SECOND_COEFFICIENT_OFFSET: u32 = 16;
export const STEP_MATERIAL_Y_COEFFICIENT_OFFSET: u32 = 24;
export const STEP_MATERIAL_SOURCE_SEGMENT_OFFSET: u32 = 32;
export const STEP_MATERIAL_FLAGS_OFFSET: u32 = 36;
export const STEP_MATERIAL_GLITCH_EQUATION_OFFSET: u32 = 40;
export const STEP_MATERIAL_GLITCH_DECIMAL_PLACES_OFFSET: u32 = 44;
export const STEP_MATERIAL_GLITCH_START_X_OFFSET: u32 = 48;
export const STEP_MATERIAL_GLITCH_END_X_OFFSET: u32 = 56;
export const STEP_MATERIAL_GLITCH_TARGET_Y_OFFSET: u32 = 64;
export const STEP_MATERIAL_GLITCH_PRIMARY_OFFSET: u32 = 72;
export const STEP_MATERIAL_GLITCH_GATE_Y_OFFSET: u32 = 80;
export const STEP_MATERIAL_GLITCH_BRAKING_OFFSET: u32 = 88;
export const STEP_MATERIAL_GLITCH_BRAKING_GATE_Y_OFFSET: u32 = 96;
export const STEP_MATERIAL_GLITCH_PULSE_END_X_OFFSET: u32 = 104;
export const STEP_MATERIAL_BYTE_LENGTH: u32 = 112;
export const STEP_MATERIAL_FLAG_OVERFLOW_PROTECTED: u32 = 1;

/** Launch preparation returns a closed success/invalid result with its canonical material snapshot. */
export const FORMULA_LAUNCH_RESULT_STATUS_OFFSET: u32 = 0;
export const FORMULA_LAUNCH_RESULT_ITERATION_COUNT_OFFSET: u32 = 4;
export const FORMULA_LAUNCH_RESULT_ANGLE_OFFSET: u32 = 8;
export const FORMULA_LAUNCH_RESULT_X_OFFSET: u32 = 16;
export const FORMULA_LAUNCH_RESULT_Y_OFFSET: u32 = 24;
export const FORMULA_LAUNCH_RESULT_INITIAL_DY_OFFSET: u32 = 32;
export const FORMULA_LAUNCH_RESULT_Y_OFFSET_VALUE_OFFSET: u32 = 40;
export const FORMULA_LAUNCH_RESULT_MATERIAL_RESULT_POINTER_OFFSET: u32 = 48;
export const FORMULA_LAUNCH_RESULT_FLAGS_OFFSET: u32 = 52;
export const FORMULA_LAUNCH_RESULT_FORMULA_POINT_ITERATION_COUNT_OFFSET: u32 = 56;
export const FORMULA_LAUNCH_RESULT_PROTECTION_POINTER_OFFSET: u32 = 60;
export const FORMULA_LAUNCH_RESULT_PROTECTION_COUNT_OFFSET: u32 = 64;
export const FORMULA_LAUNCH_RESULT_FORMULA_POINT_COUNT_OFFSET: u32 = 68;
export const FORMULA_LAUNCH_RESULT_FORMULA_POINT_X_POINTER_OFFSET: u32 = 72;
export const FORMULA_LAUNCH_RESULT_FORMULA_POINT_Y_POINTER_OFFSET: u32 = 76;
export const FORMULA_LAUNCH_RESULT_BYTE_LENGTH: u32 = 80;
export const FORMULA_LAUNCH_STATUS_INVALID: i32 = 0;
export const FORMULA_LAUNCH_STATUS_SUCCESS: i32 = 1;
export const FORMULA_LAUNCH_FLAG_HAS_INITIAL_DY: u32 = 1;
export const FORMULA_LAUNCH_FLAG_HAS_Y_OFFSET: u32 = 2;
export const FORMULA_LAUNCH_FLAG_USED_USER_ANGLE: u32 = 4;

/** Canonical decimal input and result offsets. */
export const DECIMAL_INPUT_VALUE_OFFSET: u32 = 0;
export const DECIMAL_INPUT_DECIMAL_PLACES_OFFSET: u32 = 8;
export const DECIMAL_INPUT_BYTE_LENGTH: u32 = 16;
export const DECIMAL_RESULT_SIGN_OFFSET: u32 = 0;
export const DECIMAL_RESULT_DIGIT_POINTER_OFFSET: u32 = 4;
export const DECIMAL_RESULT_DIGIT_COUNT_OFFSET: u32 = 8;
export const DECIMAL_RESULT_DECIMAL_PLACES_OFFSET: u32 = 12;
export const DECIMAL_RESULT_LIMB_POINTER_OFFSET: u32 = 16;
export const DECIMAL_RESULT_LIMB_COUNT_OFFSET: u32 = 20;
export const DECIMAL_RESULT_ROUNDED_VALUE_OFFSET: u32 = 24;
export const DECIMAL_RESULT_BYTE_LENGTH: u32 = 32;
