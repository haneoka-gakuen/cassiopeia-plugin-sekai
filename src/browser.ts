import { CassiopeiaRuntime } from "@haneoka/cassiopeia/plugin";
import { MediaClock } from "@haneoka/cassiopeia-host-web";
import { createEmbedLoader } from "@haneoka/embed-core";
import type { EmbedLoaderOptions } from "@haneoka/embed-core";
import { createHaneokaBranding } from "@haneoka/embed-core/branding";
import { createSekaiPlugin, SEKAI_DISPLAY } from "./plugin.js";
import { SekaiCanvasRenderer } from "./renderer.js";
import type { SekaiRendererOptions } from "./renderer.js";
import type { SekaiDocument } from "./types.js";

export { SekaiCanvasRenderer, sekaiRendererAdapter } from "./renderer.js";
export type { SekaiRendererOptions } from "./renderer.js";

export interface MountSekaiOptions extends EmbedLoaderOptions<SekaiDocument>, SekaiRendererOptions {
  readonly signal?: AbortSignal;
  readonly volume?: number;
  readonly rate?: number;
  readonly onTime?: (mediaSeconds: number, chartTimeMs: number) => void;
  readonly onError?: (error: unknown) => void;
}
export interface SekaiPreviewHandle {
  readonly document: SekaiDocument;
  readonly time: number;
  readonly duration: number;
  readonly playing: boolean;
  play(): Promise<void>;
  pause(): void;
  seek(mediaSeconds: number): void;
  setRate(rate: number): void;
  setVolume(volume: number): void;
  setScrollDurationMs(milliseconds: number): void;
  dispose(): Promise<void>;
}

/** Independent audio-clock consumer composed through CassiopeiaRuntime. */
export async function mountSekaiPreview(element: HTMLElement, options: MountSekaiOptions): Promise<SekaiPreviewHandle> {
  const controller = new AbortController();
  const loader = createEmbedLoader(options);
  const runtime = new CassiopeiaRuntime([createSekaiPlugin()]);
  const releases: Array<() => void> = [];
  let renderer: SekaiCanvasRenderer | undefined, clock: MediaClock | undefined;
  let observer: ResizeObserver | undefined, brand: HTMLAnchorElement | undefined;
  let frame = 0,
    disposed = false,
    intent = 0,
    wantsPlay = false;
  let disposal: Promise<void> | undefined;
  const view = element.ownerDocument.defaultView!;
  const oldPosition = element.style.position;
  const changedPosition = view.getComputedStyle(element).position === "static";
  const dispose = (): Promise<void> => {
    if (disposal) return disposal;
    disposed = true;
    wantsPlay = false;
    intent++;
    controller.abort();
    view.cancelAnimationFrame(frame);
    observer?.disconnect();
    for (const release of releases.splice(0)) release();
    clock?.destroy();
    renderer?.dispose();
    brand?.remove();
    runtime.dispose();
    if (changedPosition) element.style.position = oldPosition;
    disposal = loader.dispose();
    return disposal;
  };
  const abort = () => {
    void dispose().catch((error) => options.onError?.(error));
  };
  options.signal?.addEventListener("abort", abort, { once: true });
  releases.push(() => options.signal?.removeEventListener("abort", abort));
  try {
    options.signal?.throwIfAborted();
    const document = await loader.load({ signal: controller.signal });
    if (!document.audio) throw new TypeError("Sekai preview requires an audio resource");
    const audioUrl = await loader.resourceUrl(document.audio, { signal: controller.signal });
    controller.signal.throwIfAborted();
    const session = runtime.require(SEKAI_DISPLAY).createSession(document.chart);
    renderer = new SekaiCanvasRenderer(element, document.chart, options);
    if (changedPosition) element.style.position = "relative";
    brand = createHaneokaBranding(element.ownerDocument);
    element.append(brand);
    clock = new MediaClock(audioUrl, { volume: options.volume ?? 0.8, playbackRate: options.rate ?? 1 });
    const media = clock.audio;
    const render = () => {
      frame = 0;
      if (disposed) return;
      const current = clock!.timeMs;
      renderer!.render(session.updateReusable(current - document.bgmOffsetMs));
      options.onTime?.(current / 1000, current - document.bgmOffsetMs);
      if (!disposed && clock!.advancing) frame = view.requestAnimationFrame(render);
    };
    const request = () => {
      if (!disposed && !frame) frame = view.requestAnimationFrame(render);
    };
    const listen = (name: string, action: () => void) => {
      media.addEventListener(name, action);
      releases.push(() => media.removeEventListener(name, action));
    };
    const pause = () => {
      wantsPlay = false;
      intent++;
      clock!.pause();
      request();
    };
    listen("playing", () => {
      if (!wantsPlay) clock!.pause();
      request();
    });
    for (const name of ["pause", "waiting", "stalled", "timeupdate", "seeking", "seeked", "loadedmetadata", "ended"])
      listen(name, request);
    listen("error", () => {
      pause();
      options.onError?.(new Error(media.error?.message ?? "Audio could not be loaded"));
    });
    const visibility = () => {
      if (element.ownerDocument.visibilityState === "hidden") pause();
    };
    element.ownerDocument.addEventListener("visibilitychange", visibility);
    releases.push(() => element.ownerDocument.removeEventListener("visibilitychange", visibility));
    const resize = () => {
      renderer!.resize(element.clientWidth, element.clientHeight, view.devicePixelRatio);
      request();
    };
    observer = new view.ResizeObserver(resize);
    observer.observe(element);
    resize();
    const ensureLive = () => {
      if (disposed) throw new Error("Sekai preview is disposed");
    };
    return {
      document,
      get time() {
        return clock!.timeMs / 1000;
      },
      get duration() {
        return clock!.durationMs / 1000;
      },
      get playing() {
        return !disposed && clock!.advancing;
      },
      async play() {
        ensureLive();
        const revision = ++intent;
        wantsPlay = true;
        try {
          await clock!.play();
        } catch (error) {
          if (revision === intent) wantsPlay = false;
          throw error;
        }
        if (disposed || revision !== intent) {
          if (!wantsPlay) clock!.pause();
          return;
        }
        request();
      },
      pause() {
        ensureLive();
        pause();
      },
      seek(seconds) {
        ensureLive();
        if (!Number.isFinite(seconds)) throw new RangeError("Media seconds must be finite");
        clock!.seek(seconds * 1000);
        request();
      },
      setRate(rate) {
        ensureLive();
        clock!.rate = rate;
        request();
      },
      setVolume(volume) {
        ensureLive();
        if (!Number.isFinite(volume)) throw new RangeError("Volume must be finite");
        clock!.volume = volume;
      },
      setScrollDurationMs(milliseconds) {
        ensureLive();
        renderer!.setScrollDurationMs(milliseconds);
        request();
      },
      dispose,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}
