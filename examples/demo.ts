import "@material/web/button/filled-button.js";
import "@material/web/button/outlined-button.js";
import "@material/web/slider/slider.js";
import "@material/web/select/outlined-select.js";
import "@material/web/select/select-option.js";
import "@material/web/progress/linear-progress.js";
import "./demo.css";
import { fileResourceResolver } from "@haneoka/embed-core";
import { sekaiDataSource } from "../src/index.js";
import { mountSekaiPreview } from "../src/browser.js";
import type { SekaiPreviewHandle, MountSekaiOptions } from "../src/browser.js";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const strings: Record<string, Record<string, string>> = await (await fetch("./messages.json")).json();
const sample = await (await fetch("./sample.json")).json();
const locales = [
  ["ja", "日本語"],
  ["en", "English"],
  ["zh-TW", "繁體中文"],
  ["zh-CN", "简体中文"],
  ["ko", "한국어"],
];
type Slider = HTMLElement & { value: number; max: number; disabled: boolean };
type Language = HTMLElement & { value: string };
const language = $<Language>("language");
const navLocale = navigator.language;
let locale = strings[navLocale]
  ? navLocale
  : navLocale.startsWith("zh")
    ? "zh-CN"
    : strings[navLocale.slice(0, 2)]
      ? navLocale.slice(0, 2)
      : "en";
for (const [value, label] of locales) {
  const option = document.createElement("md-select-option");
  option.setAttribute("value", value!);
  const headline = document.createElement("div");
  headline.slot = "headline";
  headline.textContent = label!;
  option.append(headline);
  language.append(option);
}
let handle: SekaiPreviewHandle | undefined;
let operation: AbortController | undefined;
let revision = 0;
let statusKey = "choose";
const t = (key: string) => strings[locale]![key] ?? key;
const status = (key: string) => {
  statusKey = key;
  $("status").textContent = t(key);
};
const controls = (enabled: boolean) => {
  for (const id of ["play", "pause", "dispose", "seek"]) $<HTMLElement & { disabled: boolean }>(id).disabled = !enabled;
};
const renderLabels = () => {
  document.documentElement.lang = locale;
  language.value = locale;
  for (const [id, key] of [
    ["chart-file", "chart"],
    ["audio-file", "audio"],
    ["sample", "sample"],
    ["play", "play"],
    ["pause", "pause"],
    ["dispose", "dispose"],
    ["seek-label", "seek"],
    ["rate-label", "rate"],
    ["scroll-label", "scroll"],
  ])
    $(id!).textContent = t(key!);
  $("progress").setAttribute("aria-label", t("loading"));
  $("stage").setAttribute("aria-label", t("preview"));
  status(statusKey);
};
language.addEventListener("change", () => {
  locale = language.value;
  renderLabels();
});
renderLabels();
$("chart-source").setAttribute("href", sample.sus);
$("audio-source").setAttribute("href", sample.audio);

async function load(options: Pick<MountSekaiOptions, "source" | "resolveResource">) {
  const epoch = ++revision;
  operation?.abort();
  operation = new AbortController();
  const signal = operation.signal;
  controls(false);
  $("progress").hidden = false;
  status("loading");
  await handle?.dispose();
  handle = undefined;
  if (signal.aborted) return;
  try {
    const mounted = await mountSekaiPreview($("stage"), {
      ...options,
      signal,
      rate: $<Slider>("rate").value,
      scrollDurationMs: $<Slider>("scroll").value,
      label: t("preview"),
      onError: (error) => {
        if (epoch === revision) {
          status("error");
          $("status").append(`: ${String(error)}`);
        }
      },
      onTime(seconds) {
        if (epoch !== revision) return;
        $("time").textContent = `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
        if (handle?.duration) $<Slider>("seek").max = handle.duration;
        $<Slider>("seek").value = seconds;
      },
    });
    if (epoch !== revision) {
      await mounted.dispose();
      return;
    }
    handle = mounted;
    controls(true);
    status("ready");
  } catch (error) {
    if (epoch === revision && !signal.aborted) {
      status("error");
      $("status").append(`: ${String(error)}`);
    }
  } finally {
    if (epoch === revision) $("progress").hidden = true;
  }
}

$("sample").addEventListener("click", () => {
  void load({ source: sekaiDataSource({ sus: new URL(sample.sus), audio: sample.audio }) });
});
for (const [button, input] of [
  ["chart-file", "sus"],
  ["audio-file", "audio"],
])
  $(button!).addEventListener("click", () => $<HTMLInputElement>(input!).click());
const local = () => {
  const sus = $<HTMLInputElement>("sus").files?.[0],
    audio = $<HTMLInputElement>("audio").files?.[0];
  if (sus && audio)
    void load({
      source: sekaiDataSource({ sus, audio: "local-audio" }),
      resolveResource: fileResourceResolver(new Map([["local-audio", audio]])),
    });
};
$("sus").addEventListener("change", local);
$("audio").addEventListener("change", local);
$("play").addEventListener("click", () => {
  void handle?.play().catch((error) => {
    status("error");
    $("status").append(`: ${String(error)}`);
  });
});
$("pause").addEventListener("click", () => handle?.pause());
$("dispose").addEventListener("click", () => {
  ++revision;
  operation?.abort();
  void handle?.dispose();
  handle = undefined;
  controls(false);
  $("progress").hidden = true;
  status("choose");
});
$("seek").addEventListener("input", () => handle?.seek($<Slider>("seek").value));
$("rate").addEventListener("input", () => handle?.setRate($<Slider>("rate").value));
$("scroll").addEventListener("input", () => handle?.setScrollDurationMs($<Slider>("scroll").value));
window.addEventListener("pagehide", () => {
  operation?.abort();
  void handle?.dispose();
});
