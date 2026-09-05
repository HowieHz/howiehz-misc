// @vitest-environment happy-dom

import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

import OsuBeatmapConverter from "./OsuBeatmapConverter.vue";

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
  "",
  "[HitObjects]",
  "256,192,0,1,0,0:0:0:0:",
  "256,192,500,2,0,B|256:192,1,100",
].join("\n");

const sourceWithTimingChange = [
  "osu file format v14",
  "[General]",
  "Mode: 0",
  "BeatmapSetID:1",
  "CircleSize:4",
  "",
  "[TimingPoints]",
  "0,500,4,2,1,50,1,0",
  "1000,250,3,2,1,50,1,0",
  "1500,-50,4,2,1,50,0,0",
  "",
  "[HitObjects]",
  "256,192,0,1,0,0:0:0:0:",
  "256,192,2000,1,0,0:0:0:0:",
  "256,192,10000,1,0,0:0:0:0:",
].join("\n");

const sourceWithInitialGreenLine = [
  "osu file format v14",
  "[General]",
  "Mode: 0",
  "BeatmapSetID:1",
  "CircleSize:4",
  "",
  "[TimingPoints]",
  "0,-50,4,2,1,50,0,0",
  "100,250,3,2,1,50,1,0",
  "",
  "[HitObjects]",
  "256,192,0,1,0,0:0:0:0:",
].join("\n");

const sourceWithLongRange = [
  "osu file format v14",
  "[General]",
  "Mode: 0",
  "BeatmapSetID:1",
  "CircleSize:4",
  "",
  "[TimingPoints]",
  "0,500,4,2,1,50,1,0",
  "1000,250,3,2,1,50,1,0",
  "",
  "[HitObjects]",
  "256,192,0,1,0,0:0:0:0:",
  "256,192,50000,1,0,0:0:0:0:",
].join("\n");

/** Assign a browser FileList-shaped value to the native picker for a local component test. */
function selectFiles(input: HTMLInputElement, files: readonly File[]) {
  Object.defineProperty(input, "files", { configurable: true, value: files });
}

/** Hold a browser file read open long enough to exercise interactions during conversion. */
function createDeferredTextRead() {
  // Promise invokes its executor synchronously, so this resolver exists before the helper returns.
  let resolveText!: (value: string) => void;
  const promise = new Promise<string>((resolve) => {
    resolveText = resolve;
  });
  return { promise, resolveText };
}

describe("OsuBeatmapConverter", () => {
  it("defaults to 2K and renders a live preview before an explicit conversion enables downloads", async () => {
    const wrapper = mount(OsuBeatmapConverter, { props: { language: "en" } });

    expect(wrapper.get(".mania-converter__primary-button").attributes("disabled")).toBeDefined();
    expect(wrapper.get(".mania-converter__download-all-button").attributes("disabled")).toBeDefined();
    expect(wrapper.find(".mania-converter__preview-panel").exists()).toBe(true);
    expect(wrapper.get(".mania-converter__empty-preview").text()).toBe(
      "Choose a .osu file to inspect its notes and timing.",
    );
    expect(
      wrapper.findAll(".mania-converter__settings-panel select, .mania-converter__settings-panel input"),
    ).toHaveLength(6);
    expect(
      wrapper
        .findAll(".mania-converter__settings-panel select")[0]
        .findAll("option")
        .map((option) => option.text()),
    ).toEqual(["1K", "2K", "4K"]);
    expect(wrapper.findAll<HTMLSelectElement>(".mania-converter__settings-panel select")[0].element.value).toBe("2");
    expect(
      wrapper
        .findAll<HTMLSelectElement>(".mania-converter__settings-panel select")[1]
        .findAll("option")
        .map((option) => option.text()),
    ).toEqual(["Keep all SV", "Remove all SV (keep the first TimingPoints row)", "Remove green lines only"]);

    const presetButtons = wrapper.findAll(".mania-converter__segmented-button");
    expect(presetButtons[0].classes()).toContain("mania-converter__segmented-button--active");
    expect(presetButtons[0].attributes("aria-pressed")).toBe("true");

    await wrapper.findAll(".mania-converter__segmented-button")[1].trigger("click");
    expect(presetButtons[0].classes()).not.toContain("mania-converter__segmented-button--active");
    expect(presetButtons[1].classes()).toContain("mania-converter__segmented-button--active");
    const jackInputs = wrapper.findAll<HTMLInputElement>(".mania-converter__settings-panel input");
    expect(jackInputs[0].element.value).toBe("0");
    expect(jackInputs[1].element.value).toBe("1000000");
    await wrapper.findAll(".mania-converter__segmented-button")[2].trigger("click");
    expect(jackInputs[0].element.value).toBe("1000000");
    expect(jackInputs[1].element.value).toBe("1");
    await jackInputs[0].setValue(1);
    expect(presetButtons).toHaveLength(4);
    expect(presetButtons[3].text()).toBe("Custom");
    expect(presetButtons[3].attributes("aria-pressed")).toBe("true");

    const file = new File([source], "sample.osu", { type: "text/plain" });
    selectFiles(wrapper.get<HTMLInputElement>(".mania-converter__file-input").element, [file]);
    await wrapper.get(".mania-converter__file-input").trigger("change");
    await flushPromises();

    expect(wrapper.findAll(".mania-converter__queue-row")).toHaveLength(1);
    expect(wrapper.get(".mania-converter__primary-button").attributes("disabled")).toBeUndefined();
    expect(wrapper.find(".mania-converter__preview").exists()).toBe(true);
    expect(wrapper.get(".mania-converter__stats").text()).toContain("BPM");
    expect(wrapper.get(".mania-converter__stats").text()).not.toContain("osu!");
    expect(wrapper.get(".mania-converter__download-all-button").attributes("disabled")).toBeDefined();
    expect(wrapper.get(".mania-converter__preview-navigation-download").attributes("disabled")).toBeDefined();
    expect(wrapper.findAll(".mania-converter__lane")).toHaveLength(2);
    const flipToggle = wrapper.get("#mania-converter-vertical-flip");
    const previewLabelLeading = wrapper.get(".graphwar-killer__label-row > .graphwar-killer__label-leading");
    expect(previewLabelLeading.element.children[0]).toBe(wrapper.get("#mania-converter-preview-title").element);
    expect(previewLabelLeading.element.children[1]).toBe(
      wrapper.get(".graphwar-killer__source-toggle.graphwar-killer-toggle-field").element,
    );
    expect(flipToggle.attributes("aria-checked")).toBe("false");
    expect(wrapper.get(".mania-converter__preview-content").classes()).not.toContain(
      "mania-converter__preview-content--flipped",
    );
    expect(wrapper.get(".mania-converter__preview").classes()).not.toContain(
      "mania-converter__preview--vertically-flipped",
    );
    expect(wrapper.get(".mania-converter__note").attributes("style")).toContain("bottom:");

    await flipToggle.trigger("click");
    expect(flipToggle.attributes("aria-checked")).toBe("true");
    expect(wrapper.get(".mania-converter__preview-content").classes()).toContain(
      "mania-converter__preview-content--flipped",
    );
    expect(wrapper.get(".mania-converter__preview").classes()).toContain(
      "mania-converter__preview--vertically-flipped",
    );
    expect(wrapper.get(".mania-converter__note").attributes("style")).toContain("top:");
    expect(wrapper.get(".mania-converter__note").attributes("style")).not.toContain("bottom:");

    await wrapper.findAll<HTMLSelectElement>(".mania-converter__settings-panel select")[0].setValue("4");
    await vi.waitFor(() => expect(wrapper.findAll(".mania-converter__lane")).toHaveLength(4));
    expect(wrapper.get(".mania-converter__download-all-button").attributes("disabled")).toBeDefined();
    expect(wrapper.get(".mania-converter__preview-navigation-download").attributes("disabled")).toBeDefined();

    await wrapper.get(".mania-converter__primary-button").trigger("click");
    await flushPromises();

    expect(wrapper.find(".mania-converter__preview").exists()).toBe(true);
    expect(wrapper.get(".mania-converter__stats").text()).toContain("BPM");
    expect(wrapper.get(".mania-converter__download-all-button").attributes("disabled")).toBeUndefined();
    expect(wrapper.get(".mania-converter__preview-navigation-download").attributes("disabled")).toBeUndefined();
    const previewNavigation = wrapper.get(".mania-converter__preview-navigation");
    expect(previewNavigation.find(".mania-converter__preview-navigation-download").exists()).toBe(true);
    expect(previewNavigation.find(".mania-converter__preview-navigator").element.nextElementSibling).toBe(
      previewNavigation.find(".mania-converter__preview-navigation-download").element,
    );
  });

  it("keeps an invalid-file warning when a selection also contains valid osu files", async () => {
    const wrapper = mount(OsuBeatmapConverter, { props: { language: "en" } });
    const validFile = new File([source], "sample.osu", { type: "text/plain" });
    const invalidFile = new File(["not a beatmap"], "notes.txt", { type: "text/plain" });

    selectFiles(wrapper.get<HTMLInputElement>(".mania-converter__file-input").element, [validFile, invalidFile]);
    await wrapper.get(".mania-converter__file-input").trigger("change");

    expect(wrapper.findAll(".mania-converter__queue-row")).toHaveLength(1);
    expect(wrapper.get(".mania-converter__error").text()).toBe("Only .osu files can be added.");
  });

  it("keeps the selected preview when another file is added", async () => {
    const wrapper = mount(OsuBeatmapConverter, { props: { language: "en" } });
    const firstFile = new File([source], "first.osu", { type: "text/plain" });
    const secondFile = new File([source], "second.osu", { type: "text/plain" });
    const thirdFile = new File([source], "third.osu", { type: "text/plain" });
    const input = wrapper.get<HTMLInputElement>(".mania-converter__file-input");

    selectFiles(input.element, [firstFile, secondFile]);
    await input.trigger("change");
    await vi.waitFor(() => expect(wrapper.findAll(".mania-converter__preview-panel select option")).toHaveLength(2));
    const previewSelect = wrapper.get<HTMLSelectElement>(".mania-converter__preview-panel select");
    await previewSelect.setValue("1");

    selectFiles(input.element, [thirdFile]);
    await input.trigger("change");
    await vi.waitFor(() => expect(wrapper.findAll(".mania-converter__preview-panel select option")).toHaveLength(3));

    expect(wrapper.get<HTMLSelectElement>(".mania-converter__preview-panel select").element.value).toBe("1");
  });

  it("hides a stale preview until the changed settings produce a replacement", async () => {
    const wrapper = mount(OsuBeatmapConverter, { props: { language: "en" } });
    const deferredRead = createDeferredTextRead();
    const file = new File([source], "sample.osu", { type: "text/plain" });
    let readCount = 0;
    Object.defineProperty(file, "text", {
      value: () => {
        readCount += 1;
        return readCount === 1 ? Promise.resolve(source) : deferredRead.promise;
      },
    });

    selectFiles(wrapper.get<HTMLInputElement>(".mania-converter__file-input").element, [file]);
    await wrapper.get(".mania-converter__file-input").trigger("change");
    await vi.waitFor(() => expect(wrapper.findAll(".mania-converter__lane")).toHaveLength(2));

    await wrapper.findAll<HTMLSelectElement>(".mania-converter__settings-panel select")[0].setValue("4");
    await flushPromises();
    expect(wrapper.find(".mania-converter__preview").exists()).toBe(false);

    deferredRead.resolveText(source);
    await vi.waitFor(() => expect(wrapper.findAll(".mania-converter__lane")).toHaveLength(4));
  });

  it("ignores dropped files while converting and renders timing lines with a movable full-map navigator", async () => {
    const wrapper = mount(OsuBeatmapConverter, { props: { language: "en" } });
    const deferredRead = createDeferredTextRead();
    const firstFile = new File([sourceWithTimingChange], "first.osu", { type: "text/plain" });
    Object.defineProperty(firstFile, "text", { value: () => deferredRead.promise });
    const droppedFile = new File([source], "dropped.osu", { type: "text/plain" });

    selectFiles(wrapper.get<HTMLInputElement>(".mania-converter__file-input").element, [firstFile]);
    await wrapper.get(".mania-converter__file-input").trigger("change");
    await wrapper.findAll<HTMLSelectElement>(".mania-converter__settings-panel select")[1].setValue("none");
    await wrapper.get(".mania-converter__primary-button").trigger("click");
    await wrapper.get(".mania-converter__drop-zone").trigger("drop", { dataTransfer: { files: [droppedFile] } });

    expect(wrapper.findAll(".mania-converter__queue-row")).toHaveLength(1);
    deferredRead.resolveText(sourceWithTimingChange);
    await flushPromises();

    expect(wrapper.findAll(".mania-converter__queue-row")).toHaveLength(1);
    expect(wrapper.findAll(".mania-converter__beat-line")).toHaveLength(15);
    expect(wrapper.findAll(".mania-converter__timing-line--red")).toHaveLength(2);
    expect(wrapper.findAll(".mania-converter__timing-line--green")).toHaveLength(1);

    const navigator = wrapper.get(".mania-converter__preview-navigator");
    expect(wrapper.findAll(".mania-converter__preview-content")).toHaveLength(1);
    expect(wrapper.get(".mania-converter__preview-navigation-time").text()).toBe("0:00.000");
    expect(navigator.attributes("role")).toBe("slider");
    expect(navigator.find(".mania-converter__navigator-window").exists()).toBe(true);
    expect(navigator.findAll(".mania-converter__navigator-timing-line--red")).toHaveLength(2);
    expect(navigator.findAll(".mania-converter__navigator-timing-line--green")).toHaveLength(1);
    expect(Number(navigator.attributes("aria-valuenow"))).toBe(0);

    await navigator.trigger("keydown", { key: "ArrowRight" });
    expect(Number(navigator.attributes("aria-valuenow"))).toBe(500);
    expect(wrapper.findAll(".mania-converter__timing-line--red")).toHaveLength(1);
    expect(wrapper.findAll(".mania-converter__timing-line--green")).toHaveLength(1);

    await navigator.trigger("keydown", { key: "ArrowRight" });
    await navigator.trigger("keydown", { key: "ArrowRight" });
    expect(wrapper.findAll(".mania-converter__timing-line--red")).toHaveLength(0);
    expect(wrapper.findAll(".mania-converter__timing-line--green")).toHaveLength(1);
    expect(wrapper.findAll(".mania-converter__note")).toHaveLength(1);
    expect(wrapper.findAll(".mania-converter__stats dd")[0].text()).toBe("240");
    expect(wrapper.get(".mania-converter__preview-navigation-time").text()).toBe("0:01.000");

    Object.defineProperty(navigator.element, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, width: 100 }),
    });
    await navigator.trigger("pointerdown", { clientX: 20, pointerId: 1 });
    await navigator.trigger("pointerdown", { clientX: 80, pointerId: 2 });
    await navigator.trigger("pointermove", { clientX: 80, pointerId: 2 });
    await navigator.trigger("pointerup", { pointerId: 2 });
    await navigator.trigger("pointermove", { clientX: 60, pointerId: 1 });
    await navigator.trigger("pointerup", { pointerId: 1 });
    expect(Number(navigator.attributes("aria-valuenow"))).toBe(5500);
    expect(wrapper.findAll(".mania-converter__timing-line--red")).toHaveLength(0);
    expect(wrapper.findAll(".mania-converter__timing-line--green")).toHaveLength(0);
    expect(wrapper.findAll(".mania-converter__note")).toHaveLength(0);

    await navigator.trigger("pointerdown", { clientX: 0, pointerId: 2 });
    await navigator.trigger("pointerup", { pointerId: 2 });
    expect(wrapper.findAll(".mania-converter__timing-line--red")).toHaveLength(2);
    expect(wrapper.findAll(".mania-converter__timing-line--green")).toHaveLength(1);
    expect(wrapper.findAll(".mania-converter__note")).toHaveLength(2);
    expect(wrapper.findAll(".mania-converter__stats dd")[0].text()).toBe("120");

    await navigator.trigger("keydown", { key: "End" });
    expect(Number(navigator.attributes("aria-valuenow"))).toBe(Number(navigator.attributes("aria-valuemax")));
    await navigator.trigger("keydown", { key: "ArrowRight" });
    expect(Number(navigator.attributes("aria-valuenow"))).toBe(Number(navigator.attributes("aria-valuemax")));
    await navigator.trigger("keydown", { key: "Home" });
    await navigator.trigger("keydown", { key: "ArrowLeft" });
    expect(Number(navigator.attributes("aria-valuenow"))).toBe(Number(navigator.attributes("aria-valuemin")));
  });

  it("keeps a temporary beat grid separate from output timing markers", async () => {
    const wrapper = mount(OsuBeatmapConverter, { props: { language: "en" } });
    await wrapper.findAll<HTMLSelectElement>(".mania-converter__settings-panel select")[1].setValue("none");
    const file = new File([sourceWithInitialGreenLine], "green-first.osu", { type: "text/plain" });

    selectFiles(wrapper.get<HTMLInputElement>(".mania-converter__file-input").element, [file]);
    await wrapper.get(".mania-converter__file-input").trigger("change");
    await vi.waitFor(() => expect(wrapper.find(".mania-converter__preview").exists()).toBe(true));

    expect(wrapper.findAll(".mania-converter__timing-line--red")).toHaveLength(1);
    expect(wrapper.findAll(".mania-converter__timing-line--green")).toHaveLength(1);
    expect(wrapper.findAll(".mania-converter__navigator-timing-line--red")).toHaveLength(1);
    expect(wrapper.findAll(".mania-converter__navigator-timing-line--green")).toHaveLength(1);
    expect(wrapper.findAll(".mania-converter__stats dd")[0].text()).toBe("120");
  });

  it("does not draw a red marker when output keeps only an initial green line", async () => {
    const wrapper = mount(OsuBeatmapConverter, { props: { language: "en" } });
    const file = new File([sourceWithInitialGreenLine], "green-only.osu", { type: "text/plain" });

    selectFiles(wrapper.get<HTMLInputElement>(".mania-converter__file-input").element, [file]);
    await wrapper.get(".mania-converter__file-input").trigger("change");
    await vi.waitFor(() => expect(wrapper.find(".mania-converter__preview").exists()).toBe(true));

    expect(wrapper.findAll(".mania-converter__timing-line--red")).toHaveLength(0);
    expect(wrapper.findAll(".mania-converter__timing-line--green")).toHaveLength(1);
    expect(wrapper.findAll(".mania-converter__navigator-timing-line--red")).toHaveLength(0);
    expect(wrapper.findAll(".mania-converter__navigator-timing-line--green")).toHaveLength(1);
    expect(wrapper.findAll(".mania-converter__stats dd")[0].text()).toBe("120");
  });

  it("drags from the visible minimum-size navigator circle without first recentering it", async () => {
    const wrapper = mount(OsuBeatmapConverter, { props: { language: "en" } });
    const file = new File([sourceWithLongRange], "long.osu", { type: "text/plain" });

    selectFiles(wrapper.get<HTMLInputElement>(".mania-converter__file-input").element, [file]);
    await wrapper.get(".mania-converter__file-input").trigger("change");
    await vi.waitFor(() => expect(wrapper.find(".mania-converter__preview-navigator").exists()).toBe(true));

    const navigator = wrapper.get(".mania-converter__preview-navigator");
    Object.defineProperty(navigator.element, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, width: 100 }),
    });

    // The actual four-measure range is eight pixels wide, but CSS keeps the visible window at 28 pixels.
    await navigator.trigger("pointerdown", { clientX: 10, pointerId: 1 });
    expect(Number(navigator.attributes("aria-valuenow"))).toBe(0);
    await navigator.trigger("pointermove", { clientX: 20, pointerId: 1 });
    expect(Number(navigator.attributes("aria-valuenow"))).toBeCloseTo(5833.333333, 5);
    await navigator.trigger("pointerup", { pointerId: 1 });
  });

  it("keeps the minimum-size navigator thumb inside the track at the right edge", async () => {
    const wrapper = mount(OsuBeatmapConverter, { props: { language: "en" } });
    const file = new File([sourceWithLongRange], "long.osu", { type: "text/plain" });

    selectFiles(wrapper.get<HTMLInputElement>(".mania-converter__file-input").element, [file]);
    await wrapper.get(".mania-converter__file-input").trigger("change");
    await vi.waitFor(() => expect(wrapper.find(".mania-converter__preview-navigator").exists()).toBe(true));

    const navigator = wrapper.get(".mania-converter__preview-navigator");
    await navigator.trigger("keydown", { key: "End" });

    const windowStyle = navigator.get(".mania-converter__navigator-window").attributes("style");
    expect(windowStyle).toContain("--mania-converter-navigator-window-left: 84%");
    expect(windowStyle).toContain("--mania-converter-navigator-window-width: 16%");

    Object.defineProperty(navigator.element, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, width: 100 }),
    });
    await navigator.trigger("pointerdown", { clientX: 80, pointerId: 1 });
    expect(Number(navigator.attributes("aria-valuenow"))).toBe(Number(navigator.attributes("aria-valuemax")));
    await navigator.trigger("pointermove", { clientX: 70, pointerId: 1 });
    expect(Number(navigator.attributes("aria-valuenow"))).toBeLessThan(Number(navigator.attributes("aria-valuemax")));
    await navigator.trigger("pointerup", { pointerId: 1 });
  });

  it("keeps preview selection stable and disables downloads during a second conversion", async () => {
    const wrapper = mount(OsuBeatmapConverter, { props: { language: "en" } });
    const deferredRead = createDeferredTextRead();
    const file = new File([source], "sample.osu", { type: "text/plain" });
    let readCount = 0;
    Object.defineProperty(file, "text", {
      value: () => {
        readCount += 1;
        return readCount < 3 ? Promise.resolve(source) : deferredRead.promise;
      },
    });

    selectFiles(wrapper.get<HTMLInputElement>(".mania-converter__file-input").element, [file]);
    await wrapper.get(".mania-converter__file-input").trigger("change");
    await vi.waitFor(() => expect(wrapper.findAll(".mania-converter__lane")).toHaveLength(2));
    await wrapper.get(".mania-converter__primary-button").trigger("click");
    await vi.waitFor(() =>
      expect(wrapper.get(".mania-converter__download-all-button").attributes("disabled")).toBeUndefined(),
    );

    await wrapper.get(".mania-converter__primary-button").trigger("click");
    expect(wrapper.get(".mania-converter__download-all-button").attributes("disabled")).toBeDefined();
    expect(wrapper.get(".mania-converter__preview-navigation-download").attributes("disabled")).toBeDefined();
    expect(wrapper.get(".mania-converter__preview-navigator").attributes("aria-disabled")).toBe("true");
    expect(wrapper.get(".mania-converter__preview-navigator").attributes("tabindex")).toBe("-1");

    deferredRead.resolveText(source);
    await vi.waitFor(() =>
      expect(wrapper.get(".mania-converter__download-all-button").attributes("disabled")).toBeUndefined(),
    );
  });
});
