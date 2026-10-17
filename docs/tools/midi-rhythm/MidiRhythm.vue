<script setup lang="ts">
import { Download, Maximize, Minimize, Pause, Play, RotateCcw, Upload, X } from "@lucide/vue";
import { loadSoundfont, startPresetNote, type SfumatoPreset } from "sfumato";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

import { applyResult, createEmptyStats, JudgementEngine } from "./core/judgment";
import { keyToMidi, midiToKeyLabel } from "./core/keyboard";
import { encodeMidi, parseMidiScore, type ParsedScore } from "./core/midi-io";
import { RecordingBuffer } from "./core/recording";
import { parseThresholds, type ThresholdInputText } from "./core/settings";
import { clampSpeed, DEFAULT_SPEED, effectiveBpm, noteWallTime, SPEED_MAX, SPEED_MIN } from "./core/timing";
import {
  DEFAULT_BAD_MS,
  DEFAULT_GOOD_MS,
  DEFAULT_METRONOME_BPM,
  DEFAULT_PERFECT_MS,
  PIANO_MAX_MIDI,
  PIANO_MIN_MIDI,
  type JudgementResult,
  type JudgementStats,
  type JudgementThresholds,
} from "./core/types";
import ToggleField from "./presentation/controls/ToggleField.vue";

type GameLanguage = "en" | "zh-Hans";
type PlayMode = "judge" | "free";
type SoundMode = "press" | "auto";
type FeedbackKind = "perfect" | "good" | "bad" | "miss";
type KeyHintMode = "auto" | "show" | "hide";
type TonePreset = "triangle" | "sine" | "square" | "sawtooth" | "electric-piano" | "organ" | "bell" | "soundfont";

interface Labels {
  load: string;
  dropHint: string;
  chooseFile: string;
  removeFile: string;
  scoreInfo: string;
  notes: string;
  baseBpm: string;
  tracks: string;
  range: string;
  mode: string;
  judgeMode: string;
  freeMode: string;
  playbackOnly: string;
  speed: string;
  metronome: string;
  soundMode: string;
  soundModePress: string;
  soundModeAuto: string;
  muteSource: string;
  metronomeBpm: string;
  tone: string;
  toneTriangle: string;
  toneSine: string;
  toneSquare: string;
  toneSawtooth: string;
  toneElectricPiano: string;
  toneOrgan: string;
  toneBell: string;
  soundFontDropHint: string;
  soundFontLoaded: string;
  soundFontPreset: string;
  soundFontLoading: string;
  soundFontError: string;
  soundFontTone: string;
  settings: string;
  thresholdsTitle: string;
  perfect: string;
  good: string;
  bad: string;
  miss: string;
  extraMiss: string;
  showAllKeys: string;
  leadSeconds: string;
  leadSecondsTitle: string;
  calibration: string;
  calibrationTitle: string;
  audioOffset: string;
  audioOffsetTitle: string;
  barLines: string;
  barLinesTitle: string;
  keyHint: string;
  keyHintAuto: string;
  keyHintShow: string;
  keyHintHide: string;
  midiUnsupported: string;
  start: string;
  pause: string;
  resume: string;
  stop: string;
  restart: string;
  exportRecord: string;
  fullscreen: string;
  exitFullscreen: string;
  combo: string;
  score: string;
  countIn: string;
  noScore: string;
  restartHint: string;
  emptyScore: string;
  exportEmpty: string;
  exported: string;
  loadError: string;
  finished: string;
  freeHint: string;
  perfectTitle: string;
  goodTitle: string;
  badTitle: string;
  playbackOnlyTitle: string;
  metronomeTitle: string;
  muteSourceTitle: string;
  showAllKeysTitle: string;
  keyHintTitle: string;
}

const labels = {
  en: {
    load: "Import MIDI",
    dropHint: "Drop a .mid file here, or click to choose",
    chooseFile: "Choose file",
    removeFile: "Remove",
    scoreInfo: "Score",
    notes: "notes",
    baseBpm: "Base BPM",
    tracks: "tracks",
    range: "range",
    mode: "Mode",
    judgeMode: "Judged play",
    freeMode: "Free recording",
    playbackOnly: "Playback mode",
    speed: "Speed",
    metronome: "Metronome",
    soundMode: "Sound",
    soundModePress: "Play on press",
    soundModeAuto: "Auto-play",
    muteSource: "Mute sound source",
    metronomeBpm: "Metronome BPM",
    tone: "Tone",
    toneTriangle: "Triangle",
    toneSine: "Sine",
    toneSquare: "Square",
    toneSawtooth: "Sawtooth",
    toneElectricPiano: "Electric piano",
    toneOrgan: "Organ",
    toneBell: "Bell",
    soundFontDropHint: "Drop or choose an .sf2 SoundFont",
    soundFontLoaded: "SoundFont loaded, click to replace",
    soundFontPreset: "Preset",
    soundFontLoading: "Loading…",
    soundFontError: "Could not read that SoundFont.",
    soundFontTone: "SoundFont",
    settings: "Settings",
    thresholdsTitle: "Judgement windows (ms)",
    perfect: "Perfect",
    good: "Good",
    bad: "Bad",
    miss: "Miss",
    extraMiss: "Wrong key",
    showAllKeys: "Show all 88 keys",
    leadSeconds: "Look-ahead",
    leadSecondsTitle: "How many seconds of upcoming notes the playfield shows.",
    calibration: "Latency calibration",
    calibrationTitle:
      "Judgement offset in ms. Audio output latency is compensated automatically; increase if hits feel late, decrease if early.",
    audioOffset: "Audio offset",
    audioOffsetTitle:
      "How much earlier (positive) or later (negative) the audio plays relative to the visuals, in ms. Fine-tune when automatic compensation is off.",
    barLines: "Bar lines",
    barLinesTitle: "Show measure separators on the playfield.",
    keyHint: "Key hints",
    keyHintAuto: "Auto",
    keyHintShow: "Show",
    keyHintHide: "Hide",
    midiUnsupported: "Web MIDI is not supported in this browser; the QWERTY keyboard still works.",
    start: "Start",
    pause: "Pause",
    resume: "Resume",
    stop: "Stop",
    restart: "Restart",
    exportRecord: "Export performed MIDI",
    fullscreen: "Fullscreen",
    exitFullscreen: "Exit fullscreen",
    combo: "Combo",
    score: "Score",
    countIn: "Count-in",
    noScore: "Import a MIDI file first to play in judged mode.",
    restartHint: "Saved; takes effect after you restart.",
    emptyScore: "This MIDI has no notes in the 88-key piano range.",
    exportEmpty: "Nothing to export yet.",
    exported: "Performed MIDI exported.",
    loadError: "Could not read that MIDI file.",
    finished: "Finished.",
    freeHint: "Metronome BPM is the export tempo.",
    perfectTitle: "Offset within this window is judged Perfect.",
    goodTitle: "Offset within this window is judged Good.",
    badTitle: "Offset within this window is judged Bad; beyond it is a Miss.",
    playbackOnlyTitle: "Replay the MIDI without judging or recording.",
    metronomeTitle: "Tick on every beat while playing.",
    muteSourceTitle: "Silence all app audio, for a piano with its own sound source.",
    showAllKeysTitle: "Show the full 88-key piano instead of only the score's range.",
    keyHintTitle: "Auto: only without MIDI; Show: always; Hide: never.",
  },
  "zh-Hans": {
    load: "导入 MIDI",
    dropHint: "拖放 .mid 文件到这里，或点击选择",
    chooseFile: "选择文件",
    removeFile: "移除",
    scoreInfo: "谱面",
    notes: "音符",
    baseBpm: "基准 BPM",
    tracks: "轨道",
    range: "音域",
    mode: "模式",
    judgeMode: "判定模式",
    freeMode: "自由录音",
    playbackOnly: "回放模式",
    speed: "倍速",
    metronome: "节拍器",
    soundMode: "音源",
    soundModePress: "按下时播放音源",
    soundModeAuto: "自动播放音源",
    muteSource: "静音音源",
    metronomeBpm: "节拍器 BPM",
    tone: "音色",
    toneTriangle: "三角波",
    toneSine: "正弦波",
    toneSquare: "方波",
    toneSawtooth: "锯齿波",
    toneElectricPiano: "电钢琴",
    toneOrgan: "管风琴",
    toneBell: "铃",
    soundFontDropHint: "拖入或选择 .sf2 音色库",
    soundFontLoaded: "SoundFont 已加载，点击更换",
    soundFontPreset: "预设",
    soundFontLoading: "加载中…",
    soundFontError: "无法读取该 SoundFont。",
    soundFontTone: "SoundFont",
    settings: "设置",
    thresholdsTitle: "判定阈值（毫秒）",
    perfect: "完美",
    good: "良好",
    bad: "差",
    miss: "漏",
    extraMiss: "弹错",
    showAllKeys: "显示全部 88 键",
    leadSeconds: "显示时长",
    leadSecondsTitle: "画面上方显示未来多少秒的音符。",
    calibration: "延迟校准",
    calibrationTitle: "判定偏移（毫秒）。音频输出延迟已自动补偿；若整体偏晚调大，偏早调小。",
    audioOffset: "音频偏移",
    audioOffsetTitle: "声音相对画面提前（正）或延后（负）的毫秒数；自动补偿不准时手动微调。",
    barLines: "小节线",
    barLinesTitle: "在画面上显示小节分隔线。",
    keyHint: "键位提示",
    keyHintAuto: "自动",
    keyHintShow: "显示",
    keyHintHide: "隐藏",
    midiUnsupported: "当前浏览器不支持 Web MIDI，可使用 QWERTY 键盘。",
    start: "开始",
    pause: "暂停",
    resume: "继续",
    stop: "停止",
    restart: "重开",
    exportRecord: "导出演奏 MIDI",
    fullscreen: "全屏游玩",
    exitFullscreen: "退出全屏",
    combo: "连击",
    score: "得分",
    countIn: "预备拍",
    noScore: "请先导入 MIDI 文件再进入判定模式。",
    restartHint: "已保存，重新开始后生效。",
    emptyScore: "该 MIDI 在 88 键范围内没有音符。",
    exportEmpty: "还没有可导出的演奏。",
    exported: "演奏 MIDI 已导出。",
    loadError: "读取 MIDI 文件失败。",
    finished: "已结束。",
    freeHint: "节拍器 BPM 即导出节奏。",
    perfectTitle: "偏差在这个毫秒数内判为完美。",
    goodTitle: "偏差在这个毫秒数内判为良好。",
    badTitle: "偏差在这个毫秒数内判为差，超过则判为漏。",
    playbackOnlyTitle: "只回放 MIDI，不判定也不录音。",
    metronomeTitle: "演奏过程中每拍响一下节拍器。",
    muteSourceTitle: "关闭应用发出的所有声音（适合电钢琴自带音源）。",
    showAllKeysTitle: "显示完整 88 键，而不是只显示谱面用到的音域。",
    keyHintTitle: "自动：无 MIDI 时显示；显示：始终显示；隐藏：不显示。",
  },
} satisfies Record<GameLanguage, Labels>;

const props = defineProps<{
  language: GameLanguage;
}>();

const text = computed(() => labels[props.language]);

const DEFAULT_LEAD_SECONDS = 3;
const LEAD_MIN_SECONDS = 1;
const LEAD_MAX_SECONDS = 6;
const CALIBRATION_MIN_MS = -200;
const CALIBRATION_MAX_MS = 200;
const AUDIO_OFFSET_MIN_MS = -300;
const AUDIO_OFFSET_MAX_MS = 300;
const KEYBOARD_VELOCITY = 0.8;
const BLACK_KEY_RATIO = 0.62;
const KEY_BAND_HEIGHT = 62;
const COUNT_IN_BEATS = 4;
const OCTAVE_SHIFT_MIN = -1;
const OCTAVE_SHIFT_MAX = 6;
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const WHITE_KEY = "#f8fafc";
const BLACK_KEY = "#1e293b";
const KEY_BORDER = "#94a3b8";
const KEY_LABEL = "#475569";
const ACTIVE_KEY = "rgba(245, 158, 11, 0.55)";
const NOTE_WHITE_KEY = "rgba(56, 189, 248, 0.9)";
const NOTE_BLACK_KEY = "rgba(129, 140, 248, 0.9)";
const JUDGMENT_LINE = "#f59e0b";
const BAR_LINE = "rgba(148, 163, 184, 0.35)";

const canvasRef = ref<HTMLCanvasElement>();
const stageRef = ref<HTMLElement>();

const score = ref<ParsedScore>();
const fileName = ref("");
const errorMessage = ref("");
const isDropTarget = ref(false);
const isSoundFontDropTarget = ref(false);

const playMode = ref<PlayMode>("judge");
const playbackOnly = ref(false);
const activePlaybackOnly = ref(false);
const activeSoundMode = ref<SoundMode>("press");
const speed = ref(DEFAULT_SPEED);
const metronomeBpm = ref(DEFAULT_METRONOME_BPM);
const metronomeEnabled = ref(false);
const soundMode = ref<SoundMode>("press");
const muteSource = ref(false);
const pendingRestart = ref(false);
const showAllKeys = ref(false);
const leadSeconds = ref(DEFAULT_LEAD_SECONDS);
const showBarLines = ref(true);
const calibrationMs = ref(0);
const audioOffsetMs = ref(0);
const thresholdText = ref<ThresholdInputText>({
  perfectMs: String(DEFAULT_PERFECT_MS),
  goodMs: String(DEFAULT_GOOD_MS),
  badMs: String(DEFAULT_BAD_MS),
});
const thresholds = ref<JudgementThresholds>({
  perfectMs: DEFAULT_PERFECT_MS,
  goodMs: DEFAULT_GOOD_MS,
  badMs: DEFAULT_BAD_MS,
});
const octaveShift = ref(0);

const isPlaying = ref(false);
const isPaused = ref(false);
const isFullscreen = ref(false);
const midiSupported = ref(false);
const keyHintMode = ref<KeyHintMode>("auto");
const tonePreset = ref<TonePreset>("electric-piano");
const soundFontPresets = ref<SfumatoPreset[]>([]);
const soundFontPresetIndex = ref(0);
const soundFontLoading = ref(false);
const soundFontError = ref("");

const stats = ref<JudgementStats>(createEmptyStats());
const lastTier = ref<"perfect" | "good" | "bad">();
const announcement = ref("");
const activeKeys = ref<Set<number>>(new Set());
const hasRecording = ref(false);
const isCountingIn = ref(false);
const countInBeatsLeft = ref(0);

const effectiveBpmValue = computed(() => {
  const base = score.value?.baseBpm ?? DEFAULT_METRONOME_BPM;
  return playMode.value === "free" ? metronomeBpm.value : effectiveBpm(base, clampSpeed(speed.value));
});
const scorePercent = computed(() => {
  const total = score.value?.notes.length ?? 0;
  return total > 0 ? (stats.value.score / total) * 100 : 0;
});
const canExport = computed(() => isPlaying.value || hasRecording.value);
const showKeyLabels = computed(
  () => keyHintMode.value === "show" || (keyHintMode.value === "auto" && !midiSupported.value),
);
const effectivePlaybackOnly = computed(() => {
  const source = isPlaying.value || isPaused.value ? activePlaybackOnly.value : playbackOnly.value;
  return source && playMode.value === "judge";
});
const effectiveSoundMode = computed<SoundMode>(() => {
  if (playMode.value === "free") {
    return "press";
  }
  if (effectivePlaybackOnly.value) {
    return "auto";
  }
  return isPlaying.value || isPaused.value ? activeSoundMode.value : soundMode.value;
});
const displayedSoundMode = computed<SoundMode>(() => {
  if (playMode.value === "free") {
    return "press";
  }
  if (effectivePlaybackOnly.value) {
    return "auto";
  }
  return soundMode.value;
});
const mutedSource = computed(() => muteSource.value && !effectivePlaybackOnly.value);
const effectiveKeySound = computed(() => !mutedSource.value && effectiveSoundMode.value === "press");
const effectiveAutoPlayMidi = computed(() => !mutedSource.value && effectiveSoundMode.value === "auto");
const soundControlLocked = computed(
  () => mutedSource.value || playMode.value === "free" || effectivePlaybackOnly.value,
);
const muteToggleDisabled = computed(() => effectivePlaybackOnly.value);

let engine: JudgementEngine | undefined;
let wallNotes: { midi: number; time: number }[] = [];
let feedback: { midi: number; kind: FeedbackKind; until: number }[] = [];
let recording = new RecordingBuffer();
let accumulatedWall = 0;
let activeSpeed = DEFAULT_SPEED;
let playStart = 0;
let lastFrameAt = 0;
let lastWallPosition = 0;
let rafId = 0;
let nextMelodyIndex = 0;
let nextPlaybackIndex = 0;
let nextMetronomeTime = 0;
let metronomeInterval = 0.5;
let lastAnnounceTime = 0;
let audioBaseTime = 0;
let countInTotal = 0;
let countInStart = 0;
let resizeObserver: ResizeObserver | undefined;
let audioContext: AudioContext | undefined;
let masterGain: GainNode | undefined;
let melodyGain: GainNode | undefined;
let metronomeGain: GainNode | undefined;
const heldKeys = new Map<string, number>();

onMounted(() => {
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  document.addEventListener("fullscreenchange", onFullscreenChange);
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("pagehide", onPageHide);
  resizeObserver = new ResizeObserver(() => {
    resizeCanvas();
    draw(null);
  });
  if (canvasRef.value) {
    resizeObserver.observe(canvasRef.value);
  }
  resizeCanvas();
  void initMidi();
  draw(null);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("keyup", onKeyUp);
  document.removeEventListener("fullscreenchange", onFullscreenChange);
  document.removeEventListener("visibilitychange", onVisibilityChange);
  window.removeEventListener("pagehide", onPageHide);
  resizeObserver?.disconnect();
  cancelAnimationFrame(rafId);
  isPlaying.value = false;
  isPaused.value = false;
  void closeAudio();
});

function resizeCanvas() {
  const canvas = canvasRef.value;
  if (!canvas) {
    return;
  }
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
  canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
}

function onFullscreenChange() {
  isFullscreen.value = document.fullscreenElement !== null;
}

function midiToName(midi: number): string {
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

function isWhiteKey(midi: number): boolean {
  const pitchClass = midi % 12;
  return pitchClass !== 1 && pitchClass !== 3 && pitchClass !== 6 && pitchClass !== 8 && pitchClass !== 10;
}

function countWhiteKeys(minMidi: number, maxMidi: number): number {
  let count = 0;
  for (let midi = minMidi; midi <= maxMidi; midi += 1) {
    if (isWhiteKey(midi)) {
      count += 1;
    }
  }
  return count;
}

function visibleRange(): [number, number] {
  if (showAllKeys.value) {
    return [PIANO_MIN_MIDI, PIANO_MAX_MIDI];
  }
  if (score.value && score.value.notes.length > 0) {
    return [Math.max(PIANO_MIN_MIDI, score.value.minMidi - 12), Math.min(PIANO_MAX_MIDI, score.value.maxMidi + 12)];
  }
  return [36, 72];
}

interface Lane {
  midi: number;
  x: number;
  width: number;
  isWhite: boolean;
}

function buildLanes(minMidi: number, maxMidi: number, whiteWidth: number): Map<number, Lane> {
  const lanes = new Map<number, Lane>();
  const blackWidth = whiteWidth * BLACK_KEY_RATIO;
  let whiteIndex = 0;
  for (let midi = minMidi; midi <= maxMidi; midi += 1) {
    if (isWhiteKey(midi)) {
      lanes.set(midi, { midi, x: whiteIndex * whiteWidth, width: whiteWidth, isWhite: true });
      whiteIndex += 1;
    } else {
      const centerX = whiteIndex * whiteWidth;
      lanes.set(midi, { midi, x: centerX - blackWidth / 2, width: blackWidth, isWhite: false });
    }
  }
  return lanes;
}

// --- File loading ---

function onScoreFileChange(event: Event) {
  const input = event.currentTarget;
  if (input instanceof HTMLInputElement) {
    loadScoreFile(input.files?.[0]);
    input.value = "";
  }
}

function onDrop(event: DragEvent) {
  isDropTarget.value = false;
  loadScoreFile(event.dataTransfer?.files[0]);
}

function leaveDropZone(event: DragEvent) {
  const zone = event.currentTarget;
  if (zone instanceof HTMLElement && !zone.contains(event.relatedTarget as Node | null)) {
    isDropTarget.value = false;
  }
}

function onSoundFontDrop(event: DragEvent) {
  isSoundFontDropTarget.value = false;
  void loadSoundFontFile(event.dataTransfer?.files[0]);
}

function leaveSoundFontDropZone(event: DragEvent) {
  const zone = event.currentTarget;
  if (zone instanceof HTMLElement && !zone.contains(event.relatedTarget as Node | null)) {
    isSoundFontDropTarget.value = false;
  }
}

async function loadScoreFile(file: File | undefined) {
  if (!file) {
    return;
  }
  errorMessage.value = "";
  try {
    const parsed = parseMidiScore(await file.arrayBuffer());
    score.value = parsed;
    fileName.value = file.name;
    playMode.value = "judge";
    if (parsed.notes.length === 0) {
      errorMessage.value = text.value.emptyScore;
    }
    stop();
    draw(null);
  } catch {
    errorMessage.value = text.value.loadError;
  }
}

function removeScore() {
  score.value = undefined;
  fileName.value = "";
  stop();
  draw(null);
}

function onSoundFontFileChange(event: Event) {
  const input = event.currentTarget;
  if (input instanceof HTMLInputElement) {
    void loadSoundFontFile(input.files?.[0]);
    input.value = "";
  }
}

async function loadSoundFontFile(file: File | undefined) {
  if (!file) {
    return;
  }
  ensureAudio();
  soundFontError.value = "";
  soundFontLoading.value = true;
  const url = URL.createObjectURL(file);
  try {
    const parsed = await loadSoundfont(url);
    soundFontPresets.value = parsed.presets;
    soundFontPresetIndex.value = 0;
    tonePreset.value = "soundfont";
  } catch {
    soundFontError.value = text.value.soundFontError;
  } finally {
    soundFontLoading.value = false;
    URL.revokeObjectURL(url);
  }
}

// --- Audio ---

function ensureAudio() {
  if (audioContext) {
    return;
  }
  const Context = window.AudioContext;
  audioContext = new Context();
  masterGain = audioContext.createGain();
  masterGain.gain.value = 0.9;
  masterGain.connect(audioContext.destination);
  melodyGain = audioContext.createGain();
  melodyGain.connect(masterGain);
  metronomeGain = audioContext.createGain();
  metronomeGain.connect(masterGain);
}

async function ensureAudioRunning() {
  ensureAudio();
  if (audioContext?.state === "suspended") {
    await audioContext.resume();
  }
}

function outputLatencySeconds(): number {
  return audioContext?.outputLatency ?? audioContext?.baseLatency ?? 0;
}

async function closeAudio() {
  if (audioContext) {
    await audioContext.close();
    audioContext = undefined;
    masterGain = undefined;
    melodyGain = undefined;
    metronomeGain = undefined;
  }
}

function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function playTone(frequency: number, when: number, duration: number, velocity: number, destination: GainNode) {
  if (!audioContext) {
    return;
  }
  const preset = tonePreset.value;
  const peak = 0.05 + velocity * 0.22;
  if (preset === "electric-piano") {
    playElectricPiano(frequency, when, duration, peak, destination);
    return;
  }
  if (preset === "organ") {
    playOrgan(frequency, when, duration, peak, destination);
    return;
  }
  if (preset === "bell") {
    playBell(frequency, when, duration, peak, destination);
    return;
  }
  if (preset === "soundfont") {
    return;
  }
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = preset;
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.linearRampToValueAtTime(peak, when + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
  oscillator.connect(gain);
  gain.connect(destination);
  oscillator.start(when);
  oscillator.stop(when + duration + 0.05);
}

function playNote(midi: number, when: number, duration: number, velocity: number, destination: GainNode) {
  if (!audioContext) {
    return;
  }
  if (tonePreset.value === "soundfont") {
    const preset = soundFontPresets.value[soundFontPresetIndex.value];
    if (preset) {
      const stop = startPresetNote(audioContext, preset, midi, when);
      stop(when + duration);
    }
    return;
  }
  playTone(midiToFrequency(midi), when, duration, velocity, destination);
}

function playElectricPiano(frequency: number, when: number, duration: number, peak: number, destination: GainNode) {
  if (!audioContext) {
    return;
  }
  const carrier = audioContext.createOscillator();
  const modulator = audioContext.createOscillator();
  const modGain = audioContext.createGain();
  const gain = audioContext.createGain();
  carrier.type = "sine";
  carrier.frequency.value = frequency;
  modulator.type = "sine";
  modulator.frequency.value = frequency * 2;
  modGain.gain.value = frequency * 1.4;
  modulator.connect(modGain);
  modGain.connect(carrier.frequency);
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.linearRampToValueAtTime(peak, when + 0.005);
  gain.gain.exponentialRampToValueAtTime(peak * 0.3, when + 0.1);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
  carrier.connect(gain);
  gain.connect(destination);
  carrier.start(when);
  modulator.start(when);
  carrier.stop(when + duration + 0.05);
  modulator.stop(when + duration + 0.05);
}

function playOrgan(frequency: number, when: number, duration: number, peak: number, destination: GainNode) {
  if (!audioContext) {
    return;
  }
  const gain = audioContext.createGain();
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.linearRampToValueAtTime(peak, when + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
  gain.connect(destination);
  const weights = [1, 0.5, 0.3, 0.15];
  for (let index = 0; index < weights.length; index += 1) {
    const oscillator = audioContext.createOscillator();
    const harmonicGain = audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency * (index + 1);
    harmonicGain.gain.value = weights[index];
    oscillator.connect(harmonicGain);
    harmonicGain.connect(gain);
    oscillator.start(when);
    oscillator.stop(when + duration + 0.05);
  }
}

function playBell(frequency: number, when: number, duration: number, peak: number, destination: GainNode) {
  if (!audioContext) {
    return;
  }
  const carrier = audioContext.createOscillator();
  const modulator = audioContext.createOscillator();
  const modGain = audioContext.createGain();
  const gain = audioContext.createGain();
  carrier.type = "sine";
  carrier.frequency.value = frequency;
  modulator.type = "sine";
  modulator.frequency.value = frequency * 2.76;
  modGain.gain.value = frequency * 2;
  modulator.connect(modGain);
  modGain.connect(carrier.frequency);
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.linearRampToValueAtTime(peak, when + 0.003);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + duration * 1.5);
  carrier.connect(gain);
  gain.connect(destination);
  carrier.start(when);
  modulator.start(when);
  carrier.stop(when + duration * 1.5 + 0.05);
  modulator.stop(when + duration * 1.5 + 0.05);
}

function playClick(when: number) {
  if (!audioContext || !metronomeGain) {
    return;
  }
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = "square";
  oscillator.frequency.value = 1600;
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.linearRampToValueAtTime(0.07, when + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.03);
  oscillator.connect(gain);
  gain.connect(metronomeGain);
  oscillator.start(when);
  oscillator.stop(when + 0.04);
}

// --- Playback control ---

function countInRemaining(): number {
  return Math.max(0, countInTotal - (performance.now() - countInStart) / 1000);
}

function currentWallTime(): number {
  if (isCountingIn.value) {
    return accumulatedWall - countInRemaining();
  }
  return accumulatedWall + (isPlaying.value ? (performance.now() - playStart) / 1000 : 0);
}

async function start() {
  if (isPlaying.value) {
    return;
  }
  if (playMode.value === "judge" && !score.value) {
    errorMessage.value = text.value.noScore;
    return;
  }
  await ensureAudioRunning();
  resetForPlay();
  metronomeInterval = computeMetronomeInterval();
  countInTotal = COUNT_IN_BEATS * metronomeInterval;
  countInStart = performance.now();
  audioBaseTime = (audioContext?.currentTime ?? 0) - outputLatencySeconds();
  accumulatedWall = 0;
  isCountingIn.value = true;
  isPlaying.value = true;
  isPaused.value = false;
  playStart = performance.now();
  nextMelodyIndex = 0;
  nextPlaybackIndex = 0;
  nextMetronomeTime = -countInTotal;
  announcement.value = "";
  pendingRestart.value = false;
  lastFrameAt = 0;
  rafId = requestAnimationFrame(renderLoop);
}

function onVisibilityChange() {
  if (document.hidden && isPlaying.value) {
    pause();
  }
}

function onPageHide() {
  if (isPlaying.value) {
    pause();
  }
}

function pause() {
  if (!isPlaying.value) {
    return;
  }
  if (!isCountingIn.value) {
    accumulatedWall += (performance.now() - playStart) / 1000;
  }
  isPlaying.value = false;
  isPaused.value = true;
  cancelAnimationFrame(rafId);
  lastFrameAt = 0;
  if (audioContext?.state === "running") {
    void audioContext.suspend();
  }
}

async function resume() {
  if (isPlaying.value) {
    return;
  }
  await ensureAudioRunning();
  metronomeInterval = computeMetronomeInterval();
  countInTotal = COUNT_IN_BEATS * metronomeInterval;
  countInStart = performance.now();
  audioBaseTime = (audioContext?.currentTime ?? 0) - outputLatencySeconds();
  nextMetronomeTime = accumulatedWall - countInTotal;
  isCountingIn.value = true;
  isPlaying.value = true;
  isPaused.value = false;
  lastFrameAt = 0;
  rafId = requestAnimationFrame(renderLoop);
}

function stop() {
  cancelAnimationFrame(rafId);
  lastFrameAt = 0;
  isPlaying.value = false;
  isPaused.value = false;
  accumulatedWall = 0;
  engine = undefined;
  wallNotes = [];
  feedback = [];
  nextMelodyIndex = 0;
  nextPlaybackIndex = 0;
  recording = new RecordingBuffer();
  stats.value = createEmptyStats();
  lastTier.value = undefined;
  activeKeys.value = new Set();
  hasRecording.value = false;
  isCountingIn.value = false;
  countInBeatsLeft.value = 0;
  pendingRestart.value = false;
  if (audioContext?.state === "running") {
    void audioContext.suspend();
  }
  draw(null);
}

function resetForPlay() {
  activePlaybackOnly.value = playbackOnly.value;
  activeSoundMode.value = soundMode.value;
  recording.reset();
  stats.value = createEmptyStats();
  lastTier.value = undefined;
  activeKeys.value = new Set();
  hasRecording.value = false;
  feedback = [];
  wallNotes = [];
  nextPlaybackIndex = 0;
  engine = undefined;
  if (playMode.value === "judge" && score.value) {
    const currentSpeed = clampSpeed(speed.value);
    activeSpeed = currentSpeed;
    wallNotes = score.value.notes.map((note) => ({ midi: note.midi, time: noteWallTime(note.time, currentSpeed) }));
    if (!playbackOnly.value) {
      engine = new JudgementEngine(wallNotes, thresholds.value);
    }
  }
}

function markConfigChanged() {
  if (isPlaying.value || isPaused.value) {
    pendingRestart.value = true;
  }
}

function commitThresholds() {
  thresholds.value = parseThresholds(thresholdText.value);
  thresholdText.value = {
    perfectMs: String(thresholds.value.perfectMs),
    goodMs: String(thresholds.value.goodMs),
    badMs: String(thresholds.value.badMs),
  };
  markConfigChanged();
}

function computeMetronomeInterval(): number {
  if (playMode.value === "free") {
    return 60 / metronomeBpm.value;
  }
  return 60 / effectiveBpm(score.value?.baseBpm ?? 120, activeSpeed);
}

/** Keep the score position while changing speed mid-run (used by playback mode). */
function rebaseTimeline(newSpeed: number) {
  if ((!isPlaying.value && !isPaused.value) || isCountingIn.value || playMode.value !== "judge" || !score.value) {
    return;
  }
  if (newSpeed === activeSpeed) {
    return;
  }
  const scoreTime = currentWallTime() * activeSpeed;
  activeSpeed = newSpeed;
  wallNotes = score.value.notes.map((note) => ({ midi: note.midi, time: noteWallTime(note.time, newSpeed) }));
  accumulatedWall = scoreTime / newSpeed;
  playStart = performance.now();
  audioBaseTime = (audioContext?.currentTime ?? 0) - outputLatencySeconds();
  // The count-in offset no longer applies once the audio base is re-anchored to "now".
  countInTotal = 0;
  metronomeInterval = computeMetronomeInterval();
  nextMelodyIndex = wallNotes.findIndex((note) => note.time >= accumulatedWall);
  if (nextMelodyIndex < 0) {
    nextMelodyIndex = wallNotes.length;
  }
  nextPlaybackIndex = nextMelodyIndex;
  nextMetronomeTime = Math.ceil(accumulatedWall / metronomeInterval) * metronomeInterval;
}

function onSpeedInput(event: Event) {
  const target = event.currentTarget;
  if (!(target instanceof HTMLInputElement)) {
    return;
  }
  const value = clampSpeed(Number(target.value));
  if (effectivePlaybackOnly.value && (isPlaying.value || isPaused.value)) {
    rebaseTimeline(value);
    return;
  }
  markConfigChanged();
}

function finish() {
  const playbackOnlyRun = effectivePlaybackOnly.value;
  cancelAnimationFrame(rafId);
  isPlaying.value = false;
  isPaused.value = false;
  if (playMode.value === "judge" && !playbackOnlyRun) {
    announcement.value = `${text.value.finished} ${text.value.score} ${scorePercent.value.toFixed(1)}%`;
  }
  draw(null);
}

function renderLoop() {
  const frameAt = performance.now();
  if (isPlaying.value && !isCountingIn.value && lastFrameAt > 0 && frameAt - lastFrameAt > 800) {
    // The tab was hidden or the page was suspended: freeze at the last frame instead of
    // fast-forwarding and dumping every overdue note on top of itself.
    playStart = frameAt - (lastWallPosition - accumulatedWall) * 1000;
    pause();
    return;
  }
  lastFrameAt = frameAt;
  if (isCountingIn.value) {
    const remaining = countInRemaining();
    if (remaining <= 0) {
      isCountingIn.value = false;
      countInBeatsLeft.value = 0;
      playStart = performance.now();
    } else {
      countInBeatsLeft.value = Math.max(0, Math.ceil(remaining / metronomeInterval - 0.001));
    }
  }
  const now = currentWallTime();
  lastWallPosition = now;
  if (engine) {
    applyResults(engine.advance(now - calibrationMs.value / 1000));
  } else if (effectivePlaybackOnly.value) {
    advancePlayback(now);
  }
  const songEnd = score.value ? score.value.duration / activeSpeed + 1 : Number.POSITIVE_INFINITY;
  if (playMode.value === "judge" && now > songEnd) {
    finish();
    return;
  }
  scheduleMelody(now);
  scheduleMetronome(now);
  draw(now);
  rafId = requestAnimationFrame(renderLoop);
}

function scheduleMelody(now: number) {
  if (
    !audioContext ||
    !melodyGain ||
    !score.value ||
    playMode.value !== "judge" ||
    isCountingIn.value ||
    !effectiveAutoPlayMidi.value
  ) {
    return;
  }
  const lookahead = 0.15;
  while (nextMelodyIndex < wallNotes.length) {
    const entry = wallNotes[nextMelodyIndex];
    if (entry.time > now + lookahead) {
      break;
    }
    const source = score.value.notes[nextMelodyIndex];
    const audioTime = Math.max(
      audioContext.currentTime,
      audioBaseTime + entry.time - accumulatedWall + countInTotal - audioOffsetMs.value / 1000,
    );
    const duration = Math.min(Math.max(source.duration, 0.08), 2);
    playNote(entry.midi, audioTime, duration, source.velocity, melodyGain);
    nextMelodyIndex += 1;
  }
}

function scheduleMetronome(now: number) {
  if (!audioContext || !metronomeGain) {
    return;
  }
  if (!isCountingIn.value && !metronomeEnabled.value) {
    return;
  }
  const lookahead = 0.15;
  while (nextMetronomeTime <= now + lookahead) {
    // The count-in ticks exactly COUNT_IN_BEATS times; the first beat of play stays silent.
    if (isCountingIn.value && nextMetronomeTime >= accumulatedWall) {
      break;
    }
    const audioTime = Math.max(
      audioContext.currentTime,
      audioBaseTime + nextMetronomeTime - accumulatedWall + countInTotal - audioOffsetMs.value / 1000,
    );
    playClick(audioTime);
    nextMetronomeTime += metronomeInterval;
  }
}

// --- Input ---

async function initMidi() {
  if (typeof navigator === "undefined" || !navigator.requestMIDIAccess) {
    midiSupported.value = false;
    return;
  }
  try {
    const access = await navigator.requestMIDIAccess();
    for (const input of access.inputs.values()) {
      input.onmidimessage = onMidiMessage;
    }
    midiSupported.value = true;
  } catch {
    midiSupported.value = false;
  }
}

function onMidiMessage(event: MIDIMessageEvent) {
  const data = event.data;
  if (!data || data.length < 2) {
    return;
  }
  const status = data[0] & 0xf0;
  const note = data[1];
  const velocity = data.length > 2 ? data[2] : 0;
  if (status === 0x90 && velocity > 0) {
    noteOn(note, velocity / 127);
  } else if (status === 0x80 || (status === 0x90 && velocity === 0)) {
    noteOff(note);
  }
}

function onKeyDown(event: KeyboardEvent) {
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }
  const target = event.target;
  if (
    target instanceof HTMLElement &&
    (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")
  ) {
    return;
  }
  if (event.key === " ") {
    if (target instanceof HTMLElement && target.tagName === "BUTTON") {
      return;
    }
    event.preventDefault();
    togglePlay();
    return;
  }
  if (event.key === "z" || event.key === "ArrowLeft") {
    octaveShift.value = clampOctaveShift(octaveShift.value - 1);
    return;
  }
  if (event.key === "x" || event.key === "ArrowRight") {
    octaveShift.value = clampOctaveShift(octaveShift.value + 1);
    return;
  }
  const midi = keyToMidi(event.key, octaveShift.value);
  if (midi !== undefined && !event.repeat) {
    heldKeys.set(event.code, midi);
    noteOn(midi, KEYBOARD_VELOCITY);
  }
}

function onKeyUp(event: KeyboardEvent) {
  const midi = heldKeys.get(event.code);
  if (midi !== undefined) {
    heldKeys.delete(event.code);
    noteOff(midi);
  }
}

function clampOctaveShift(value: number): number {
  return Math.min(Math.max(value, OCTAVE_SHIFT_MIN), OCTAVE_SHIFT_MAX);
}

function noteOn(midi: number, velocity: number) {
  if (!isPlaying.value || isCountingIn.value) {
    return;
  }
  const now = currentWallTime();
  activeKeys.value.add(midi);
  recording.noteOn(now, midi, velocity);
  hasRecording.value = true;
  if (effectiveKeySound.value && audioContext && melodyGain) {
    playNote(midi, audioContext.currentTime, 0.35, velocity, melodyGain);
  }
  if (engine) {
    const judgeNow = now - calibrationMs.value / 1000;
    applyResults(engine.advance(judgeNow));
    applyResults([engine.press(judgeNow, midi)]);
  }
}

function noteOff(midi: number) {
  if (!isPlaying.value || isCountingIn.value) {
    return;
  }
  activeKeys.value.delete(midi);
  recording.noteOff(currentWallTime(), midi);
}

function togglePlay() {
  if (isPlaying.value) {
    pause();
  } else if (isPaused.value) {
    void resume();
  } else {
    void start();
  }
}

function onPrimaryAction() {
  if (isPlaying.value || isPaused.value) {
    stop();
    return;
  }
  void start();
}

function togglePause() {
  if (isPlaying.value) {
    pause();
  } else if (isPaused.value) {
    void resume();
  }
}

// --- Judgement feedback ---

function applyResults(results: JudgementResult[]) {
  const now = currentWallTime();
  for (const result of results) {
    stats.value = applyResult(stats.value, result);
    handleJudgement(result, now);
  }
}

/** Playback mode: light up held notes and score every note as a perfect hit. */
function advancePlayback(now: number) {
  if (!score.value) {
    return;
  }
  while (nextPlaybackIndex < wallNotes.length) {
    const note = wallNotes[nextPlaybackIndex];
    if (!note || note.time > now) {
      break;
    }
    applyResults([{ type: "hit", tier: "perfect", midi: note.midi, noteTime: note.time, offsetSeconds: 0 }]);
    nextPlaybackIndex += 1;
  }
  const speedFactor = activeSpeed;
  activeKeys.value.clear();
  for (const note of score.value.notes) {
    if (note.time / speedFactor > now) {
      break;
    }
    if (now < (note.time + note.duration) / speedFactor) {
      activeKeys.value.add(note.midi);
    }
  }
}

function handleJudgement(result: JudgementResult, now: number) {
  if (result.type === "hit") {
    lastTier.value = result.tier;
    pushFeedback(result.midi, result.tier);
    if (now - lastAnnounceTime > 1) {
      lastAnnounceTime = now;
      announcement.value = tierLabel(result.tier);
    }
  } else if (result.type === "missed") {
    pushFeedback(result.midi, "miss");
    announcement.value = text.value.miss;
  } else {
    announcement.value = text.value.extraMiss;
  }
}

function tierLabel(tier: "perfect" | "good" | "bad"): string {
  if (tier === "perfect") {
    return text.value.perfect;
  }
  if (tier === "good") {
    return text.value.good;
  }
  return text.value.bad;
}

function pushFeedback(midi: number, kind: FeedbackKind) {
  feedback.push({ midi, kind, until: currentWallTime() + 0.3 });
}

// --- Recording export ---

function exportRecording() {
  const notes = recording.snapshot();
  if (notes.length === 0) {
    errorMessage.value = text.value.exportEmpty;
    return;
  }
  const tempo = playMode.value === "judge" && score.value ? score.value.tempos : metronomeBpm.value;
  const bytes = encodeMidi(notes, tempo);
  const blob = new Blob([new Uint8Array(bytes)], { type: "audio/midi" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const base = fileName.value || "recording";
  link.href = url;
  link.download = `${base.replace(/\.midi?$/i, "")}-record.mid`;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  announcement.value = text.value.exported;
}

// --- Fullscreen ---

async function toggleFullscreen() {
  const stage = stageRef.value;
  if (!stage) {
    return;
  }
  if (document.fullscreenElement) {
    await document.exitFullscreen();
  } else {
    await stage.requestFullscreen();
  }
}

// --- Rendering ---

function draw(now: number | null) {
  const canvas = canvasRef.value;
  if (!canvas) {
    return;
  }
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }
  const dpr = window.devicePixelRatio || 1;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width <= 0 || height <= 0) {
    return;
  }
  context.clearRect(0, 0, width, height);

  const [minMidi, maxMidi] = visibleRange();
  const whiteWidth = width / countWhiteKeys(minMidi, maxMidi);
  const lanes = buildLanes(minMidi, maxMidi, whiteWidth);
  const judgmentY = height - KEY_BAND_HEIGHT;

  if (now !== null) {
    const pixelsPerSecond = judgmentY / leadSeconds.value;
    const noteHeight = Math.max(5, whiteWidth * 0.72);
    if (showBarLines.value && score.value) {
      const speedFactor = activeSpeed;
      context.strokeStyle = BAR_LINE;
      context.lineWidth = 1;
      for (const barTime of score.value.barTimes) {
        const y = judgmentY - (barTime / speedFactor - now) * pixelsPerSecond;
        if (y < 0 || y > judgmentY) {
          continue;
        }
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(width, y);
        context.stroke();
      }
    }
    for (const entry of wallNotes) {
      if (entry.time < accumulatedWall - 0.001) {
        continue;
      }
      const lane = lanes.get(entry.midi);
      if (!lane) {
        continue;
      }
      const y = judgmentY - (entry.time - now) * pixelsPerSecond;
      if (y < -noteHeight || y > judgmentY) {
        continue;
      }
      context.fillStyle = lane.isWhite ? NOTE_WHITE_KEY : NOTE_BLACK_KEY;
      context.fillRect(lane.x + 1, y, lane.width - 2, noteHeight);
    }
    context.strokeStyle = JUDGMENT_LINE;
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(0, judgmentY);
    context.lineTo(width, judgmentY);
    context.stroke();

    feedback = feedback.filter((entry) => entry.until > now);
    for (const entry of feedback) {
      const lane = lanes.get(entry.midi);
      if (!lane) {
        continue;
      }
      context.fillStyle = feedbackColor(entry.kind);
      context.globalAlpha = 0.55;
      context.fillRect(lane.x, judgmentY - noteHeight, lane.width, noteHeight);
      context.globalAlpha = 1;
    }
  }

  drawKeys(context, lanes, judgmentY, showKeyLabels.value, octaveShift.value);
}

function drawKeys(
  context: CanvasRenderingContext2D,
  lanes: Map<number, Lane>,
  topY: number,
  showKeyLabels: boolean,
  octaveShift: number,
) {
  const blackHeight = KEY_BAND_HEIGHT * 0.62;
  for (const lane of lanes.values()) {
    if (lane.isWhite) {
      drawKey(context, lane, topY, KEY_BAND_HEIGHT, showKeyLabels ? midiToKeyLabel(lane.midi, octaveShift) : undefined);
    }
  }
  for (const lane of lanes.values()) {
    if (!lane.isWhite) {
      drawKey(context, lane, topY, blackHeight, showKeyLabels ? midiToKeyLabel(lane.midi, octaveShift) : undefined);
    }
  }
}

function drawKey(context: CanvasRenderingContext2D, lane: Lane, topY: number, bandHeight: number, keyLabel?: string) {
  context.fillStyle = lane.isWhite ? WHITE_KEY : BLACK_KEY;
  context.fillRect(lane.x, topY, lane.width, bandHeight);
  context.strokeStyle = KEY_BORDER;
  context.lineWidth = 1;
  context.strokeRect(lane.x + 0.5, topY + 0.5, lane.width - 1, bandHeight - 1);
  if (activeKeys.value.has(lane.midi)) {
    context.fillStyle = ACTIVE_KEY;
    context.fillRect(lane.x, topY, lane.width, bandHeight);
  }
  if (lane.isWhite && lane.midi % 12 === 0) {
    context.fillStyle = KEY_LABEL;
    context.font = "10px sans-serif";
    context.textAlign = "center";
    context.fillText(`C${Math.floor(lane.midi / 12) - 1}`, lane.x + lane.width / 2, topY + 11);
  }
  if (keyLabel) {
    context.fillStyle = lane.isWhite ? KEY_LABEL : "#e2e8f0";
    context.font = `bold ${Math.max(9, Math.min(13, Math.round(lane.width * 0.62)))}px sans-serif`;
    context.textAlign = "center";
    context.fillText(keyLabel, lane.x + lane.width / 2, topY + bandHeight - 5);
  }
}

function feedbackColor(kind: FeedbackKind): string {
  if (kind === "perfect") {
    return "#f59e0b";
  }
  if (kind === "good") {
    return "#22c55e";
  }
  if (kind === "bad") {
    return "#f97316";
  }
  return "#ef4444";
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}
</script>

<template>
  <div class="midi-rhythm">
    <p
      class="midi-rhythm__sr"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {{ announcement }}
    </p>

    <div
      v-show="!isFullscreen"
      class="midi-rhythm__panels"
    >
      <section
        class="midi-rhythm__panel midi-rhythm__panel--full"
        aria-labelledby="midi-rhythm-load-title"
      >
        <div class="midi-rhythm__label-row">
          <h2 id="midi-rhythm-load-title">
            {{ text.load }}
          </h2>
          <span v-if="score">{{ fileName }}</span>
        </div>
        <input
          id="midi-rhythm-score-file"
          accept=".mid,.midi,audio/midi"
          class="midi-rhythm__file-input"
          type="file"
          @change="onScoreFileChange"
        >
        <label
          class="midi-rhythm__drop-zone"
          :class="{ 'midi-rhythm__drop-zone--active': isDropTarget }"
          for="midi-rhythm-score-file"
          @dragenter.prevent="isDropTarget = true"
          @dragleave="leaveDropZone"
          @dragover.prevent="isDropTarget = true"
          @drop.prevent="onDrop"
        >
          <Upload
            :size="22"
            aria-hidden="true"
          />
          <span>{{ text.dropHint }}</span>
        </label>
        <div
          v-if="score"
          class="midi-rhythm__score-info"
        >
          <span>{{ text.notes }} {{ score.notes.length }}</span>
          <span>{{ text.baseBpm }} {{ score.baseBpm.toFixed(1) }}</span>
          <span>{{ text.tracks }} {{ score.trackCount }}</span>
          <span>{{ text.range }} {{ midiToName(score.minMidi) }}–{{ midiToName(score.maxMidi) }}</span>
          <button
            type="button"
            class="midi-rhythm__icon-button"
            :aria-label="text.removeFile"
            :title="text.removeFile"
            @click="removeScore"
          >
            <X
              :size="16"
              aria-hidden="true"
            />
          </button>
        </div>
      </section>

      <section
        class="midi-rhythm__panel"
        aria-labelledby="midi-rhythm-mode-title"
      >
        <h2 id="midi-rhythm-mode-title">
          {{ text.mode }}
        </h2>
        <div class="midi-rhythm__mode-row">
          <label>
            <input
              v-model="playMode"
              type="radio"
              value="judge"
            >
            <span>{{ text.judgeMode }}</span>
          </label>
          <label>
            <input
              v-model="playMode"
              type="radio"
              value="free"
            >
            <span>{{ text.freeMode }}</span>
          </label>
          <ToggleField
            v-if="playMode === 'judge'"
            id="midi-rhythm-playback-only"
            :checked="playbackOnly"
            :label="text.playbackOnly"
            :title="text.playbackOnlyTitle"
            @toggle="
              playbackOnly = !playbackOnly;
              markConfigChanged();
            "
          />
        </div>
        <p
          v-if="playMode === 'free'"
          class="midi-rhythm__hint"
        >
          {{ text.freeHint }}
        </p>

        <div class="midi-rhythm__slider-row">
          <label for="midi-rhythm-speed">{{ text.speed }}</label>
          <input
            id="midi-rhythm-speed"
            v-model.number="speed"
            type="range"
            :min="SPEED_MIN"
            :max="SPEED_MAX"
            step="0.05"
            :disabled="isPlaying && !effectivePlaybackOnly"
            @input="onSpeedInput"
          >
          <span>{{ speed.toFixed(2) }}× · {{ effectiveBpmValue.toFixed(0) }} BPM</span>
        </div>
        <div
          v-if="playMode === 'free'"
          class="midi-rhythm__slider-row"
        >
          <label for="midi-rhythm-metronome-bpm">{{ text.metronomeBpm }}</label>
          <input
            id="midi-rhythm-metronome-bpm"
            v-model.number="metronomeBpm"
            type="range"
            min="30"
            max="300"
            step="1"
            :disabled="isPlaying"
            @change="markConfigChanged"
          >
          <span>{{ metronomeBpm }} BPM</span>
        </div>
        <ToggleField
          id="midi-rhythm-metronome"
          :checked="metronomeEnabled"
          :label="text.metronome"
          :title="text.metronomeTitle"
          @toggle="metronomeEnabled = !metronomeEnabled"
        />
        <div class="midi-rhythm__key-sound-row">
          <span class="midi-rhythm__keyhint-title">{{ text.soundMode }}</span>
          <div
            class="midi-rhythm__segmented midi-rhythm__segmented--two"
            :class="`midi-rhythm__segmented--sound-${displayedSoundMode}`"
            role="group"
            :aria-label="text.soundMode"
          >
            <button
              type="button"
              class="midi-rhythm__segmented-button"
              :class="{ 'midi-rhythm__segmented-button--active': displayedSoundMode === 'press' }"
              :aria-pressed="displayedSoundMode === 'press'"
              :disabled="soundControlLocked"
              @click="
                soundMode = 'press';
                markConfigChanged();
              "
            >
              {{ text.soundModePress }}
            </button>
            <button
              type="button"
              class="midi-rhythm__segmented-button"
              :class="{ 'midi-rhythm__segmented-button--active': displayedSoundMode === 'auto' }"
              :aria-pressed="displayedSoundMode === 'auto'"
              :disabled="soundControlLocked"
              @click="
                soundMode = 'auto';
                markConfigChanged();
              "
            >
              {{ text.soundModeAuto }}
            </button>
          </div>
          <ToggleField
            id="midi-rhythm-mute-source"
            :checked="muteSource"
            :disabled="muteToggleDisabled"
            :label="text.muteSource"
            :title="text.muteSourceTitle"
            @toggle="muteSource = !muteSource"
          />
        </div>
      </section>

      <section class="midi-rhythm__panel midi-rhythm__settings">
        <p class="midi-rhythm__settings-heading">
          {{ text.settings }}
        </p>
        <div class="midi-rhythm__settings-grid">
          <p class="midi-rhythm__settings-title">
            {{ text.thresholdsTitle }}
          </p>
          <div class="midi-rhythm__threshold-row">
            <label :title="text.perfectTitle">
              <span>{{ text.perfect }}</span>
              <input
                v-model="thresholdText.perfectMs"
                type="number"
                inputmode="numeric"
                min="10"
                max="200"
                step="5"
                autocomplete="off"
                @change="commitThresholds"
              >
            </label>
            <label :title="text.goodTitle">
              <span>{{ text.good }}</span>
              <input
                v-model="thresholdText.goodMs"
                type="number"
                inputmode="numeric"
                min="20"
                max="400"
                step="5"
                autocomplete="off"
                @change="commitThresholds"
              >
            </label>
            <label :title="text.badTitle">
              <span>{{ text.bad }}</span>
              <input
                v-model="thresholdText.badMs"
                type="number"
                inputmode="numeric"
                min="50"
                max="800"
                step="10"
                autocomplete="off"
                @change="commitThresholds"
              >
            </label>
          </div>
          <label class="midi-rhythm__tone-row">
            <span>{{ text.tone }}</span>
            <select v-model="tonePreset">
              <option value="electric-piano">{{ text.toneElectricPiano }}</option>
              <option value="triangle">{{ text.toneTriangle }}</option>
              <option value="sine">{{ text.toneSine }}</option>
              <option value="square">{{ text.toneSquare }}</option>
              <option value="sawtooth">{{ text.toneSawtooth }}</option>
              <option value="organ">{{ text.toneOrgan }}</option>
              <option value="bell">{{ text.toneBell }}</option>
              <option value="soundfont">{{ text.soundFontTone }}</option>
            </select>
          </label>
          <template v-if="tonePreset === 'soundfont'">
            <input
              id="midi-rhythm-soundfont-file"
              accept=".sf2,audio/soundfont"
              class="midi-rhythm__file-input"
              type="file"
              :disabled="soundFontLoading"
              @change="onSoundFontFileChange"
            >
            <label
              class="midi-rhythm__drop-zone"
              :class="{ 'midi-rhythm__drop-zone--active': isSoundFontDropTarget }"
              for="midi-rhythm-soundfont-file"
              @dragenter.prevent="isSoundFontDropTarget = true"
              @dragleave="leaveSoundFontDropZone"
              @dragover.prevent="isSoundFontDropTarget = true"
              @drop.prevent="onSoundFontDrop"
            >
              <Upload
                :size="20"
                aria-hidden="true"
              />
              <span>{{ soundFontPresets.length > 0 ? text.soundFontLoaded : text.soundFontDropHint }}</span>
            </label>
          </template>
          <label
            v-if="tonePreset === 'soundfont' && soundFontPresets.length > 0"
            class="midi-rhythm__tone-row"
          >
            <span>{{ text.soundFontPreset }}</span>
            <select v-model.number="soundFontPresetIndex">
              <option
                v-for="(preset, index) in soundFontPresets"
                :key="index"
                :value="index"
              >
                {{ preset.header.bank }}:{{ preset.header.preset }} {{ preset.header.name }}
              </option>
            </select>
          </label>
          <p
            v-if="soundFontLoading"
            class="midi-rhythm__hint"
          >
            {{ text.soundFontLoading }}
          </p>
          <p
            v-if="soundFontError"
            class="midi-rhythm__error"
          >
            {{ soundFontError }}
          </p>
          <div class="midi-rhythm__toggle-row">
            <ToggleField
              id="midi-rhythm-show-all-keys"
              :checked="showAllKeys"
              :label="text.showAllKeys"
              :title="text.showAllKeysTitle"
              @toggle="
                showAllKeys = !showAllKeys;
                draw(null);
              "
            />
            <ToggleField
              id="midi-rhythm-bar-lines"
              :checked="showBarLines"
              :label="text.barLines"
              :title="text.barLinesTitle"
              @toggle="showBarLines = !showBarLines"
            />
          </div>
          <div
            class="midi-rhythm__slider-row"
            :title="text.leadSecondsTitle"
          >
            <label for="midi-rhythm-lead">{{ text.leadSeconds }}</label>
            <input
              id="midi-rhythm-lead"
              v-model.number="leadSeconds"
              type="range"
              :min="LEAD_MIN_SECONDS"
              :max="LEAD_MAX_SECONDS"
              step="0.5"
            >
            <span>{{ leadSeconds.toFixed(1) }}s</span>
          </div>
          <div
            class="midi-rhythm__slider-row"
            :title="text.calibrationTitle"
          >
            <label for="midi-rhythm-calibration">{{ text.calibration }}</label>
            <input
              id="midi-rhythm-calibration"
              v-model.number="calibrationMs"
              type="range"
              :min="CALIBRATION_MIN_MS"
              :max="CALIBRATION_MAX_MS"
              step="5"
            >
            <span>{{ calibrationMs }} ms</span>
          </div>
          <div
            class="midi-rhythm__slider-row"
            :title="text.audioOffsetTitle"
          >
            <label for="midi-rhythm-audio-offset">{{ text.audioOffset }}</label>
            <input
              id="midi-rhythm-audio-offset"
              v-model.number="audioOffsetMs"
              type="range"
              :min="AUDIO_OFFSET_MIN_MS"
              :max="AUDIO_OFFSET_MAX_MS"
              step="5"
            >
            <span>{{ audioOffsetMs }} ms</span>
          </div>
          <div
            class="midi-rhythm__keyhint-row"
            :title="text.keyHintTitle"
          >
            <span class="midi-rhythm__keyhint-title">{{ text.keyHint }}</span>
            <div
              class="midi-rhythm__segmented"
              :class="`midi-rhythm__segmented--${keyHintMode}`"
              role="group"
              :aria-label="text.keyHint"
            >
              <button
                type="button"
                class="midi-rhythm__segmented-button"
                :class="{ 'midi-rhythm__segmented-button--active': keyHintMode === 'auto' }"
                :aria-pressed="keyHintMode === 'auto'"
                @click="keyHintMode = 'auto'"
              >
                {{ text.keyHintAuto }}
              </button>
              <button
                type="button"
                class="midi-rhythm__segmented-button"
                :class="{ 'midi-rhythm__segmented-button--active': keyHintMode === 'show' }"
                :aria-pressed="keyHintMode === 'show'"
                @click="keyHintMode = 'show'"
              >
                {{ text.keyHintShow }}
              </button>
              <button
                type="button"
                class="midi-rhythm__segmented-button"
                :class="{ 'midi-rhythm__segmented-button--active': keyHintMode === 'hide' }"
                :aria-pressed="keyHintMode === 'hide'"
                @click="keyHintMode = 'hide'"
              >
                {{ text.keyHintHide }}
              </button>
            </div>
          </div>
        </div>
      </section>

      <p
        v-if="pendingRestart"
        class="midi-rhythm__notice midi-rhythm__notice--restart"
      >
        {{ text.restartHint }}
      </p>
      <p
        v-if="!midiSupported"
        class="midi-rhythm__notice"
      >
        {{ text.midiUnsupported }}
      </p>
    </div>

    <section
      ref="stageRef"
      class="midi-rhythm__stage"
      :class="{ 'midi-rhythm__stage--fullscreen': isFullscreen }"
      aria-label="Play area"
    >
      <canvas
        ref="canvasRef"
        class="midi-rhythm__canvas"
      />

      <div class="midi-rhythm__hud">
        <span
          v-if="isCountingIn"
          class="midi-rhythm__countin"
        >
          {{ text.countIn }} · {{ countInBeatsLeft }}
        </span>
        <div class="midi-rhythm__combo">
          <span class="midi-rhythm__combo-value">{{ stats.combo }}</span>
          <span class="midi-rhythm__combo-label">{{ text.combo }}</span>
        </div>
        <div class="midi-rhythm__counts">
          <span class="midi-rhythm__chip midi-rhythm__chip--perfect">P {{ stats.perfect }}</span>
          <span class="midi-rhythm__chip midi-rhythm__chip--good">G {{ stats.good }}</span>
          <span class="midi-rhythm__chip midi-rhythm__chip--bad">B {{ stats.bad }}</span>
          <span class="midi-rhythm__chip midi-rhythm__chip--miss">M {{ stats.missed }}</span>
          <span class="midi-rhythm__chip midi-rhythm__chip--extra">{{ text.extraMiss }} {{ stats.extraMiss }}</span>
        </div>
        <div class="midi-rhythm__score">
          {{ text.score }} {{ formatPercent(scorePercent) }}
        </div>
        <span
          v-if="lastTier"
          class="midi-rhythm__last-tier"
          :class="`midi-rhythm__last-tier--${lastTier}`"
        >
          {{ tierLabel(lastTier) }}
        </span>
      </div>

      <div class="midi-rhythm__stage-actions">
        <button
          type="button"
          class="midi-rhythm__button midi-rhythm__button--primary"
          @click="onPrimaryAction"
        >
          <RotateCcw
            v-if="isPlaying || isPaused"
            :size="16"
            aria-hidden="true"
          />
          <Play
            v-else
            :size="16"
            aria-hidden="true"
          />
          <span>{{ isPlaying || isPaused ? text.restart : text.start }}</span>
        </button>
        <button
          type="button"
          class="midi-rhythm__button"
          :disabled="!isPlaying && !isPaused"
          @click="togglePause"
        >
          <Pause
            v-if="isPlaying"
            :size="16"
            aria-hidden="true"
          />
          <Play
            v-else
            :size="16"
            aria-hidden="true"
          />
          <span>{{ isPlaying ? text.pause : text.resume }}</span>
        </button>
        <button
          type="button"
          class="midi-rhythm__button"
          :disabled="!canExport"
          @click="exportRecording"
        >
          <Download
            :size="16"
            aria-hidden="true"
          />
          <span>{{ text.exportRecord }}</span>
        </button>
        <button
          type="button"
          class="midi-rhythm__button"
          @click="toggleFullscreen"
        >
          <Minimize
            v-if="isFullscreen"
            :size="16"
            aria-hidden="true"
          />
          <Maximize
            v-else
            :size="16"
            aria-hidden="true"
          />
          <span>{{ isFullscreen ? text.exitFullscreen : text.fullscreen }}</span>
        </button>
      </div>
    </section>

    <p
      v-if="errorMessage"
      class="midi-rhythm__error"
      role="alert"
    >
      {{ errorMessage }}
    </p>
  </div>
</template>

<style scoped>
.midi-rhythm {
  display: grid;
  gap: 12px;
  max-width: 1080px;
}

.midi-rhythm__sr {
  clip-path: inset(50%);
  height: 1px;
  overflow: hidden;
  position: absolute;
  white-space: nowrap;
  width: 1px;
}

.midi-rhythm__panels {
  align-items: start;
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.midi-rhythm__panels > .midi-rhythm__panel--full,
.midi-rhythm__panels > .midi-rhythm__notice {
  grid-column: 1 / -1;
}

@media (width <= 760px) {
  .midi-rhythm__panels {
    grid-template-columns: 1fr;
  }
}

.midi-rhythm__panel {
  background: color-mix(in srgb, var(--vp-c-bg-soft) 58%, var(--vp-c-bg));
  border: 1px solid color-mix(in srgb, var(--vp-c-divider) 72%, transparent);
  border-radius: 10px;
  display: grid;
  gap: 8px;
  padding: 12px 14px;
}

.midi-rhythm__label-row {
  align-items: baseline;
  display: flex;
  gap: 8px;
  justify-content: space-between;
}

.midi-rhythm__panel h2 {
  border-top: 0;
  font-size: 1rem;
  margin: 0;
  padding: 0;
}

.midi-rhythm__file-input {
  clip-path: inset(50%);
  height: 1px;
  overflow: hidden;
  position: absolute;
  white-space: nowrap;
  width: 1px;
}

.midi-rhythm__drop-zone {
  align-items: center;
  background: color-mix(in srgb, var(--vp-c-bg) 60%, transparent);
  border: 1px dashed color-mix(in srgb, var(--vp-c-divider) 72%, var(--vp-c-text-2));
  border-radius: 8px;
  color: var(--vp-c-text-2);
  cursor: pointer;
  display: flex;
  gap: 8px;
  justify-content: center;
  min-height: 64px;
  padding: 12px;
  text-align: center;
}

.midi-rhythm__drop-zone:hover,
.midi-rhythm__drop-zone--active {
  background: color-mix(in srgb, var(--vp-c-brand-soft) 54%, var(--vp-c-bg));
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-text-1);
}

.midi-rhythm__score-info {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  font-size: 0.85rem;
  gap: 8px;
}

.midi-rhythm__score-info span {
  background: color-mix(in srgb, var(--vp-c-bg) 60%, transparent);
  border-radius: 999px;
  padding: 2px 8px;
}

.midi-rhythm__mode-row {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.midi-rhythm__mode-row label {
  align-items: center;
  cursor: pointer;
  display: inline-flex;
  gap: 6px;
}

.midi-rhythm__toggle-row {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.midi-rhythm__key-sound-row {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.midi-rhythm__slider-row {
  align-items: center;
  display: grid;
  gap: 10px;
  grid-template-columns: 84px minmax(120px, 1fr) auto;
}

.midi-rhythm__slider-row input[type="range"] {
  width: 100%;
}

.midi-rhythm__hint {
  color: var(--vp-c-text-2);
  font-size: 0.85rem;
  margin: 0;
}

.midi-rhythm__notice {
  background: color-mix(in srgb, var(--vp-c-warning-soft) 50%, var(--vp-c-bg));
  border-inline-start: 3px solid var(--vp-c-warning-1);
  margin: 0;
  padding: 10px 12px;
}

.midi-rhythm__notice--restart {
  background: color-mix(in srgb, var(--vp-c-brand-soft) 50%, var(--vp-c-bg));
  border-inline-start-color: var(--vp-c-brand-1);
}

.midi-rhythm__settings {
  border-radius: 10px;
}

.midi-rhythm__settings-heading {
  font-weight: 700;
  margin: 0;
}

.midi-rhythm__settings-grid {
  display: grid;
  gap: 8px;
  margin-top: 8px;
}

.midi-rhythm__settings-title,
.midi-rhythm__threshold-row,
.midi-rhythm__keyhint-row,
.midi-rhythm__settings-grid > .midi-rhythm__slider-row,
.midi-rhythm__settings-grid > .midi-rhythm__hint {
  grid-column: 1 / -1;
}

.midi-rhythm__settings-title {
  font-weight: 700;
  margin: 0;
}

.midi-rhythm__threshold-row {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.midi-rhythm__threshold-row label {
  display: grid;
  font-size: 0.9rem;
  font-weight: 600;
  gap: 4px;
  min-width: 0;
}

.midi-rhythm__settings-grid input[type="number"] {
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  box-sizing: border-box;
  color: var(--vp-c-text-1);
  font: inherit;
  font-variant-numeric: tabular-nums;
  height: 32px;
  min-width: 0;
  padding: 4px 8px;
  width: 100%;
}

.midi-rhythm__tone-row {
  align-items: center;
  display: grid;
  font-size: 0.9rem;
  font-weight: 600;
  gap: 6px;
  grid-template-columns: max-content minmax(120px, 200px);
  justify-content: start;
}

.midi-rhythm__settings-grid select {
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  box-sizing: border-box;
  color: var(--vp-c-text-1);
  font: inherit;
  height: 32px;
  padding: 4px 8px;
  width: 100%;
}

.midi-rhythm__keyhint-row {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.midi-rhythm__keyhint-title {
  font-size: 0.9rem;
  font-weight: 700;
}

.midi-rhythm__segmented {
  --midi-rhythm-segment-count: 3;
  background: color-mix(in srgb, var(--vp-c-bg-soft) 68%, var(--vp-c-bg));
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  display: grid;
  gap: 0;
  grid-template-columns: repeat(var(--midi-rhythm-segment-count), minmax(0, 1fr));
  min-height: 34px;
  min-width: 0;
  overflow: hidden;
  padding: 2px;
  position: relative;
  width: min(100%, 300px);
}

.midi-rhythm__segmented::before {
  background: var(--vp-c-brand-1);
  border-radius: 999px;
  bottom: 2px;
  box-shadow: 0 6px 14px rgb(15 23 42 / 12%);
  content: "";
  left: 2px;
  position: absolute;
  top: 2px;
  transition: transform 0.2s ease;
  width: calc((100% - 4px) / var(--midi-rhythm-segment-count));
}

.midi-rhythm__segmented--show::before {
  transform: translateX(100%);
}

.midi-rhythm__segmented--hide::before {
  transform: translateX(200%);
}

.midi-rhythm__segmented--two {
  --midi-rhythm-segment-count: 2;
  width: min(100%, 460px);
}

.midi-rhythm__segmented--sound-auto::before {
  transform: translateX(100%);
}

.midi-rhythm__segmented-button {
  background: transparent;
  border: 0;
  border-radius: 999px;
  box-shadow: none;
  color: color-mix(in srgb, var(--vp-c-text-1) 64%, var(--vp-c-text-2) 36%);
  cursor: pointer;
  font-family: inherit;
  font-size: 0.88rem;
  font-weight: 700;
  line-height: 1.15;
  min-height: 28px;
  min-width: 0;
  overflow-wrap: anywhere;
  padding: 4px 10px;
  position: relative;
  text-align: center;
  transition:
    background-color 0.2s ease,
    color 0.2s ease;
  white-space: normal;
  z-index: 1;
}

.midi-rhythm__segmented-button:focus-visible {
  box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--vp-c-brand-1) 56%, var(--vp-c-bg));
  outline: none;
}

.midi-rhythm__segmented-button:hover:not(:disabled) {
  background: color-mix(in srgb, var(--vp-c-brand-1) 8%, transparent);
  color: var(--vp-c-text-1);
}

.midi-rhythm__segmented .midi-rhythm__segmented-button--active {
  color: var(--vp-c-white);
}

.midi-rhythm__segmented .midi-rhythm__segmented-button--active:hover:not(:disabled) {
  background: rgb(255 255 255 / 12%);
  color: var(--vp-c-white);
}

.midi-rhythm__stage {
  background: color-mix(in srgb, var(--vp-c-bg-soft) 30%, var(--vp-c-bg));
  border: 1px solid color-mix(in srgb, var(--vp-c-divider) 72%, transparent);
  border-radius: 10px;
  display: grid;
  gap: 8px;
  overflow: hidden;
  padding: 8px;
}

.midi-rhythm__canvas {
  display: block;
  height: 320px;
  width: 100%;
}

.midi-rhythm__stage--fullscreen {
  border-radius: 0;
  height: 100vh;
}

.midi-rhythm__stage--fullscreen .midi-rhythm__canvas {
  height: calc(100vh - 132px);
}

.midi-rhythm__hud {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.midi-rhythm__countin {
  align-items: center;
  background: color-mix(in srgb, var(--vp-c-brand-soft) 60%, var(--vp-c-bg));
  border-radius: 999px;
  color: var(--vp-c-brand-1);
  display: inline-flex;
  font-weight: 800;
  padding: 2px 12px;
}

.midi-rhythm__combo {
  align-items: baseline;
  display: inline-flex;
  gap: 6px;
}

.midi-rhythm__combo-value {
  font-size: 1.6rem;
  font-weight: 800;
  line-height: 1;
}

.midi-rhythm__combo-label {
  color: var(--vp-c-text-2);
  font-size: 0.85rem;
}

.midi-rhythm__counts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.midi-rhythm__chip {
  border-radius: 999px;
  font-size: 0.8rem;
  font-weight: 700;
  padding: 2px 8px;
}

.midi-rhythm__chip--perfect {
  background: #fef3c7;
  color: #92400e;
}

.midi-rhythm__chip--good {
  background: #dcfce7;
  color: #166534;
}

.midi-rhythm__chip--bad {
  background: #ffedd5;
  color: #9a3412;
}

.midi-rhythm__chip--miss {
  background: #fee2e2;
  color: #991b1b;
}

.midi-rhythm__chip--extra {
  background: color-mix(in srgb, var(--vp-c-bg-soft) 70%, var(--vp-c-bg));
  color: var(--vp-c-text-2);
}

.midi-rhythm__score {
  font-weight: 700;
}

.midi-rhythm__last-tier {
  border-radius: 999px;
  font-weight: 800;
  padding: 2px 10px;
}

.midi-rhythm__last-tier--perfect {
  background: #f59e0b;
  color: #1c1917;
}

.midi-rhythm__last-tier--good {
  background: #22c55e;
  color: #052e16;
}

.midi-rhythm__last-tier--bad {
  background: #f97316;
  color: #431407;
}

.midi-rhythm__stage-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.midi-rhythm__button {
  align-items: center;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  color: var(--vp-c-text-1);
  cursor: pointer;
  display: inline-flex;
  font: inherit;
  font-size: 0.9rem;
  font-weight: 700;
  gap: 6px;
  justify-content: center;
  min-height: 34px;
  padding: 6px 12px;
}

.midi-rhythm__button:hover:not(:disabled) {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.midi-rhythm__button:disabled {
  cursor: not-allowed;
  opacity: 55%;
}

.midi-rhythm__button--primary {
  background: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-white);
}

.midi-rhythm__button--primary:hover:not(:disabled) {
  color: var(--vp-c-white);
}

.midi-rhythm__icon-button {
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: 999px;
  color: var(--vp-c-text-2);
  cursor: pointer;
  display: inline-flex;
  padding: 4px;
}

.midi-rhythm__icon-button:hover {
  color: var(--vp-c-danger-1);
}

.midi-rhythm button:focus-visible,
.midi-rhythm .midi-rhythm__drop-zone:focus-within {
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--vp-c-brand-1) 16%, transparent);
  outline: none;
}

.midi-rhythm__error {
  color: var(--vp-c-danger-1);
  font-weight: 700;
  margin: 0;
}

@media (prefers-reduced-motion: reduce) {
  .midi-rhythm__combo-value,
  .midi-rhythm__last-tier {
    transition: none;
  }
}

@media (width <= 520px) {
  .midi-rhythm__slider-row {
    grid-template-columns: 1fr;
  }

  .midi-rhythm__canvas {
    height: 240px;
  }
}
</style>
