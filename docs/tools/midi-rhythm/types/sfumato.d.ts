declare module "sfumato" {
  /** Minimal SoundFont2 preset shape consumed by sfumato's note player. */
  export interface SfumatoPreset {
    header: {
      name: string;
      preset: number;
      bank: number;
    };
    zones: unknown[];
  }

  /** A parsed SoundFont2 instance returned by {@link loadSoundfont}. */
  export interface SfumatoSoundFont {
    presets: SfumatoPreset[];
  }

  /** Load and parse a SoundFont (.sf2) from a URL (for local files use a blob URL). */
  export function loadSoundfont(url: string): Promise<SfumatoSoundFont>;

  /** Start a note and return a stop handler; call it with an AudioContext time to stop the note. */
  export function startPresetNote(
    context: BaseAudioContext,
    preset: SfumatoPreset,
    midi: number,
    time?: number,
  ): (time?: number) => void;
}
