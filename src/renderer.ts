import { VisualTimeMap } from "@haneoka/cassiopeia";
import type { SessionSnapshot } from "@haneoka/cassiopeia";
import { sekaiEase } from "./convert.js";
import type { SekaiChart, SekaiNote } from "./types.js";

export interface SekaiRendererOptions {
  /** Time required to traverse the stage at source timeScale=1. */
  readonly scrollDurationMs?: number;
  readonly label?: string;
}

/** Original vector preview, using the host's Material tokens rather than game assets. */
export class SekaiCanvasRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly map: VisualTimeMap;
  private readonly paths: SekaiNote[][];
  private readonly visualNotes: readonly { note: SekaiNote; visualMs: number }[];
  private width = 1;
  private height = 1;
  private scrollDurationMs: number;
  private disposed = false;
  private colors = { surface: "Canvas", outline: "GrayText", normal: "CanvasText", critical: "Highlight", flick: "Highlight", trace: "Highlight" };
  constructor(private readonly element: HTMLElement, chart: SekaiChart, options: SekaiRendererOptions = {}) {
    this.scrollDurationMs = checkedDuration(options.scrollDurationMs ?? 1800);
    this.map = new VisualTimeMap(chart.timeScaleChanges);
    this.visualNotes = chart.notes.map((note) => ({ note, visualMs: this.map.toScaledTimeMs(note.timeMs) }));
    const noteById = new Map(chart.notes.map((note) => [note.id, note]));
    this.paths = chart.lines.map((line) => line.noteIds.map((id) => noteById.get(id)!).filter((note) => note.sekai.kind !== "attach"));
    this.canvas = element.ownerDocument.createElement("canvas");
    this.canvas.style.cssText = "display:block;width:100%;height:100%;";
    this.canvas.setAttribute("role", "img");
    this.canvas.setAttribute("aria-label", options.label ?? "Sekai chart preview");
    const context = this.canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas 2D is unavailable");
    this.context = context; element.append(this.canvas);
  }
  setScrollDurationMs(value: number): void { this.scrollDurationMs = checkedDuration(value); }
  resize(width: number, height: number, pixelRatio: number): void {
    if (this.disposed) return;
    this.width = Math.max(1, width); this.height = Math.max(1, height);
    const ratio = Math.min(2, Math.max(1, Number.isFinite(pixelRatio) ? pixelRatio : 1));
    this.canvas.width = Math.ceil(this.width * ratio); this.canvas.height = Math.ceil(this.height * ratio);
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const style = this.element.ownerDocument.defaultView!.getComputedStyle(this.element);
    const token = (name: string, fallback: string) => style.getPropertyValue(`--md-sys-color-${name}`).trim() || fallback;
    this.colors = { surface: token("surface", "Canvas"), outline: token("outline-variant", "GrayText"), normal: token("on-surface", "CanvasText"),
      critical: token("secondary", "Highlight"), flick: token("tertiary", "Highlight"), trace: token("primary", "Highlight") };
  }
  render(snapshot: SessionSnapshot, _options?: unknown): void {
    if (this.disposed) return;
    const context = this.context, width = this.width, height = this.height;
    const margin = width * 0.055, stageWidth = width - margin * 2, hitY = height * 0.88;
    const now = this.map.toScaledTimeMs(snapshot.timeMs);
    const far = now + this.scrollDurationMs;
    const x = (lane: number) => margin + (lane + 6) / 12 * stageWidth;
    const y = (timeMs: number) => hitY - (this.map.toScaledTimeMs(timeMs) - now) / this.scrollDurationMs * hitY;
    context.fillStyle = this.colors.surface; context.fillRect(0, 0, width, height);
    context.strokeStyle = this.colors.outline; context.lineWidth = 1;
    for (let lane = 0; lane <= 12; lane++) { const laneX = margin + lane / 12 * stageWidth; context.beginPath(); context.moveTo(laneX, 0); context.lineTo(laneX, hitY); context.stroke(); }
    context.strokeStyle = this.colors.normal; context.beginPath(); context.moveTo(margin, hitY); context.lineTo(width - margin, hitY); context.stroke();
    for (const path of this.paths) for (let i = 1; i < path.length; i++) {
      const head = path[i - 1]!, tail = path[i]!;
      if (tail.timeMs < snapshot.timeMs || this.map.toScaledTimeMs(head.timeMs) > far) continue;
      const start = Math.max(head.timeMs, snapshot.timeMs), end = Math.min(tail.timeMs, this.map.toTimeMs(far));
      if (end <= start) continue;
      const point = (timeMs: number) => {
        const p = sekaiEase(head.sekai.ease, (this.map.toScaledTimeMs(timeMs) - this.map.toScaledTimeMs(head.timeMs)) / (this.map.toScaledTimeMs(tail.timeMs) - this.map.toScaledTimeMs(head.timeMs)));
        const left = head.pos + (tail.pos - head.pos) * p;
        const size = head.size + (tail.size - head.size) * p;
        return { left: margin + left / 24 * stageWidth, right: margin + (left + size) / 24 * stageWidth, y: y(timeMs) };
      };
      context.fillStyle = head.critical ? this.colors.critical : this.colors.trace;
      context.globalAlpha = head.sekai.active ? 0.3 : 0.12;
      context.beginPath();
      for (let step = 0; step <= 16; step++) { const p = point(start + (end - start) * step / 16); if (step === 0) context.moveTo(p.left, p.y); else context.lineTo(p.left, p.y); }
      for (let step = 16; step >= 0; step--) { const p = point(start + (end - start) * step / 16); context.lineTo(p.right, p.y); }
      context.closePath(); context.fill(); context.globalAlpha = 1;
    }
    let low = 0, high = this.visualNotes.length;
    while (low < high) { const mid = (low + high) >>> 1; if (this.visualNotes[mid]!.visualMs < now) low = mid + 1; else high = mid; }
    for (let i = low; i < this.visualNotes.length; i++) {
      const { note, visualMs } = this.visualNotes[i]!;
      if (visualMs > far) break;
      if (!note.visible) continue;
      const center = x(note.laneX * 6), noteWidth = note.width / 2 * stageWidth, noteY = y(note.timeMs);
      context.fillStyle = note.critical ? this.colors.critical : note.sekai.direction ? this.colors.flick : note.sekai.trace || note.lineIds.length ? this.colors.trace : this.colors.normal;
      if (note.sekai.kind === "slide-tick") {
        context.beginPath(); context.arc(center, noteY, 3, 0, Math.PI * 2); context.fill();
      } else {
        const thickness = note.sekai.trace ? 3 : 8;
        context.fillRect(center - noteWidth / 2, noteY - thickness / 2, noteWidth, thickness);
      }
      if (note.sekai.direction) {
        const tilt = note.sekai.direction === "left" ? -8 : note.sekai.direction === "right" ? 8 : 0;
        context.strokeStyle = context.fillStyle; context.lineWidth = 3;
        context.beginPath(); context.moveTo(center - 7 + tilt, noteY - 13); context.lineTo(center + tilt, noteY - 20); context.lineTo(center + 7 + tilt, noteY - 13); context.stroke();
      }
    }
    this.canvas.dataset.chartTimeMs = String(snapshot.timeMs);
  }
  dispose(): void { if (this.disposed) return; this.disposed = true; this.canvas.remove(); this.canvas.width = this.canvas.height = 1; }
}

function checkedDuration(value: number): number {
  if (!Number.isFinite(value) || value < 100 || value > 10000) throw new RangeError("scrollDurationMs must be 100..10000");
  return value;
}

/** Structural ChartRendererAdapter for @haneoka/embed-cassiopeia. */
export function sekaiRendererAdapter(chart: SekaiChart, options: SekaiRendererOptions = {}) {
  return { create: ({ element, signal }: { element: HTMLElement; signal: AbortSignal }) => {
    signal.throwIfAborted(); return new SekaiCanvasRenderer(element, chart, options);
  } };
}
