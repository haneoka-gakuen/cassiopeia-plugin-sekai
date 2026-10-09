import { FeverState } from "@haneoka/cassiopeia";
import type { ChartMode, ChartSessionEventMap, SessionSnapshot, JudgementEvent, InputVector, ChartDocument } from "@haneoka/cassiopeia";
import type { CassiopeiaSessionPort } from "@haneoka/cassiopeia/plugin";

/** Display-only port. Time comes from the host's media clock; no scoring rules run. */
export class SekaiPreviewSession implements CassiopeiaSessionPort {
  mode: ChartMode = "watch";
  /** Port compatibility only; display mode performs no assist calculations. */
  readonly assistLevel = 0;
  private timeMs = 0;
  private readonly noteById;
  private readonly spans;
  private readonly listeners = new Map<keyof ChartSessionEventMap, Set<(event: never) => void>>();
  private readonly current: SessionSnapshot;
  constructor(readonly chart: ChartDocument) {
    this.noteById = new Map(chart.notes.map((note) => [note.id, note]));
    this.spans = new Map(chart.lines.map((line) => [line.id, [this.noteById.get(line.noteIds[0]!)!.timeMs, this.noteById.get(line.noteIds.at(-1)!)!.timeMs] as const]));
    this.current = {
      timeMs: 0, durationMs: chart.durationMs, activeLongLine: false,
      combo: 0, fullCombo: false, allPerfect: false, perfectCombo: false, maxCombo: 0, score: 0, life: 0, processed: 0, total: 0,
      lastJudgement: null, lastSkill: null, callChange: null, feverState: FeverState.Wait, feverSection: null,
      noteState: { isProcessed: (id) => (this.noteById.get(id)?.timeMs ?? Infinity) < this.timeMs },
      lineState: { isActive: (id) => { const span = this.spans.get(id); return !!span && span[0] <= this.timeMs && this.timeMs < span[1]; } },
    };
  }
  on<K extends keyof ChartSessionEventMap>(type: K, listener: (event: ChartSessionEventMap[K]) => void): () => void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener as (event: never) => void); this.listeners.set(type, listeners);
    return () => { listeners.delete(listener as (event: never) => void); };
  }
  private emit(type: "reset" | "update", snapshot: SessionSnapshot): void {
    for (const listener of this.listeners.get(type) ?? []) listener(snapshot as never);
  }
  setMode(mode: ChartMode): void {
    if (mode === "play") throw new TypeError("SekaiPreviewSession supports watch/chart display; Sekai gameplay rules are required for play mode");
    this.mode = mode;
  }
  setOffset(milliseconds: number): void {
    if (milliseconds !== 0) throw new TypeError("Display-only sessions have no judgement offset; use bgmOffsetMs for media alignment");
  }
  updateReusable(timeMs: number): SessionSnapshot {
    if (!Number.isFinite(timeMs)) throw new RangeError("Media time must be finite");
    this.timeMs = timeMs; this.current.timeMs = timeMs;
    this.emit("update", this.current); return this.current;
  }
  update(timeMs: number): SessionSnapshot { this.updateReusable(timeMs); return this.snapshot(); }
  reset(timeMs = 0): SessionSnapshot { this.updateReusable(timeMs); const value = this.snapshot(); this.emit("reset", value); return value; }
  finish(timeMs = this.chart.durationMs): SessionSnapshot { return this.update(timeMs); }
  snapshot(): SessionSnapshot { return { ...this.current }; }
  hasInputCandidate(_lane: number, _timeMs?: number, _pointerId?: number): boolean { return false; }
  tap(_lane: number, _timeMs?: number, _pointerId?: number): JudgementEvent | null { return null; }
  release(_lane: number, _timeMs?: number, _pointerId?: number): JudgementEvent | null { return null; }
  flick(_lane: number, _vector: InputVector, _timeMs?: number, _pointerId?: number): JudgementEvent | null { return null; }
  trace(_lane: number, _timeMs?: number, _pointerId?: number): JudgementEvent | null { return null; }
  cancel(_pointerId?: number): void {}
}
