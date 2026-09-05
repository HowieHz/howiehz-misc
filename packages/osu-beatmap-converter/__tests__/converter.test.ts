import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { convertOsuBeatmapDetailed, parseOsuBeatmap } from "../src/index.ts";

const FIXTURE_DIR = new URL("./fixtures/", import.meta.url);

const FIXTURE_FILES = [
  "daisan - -+ (Starfy) [Regou's Extra].osu",
  "LeaF - Arianrhod (greenhue) [Extra].osu",
  "Plastic to Onnanoko - Shoujo no Maisou (Snow Note) [Undefined].osu",
  "xi - .357 Magnum (Akali) [High Noon].osu",
] as const;

const FIXTURE_OPTIONS = [
  { keys: 1, removeSv: "none" },
  { keys: 1, removeSv: "all" },
  { keys: 1, removeSv: "inherited_timing_points" },
  { keys: 2, removeSv: "none" },
  { keys: 2, removeSv: "all" },
  { keys: 2, removeSv: "inherited_timing_points" },
  { keys: 4, removeSv: "none" },
  { keys: 4, removeSv: "all" },
  { keys: 4, removeSv: "inherited_timing_points" },
] as const;

// SHA-256 keeps all 36 fixture-output combinations reviewable without committing duplicate large beatmaps.
const FIXTURE_OUTPUT_HASHES: Record<string, string> = {
  "daisan - -+ (Starfy) [Regou's Extra].osu:1-none": "748c81d8ad91537ec0a95c9a435862493c49d3095ad814f064c457b14b6b7a9a",
  "daisan - -+ (Starfy) [Regou's Extra].osu:1-all": "cdc38ecb9be9caa02ef86e29ab175d55247f908b329c0f30ddde8c72aebf0dd8",
  "daisan - -+ (Starfy) [Regou's Extra].osu:1-inherited_timing_points":
    "59e401f585bcec3df4a2053a4a6a63e7a9cde1832391e09d165181b9b0e40a55",
  "daisan - -+ (Starfy) [Regou's Extra].osu:2-none": "f0b3424febaa838fbc8150cbf65e6fc625d3ef8f86c574db2816d92bfc544bda",
  "daisan - -+ (Starfy) [Regou's Extra].osu:2-all": "f34239d139748fd8058c3d503dae72ba9afda7cb223a843c70b06f3dec5e7473",
  "daisan - -+ (Starfy) [Regou's Extra].osu:2-inherited_timing_points":
    "93b6a337a3d4a656901cd306b5120baf9c583253735e1676b3c6593651c71bf2",
  "daisan - -+ (Starfy) [Regou's Extra].osu:4-none": "f18072878976fc5c8970d42166b236d53483bd07b6fbcdfc62f3390b9bc66635",
  "daisan - -+ (Starfy) [Regou's Extra].osu:4-all": "be9d4d987627d1dcf6860dff4187b0fb94cd059584a0233830129f85f65d3bac",
  "daisan - -+ (Starfy) [Regou's Extra].osu:4-inherited_timing_points":
    "b7313c9bf9f7b45cf10d991ad163ac9b87e8c576c837e405817e92af47d9f66c",
  "LeaF - Arianrhod (greenhue) [Extra].osu:1-none": "08f2531b2bd49d471be84e0097cfeb01d200f4f491b993d8f50e0a8343788981",
  "LeaF - Arianrhod (greenhue) [Extra].osu:1-all": "5fba6c5118a510c85e73e9597d28e41288207ef6b3f7fb23029e0aee1fe9adc0",
  "LeaF - Arianrhod (greenhue) [Extra].osu:1-inherited_timing_points":
    "5fba6c5118a510c85e73e9597d28e41288207ef6b3f7fb23029e0aee1fe9adc0",
  "LeaF - Arianrhod (greenhue) [Extra].osu:2-none": "ddeae3b802518a043b297ff1b98d2c21a9ae4cbc33a7d7679fe4e70884c2a4b9",
  "LeaF - Arianrhod (greenhue) [Extra].osu:2-all": "8dc9776c13ef1a00cde08b6db52873f02c3f8cf8a25372c9ae9db0837acc79df",
  "LeaF - Arianrhod (greenhue) [Extra].osu:2-inherited_timing_points":
    "8dc9776c13ef1a00cde08b6db52873f02c3f8cf8a25372c9ae9db0837acc79df",
  "LeaF - Arianrhod (greenhue) [Extra].osu:4-none": "2d4693b6a6776cb62422ac7ee3b0202edb6ce07fb63a0b864c1d5d014b3fd971",
  "LeaF - Arianrhod (greenhue) [Extra].osu:4-all": "3d3a82e617842140abc3bfcd660810b6b4e5d341e7c49a367a6de0ff3b9fecec",
  "LeaF - Arianrhod (greenhue) [Extra].osu:4-inherited_timing_points":
    "3d3a82e617842140abc3bfcd660810b6b4e5d341e7c49a367a6de0ff3b9fecec",
  "Plastic to Onnanoko - Shoujo no Maisou (Snow Note) [Undefined].osu:1-none":
    "047126c48e40c857012c44fc4cae0241fa2b26636b1a59bb91c26146769feaac",
  "Plastic to Onnanoko - Shoujo no Maisou (Snow Note) [Undefined].osu:1-all":
    "b1fa9ac0b5b32c754a1cfbc53dbc04b6a8db043be9dac150a2da6ed360953192",
  "Plastic to Onnanoko - Shoujo no Maisou (Snow Note) [Undefined].osu:1-inherited_timing_points":
    "b1fa9ac0b5b32c754a1cfbc53dbc04b6a8db043be9dac150a2da6ed360953192",
  "Plastic to Onnanoko - Shoujo no Maisou (Snow Note) [Undefined].osu:2-none":
    "005baa8e77d59c9bc30716b28c98408a7c2cf48819bfde6536047b8484449b6a",
  "Plastic to Onnanoko - Shoujo no Maisou (Snow Note) [Undefined].osu:2-all":
    "a1016b434911d65d614cdae99b8f8fde498b2fca8bfc159ac5b8afa616a15c96",
  "Plastic to Onnanoko - Shoujo no Maisou (Snow Note) [Undefined].osu:2-inherited_timing_points":
    "a1016b434911d65d614cdae99b8f8fde498b2fca8bfc159ac5b8afa616a15c96",
  "Plastic to Onnanoko - Shoujo no Maisou (Snow Note) [Undefined].osu:4-none":
    "e52aea42219bd84b01e4540484a0e6ba6a10376a2432d6b8397dacaf1c462a7d",
  "Plastic to Onnanoko - Shoujo no Maisou (Snow Note) [Undefined].osu:4-all":
    "71a0e2dbea4bb9f37dc34843e20a13b4d06bd84a170a1724ec86436a59a35338",
  "Plastic to Onnanoko - Shoujo no Maisou (Snow Note) [Undefined].osu:4-inherited_timing_points":
    "71a0e2dbea4bb9f37dc34843e20a13b4d06bd84a170a1724ec86436a59a35338",
  "xi - .357 Magnum (Akali) [High Noon].osu:1-none": "fe07acf48721b55aff2c6984f242ccd8730904061e7c377630cb825334f19501",
  "xi - .357 Magnum (Akali) [High Noon].osu:1-all": "a1d002684460457b55dd807265b4da288fba1e8fc46a4d0b031c6f820f665e82",
  "xi - .357 Magnum (Akali) [High Noon].osu:1-inherited_timing_points":
    "a1d002684460457b55dd807265b4da288fba1e8fc46a4d0b031c6f820f665e82",
  "xi - .357 Magnum (Akali) [High Noon].osu:2-none": "063e28354a5fcc5a8d50f327195dc8996c8f2f603a761309f09ea4724bf19747",
  "xi - .357 Magnum (Akali) [High Noon].osu:2-all": "3320ea01074bcd4ebccc4381b3cacd7c9fbeec12aa470aa779f8d1d923df5516",
  "xi - .357 Magnum (Akali) [High Noon].osu:2-inherited_timing_points":
    "3320ea01074bcd4ebccc4381b3cacd7c9fbeec12aa470aa779f8d1d923df5516",
  "xi - .357 Magnum (Akali) [High Noon].osu:4-none": "e2304ff99279a6368323521ed2e96d05718f6d390ca7ddbb509cbe76ec6de611",
  "xi - .357 Magnum (Akali) [High Noon].osu:4-all": "4373bd7dd9cd80339d8964ee4cc8931131a5e6b68b198094bcf2ac7b4133016f",
  "xi - .357 Magnum (Akali) [High Noon].osu:4-inherited_timing_points":
    "4373bd7dd9cd80339d8964ee4cc8931131a5e6b68b198094bcf2ac7b4133016f",
};

describe("osu beatmap conversion", () => {
  it("matches golden output for all supplied samples, key counts, and SV modes", async () => {
    for (const file of FIXTURE_FILES) {
      const source = await readFile(new URL(file, FIXTURE_DIR), "utf8");
      const parsed = parseOsuBeatmap(source);
      for (const options of FIXTURE_OPTIONS) {
        const result = convertOsuBeatmapDetailed(source, options);
        const fixtureKey = `${file}:${options.keys}-${options.removeSv}`;
        expect(result.sourceMode).toBe("osu!");
        expect(result.objectCount).toBe(parsed.hitObjects.length);
        expect(result.content).toContain("Mode: 3\n");
        expect(result.content).toContain(`CircleSize:${options.keys}\n`);
        expect(result.content).toContain("BeatmapSetID:-1\n");
        expect(result.content).toContain("[HitObjects]\n");
        expect(createHash("sha256").update(result.content).digest("hex")).toBe(FIXTURE_OUTPUT_HASHES[fixtureKey]);
      }
    }
  });

  it("rejects every non-Standard ruleset", () => {
    for (const mode of ["1", "2", "3", "4"] as const) {
      const source = ["osu file format v14", "[General]", `Mode: ${mode}`, "", "[HitObjects]"].join("\n");
      expect(() => convertOsuBeatmapDetailed(source, { keys: 4, removeSv: "none" })).toThrow(
        "Only osu!standard beatmaps are supported.",
      );
    }
  });

  it("rejects Mode declarations that could disguise a non-Standard file", () => {
    const invalidSources = [
      ["osu file format v14", "Mode: 0", "", "[General]", "Mode: 3", "", "[HitObjects]"],
      ["osu file format v14", "[General]", "Mode: 0", "Mode: 0", "", "[HitObjects]"],
      ["osu file format v14", "[Difficulty]", "Mode: 0", "", "[HitObjects]"],
      ["osu file format v14", "[General]", "Mode: standard", "", "[HitObjects]"],
      ["osu file format v14", "[General]", "", "[HitObjects]"],
    ].map((lines) => lines.join("\n"));

    for (const source of invalidSources) {
      expect(parseOsuBeatmap(source).mode).toBe("unknown");
      expect(() => convertOsuBeatmapDetailed(source, { keys: 1 })).toThrow("Only osu!standard beatmaps are supported.");
    }
  });

  it("uses the configured lane for the first note of an opening trill", () => {
    const source = [
      "osu file format v14",
      "[General]",
      "Mode: 0",
      "CircleSize:4",
      "",
      "[HitObjects]",
      "256,192,0,1,0,0:0:0:0:",
      "256,192,100,1,0,0:0:0:0:",
    ].join("\n");

    for (const [trillStartKey, firstX, secondX] of [
      [1, 128, 384],
      [2, 384, 128],
    ] as const) {
      const output = convertOsuBeatmapDetailed(source, {
        keys: 2,
        mania2k: { trillStartKey },
        removeSv: "none",
      }).content;
      expect(output).toContain(`${firstX},192,0,1,0,0:0:0:0:`);
      expect(output).toContain(`${secondX},192,100,1,0,0:0:0:0:`);
    }
  });

  it("keeps only the first timing point in all mode and green lines in inherited mode", () => {
    const source = [
      "osu file format v14",
      "[General]",
      "Mode: 0",
      "BeatmapSetID:1",
      "CircleSize:4",
      "SliderMultiplier:1",
      "",
      "[TimingPoints]",
      "0,500,4,2,1,50,1,0",
      "100,-50,4,2,1,50,0,0",
      "200,400,4,2,1,50,1,0",
      "",
      "[HitObjects]",
      "256,192,0,1,0,0:0:0:0:",
    ].join("\n");

    const all = convertOsuBeatmapDetailed(source, { keys: 1, removeSv: "all" }).content;
    const inherited = convertOsuBeatmapDetailed(source, { keys: 1, removeSv: "inherited_timing_points" }).content;
    expect(all).toContain("0,500,4,2,1,50,1,0\n\n[HitObjects]");
    expect(all).not.toContain("100,-50");
    expect(all).not.toContain("200,400");
    expect(inherited).toContain("0,500,4,2,1,50,1,0");
    expect(inherited).toContain("200,400,4,2,1,50,1,0");
    expect(inherited).not.toContain("100,-50");
  });

  it("keeps the first timing row in all mode even when that row is inherited", () => {
    const source = [
      "osu file format v14",
      "[General]",
      "Mode: 0",
      "CircleSize:4",
      "",
      "[TimingPoints]",
      "0,-50,4,2,1,50,0,0",
      "100,500,4,2,1,50,1,0",
      "",
      "[HitObjects]",
      "256,192,0,1,0,0:0:0:0:",
    ].join("\n");

    const output = convertOsuBeatmapDetailed(source, { keys: 1, removeSv: "all" }).content;
    expect(output).toContain("0,-50,4,2,1,50,0,0");
    expect(output).not.toContain("100,500");
  });

  it("uses standard slider length and active decimal timing points", () => {
    const source = [
      "osu file format v14",
      "[General]",
      "Mode: 0",
      "CircleSize:4",
      "SliderMultiplier:1",
      "",
      "[TimingPoints]",
      "669.585365853658,500,4,2,1,50,1,0",
      "1000,-250,4,2,1,50,0,0",
      "",
      "[HitObjects]",
      "256,192,700,2,0,B|256:192|256:192,1,100",
    ].join("\n");

    const output = convertOsuBeatmapDetailed(source, { keys: 1, removeSv: "none" }).content;
    expect(output).toContain("256,192,700,128,0,1200:0:0:0:0:");
  });

  it("uses the later green line when a red line and an SV change share a timestamp", () => {
    const source = [
      "osu file format v14",
      "[General]",
      "Mode: 0",
      "CircleSize:4",
      "SliderMultiplier:1",
      "",
      "[TimingPoints]",
      "0,500,4,2,1,50,1,0",
      "0,-50,4,2,1,50,0,0",
      "",
      "[HitObjects]",
      "256,192,0,2,0,B|256:192,1,100",
    ].join("\n");

    const output = convertOsuBeatmapDetailed(source, { keys: 1, removeSv: "none" }).content;
    expect(output).toContain("256,192,0,128,0,250:0:0:0:0:");
  });

  it("rejects invalid remove SV modes at the API boundary", () => {
    expect(() => Reflect.apply(convertOsuBeatmapDetailed, undefined, ["", { keys: 1, removeSv: "invalid" }])).toThrow(
      "removeSv must be none, all, or inherited_timing_points.",
    );
  });

  it("rejects the removed 5K output at the API boundary", () => {
    expect(() => Reflect.apply(convertOsuBeatmapDetailed, undefined, ["", { keys: 5 }])).toThrow(
      "keys must be one of 1, 2, or 4.",
    );
  });

  it("rejects fractional maximum jack-note counts at the API boundary", () => {
    expect(() => convertOsuBeatmapDetailed("", { keys: 1, mania2k: { maximumNumberOfJackNotes: 1.5 } })).toThrow(
      "maximumNumberOfJackNotes must be a non-negative integer.",
    );
  });

  it("rejects non-object Mania 2K settings supplied from JavaScript", () => {
    for (const mania2k of [0, [], ""] as const) {
      expect(() => Reflect.apply(convertOsuBeatmapDetailed, undefined, ["", { keys: 1, mania2k }])).toThrow(
        "mania2k must be an object.",
      );
    }
  });
});
