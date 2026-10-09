import type { ChartDocument, ChartNote, ChartLine } from "@haneoka/cassiopeia";

export interface SekaiIssue {
  readonly line: number;
  readonly code: "unsupported" | "invalid";
  readonly raw: string;
  readonly message: string;
}
export class SekaiFormatError extends Error {
  constructor(readonly issues: readonly SekaiIssue[]) {
    super(issues.map((issue) => `Line ${issue.line}: ${issue.message}`).join("\n"));
    this.name = "SekaiFormatError";
  }
}
export interface SekaiNote extends ChartNote {
  readonly sekai: {
    readonly kind: "tap" | "flick" | "trace" | "slide-start" | "slide-end" | "slide-tick" | "hidden" | "attach";
    readonly trace: boolean;
    readonly direction?: "up" | "left" | "right";
    /** Outgoing source interpolation; independent of the Our Notes easing enum. */
    readonly ease: "linear" | "in" | "out";
    readonly active: boolean;
    readonly objectIndex: number;
    readonly connectionIndex?: number;
  };
}
export interface SekaiLine extends ChartLine {
  readonly sekai: { readonly active: boolean; readonly kind: "hold" | "slide" | "guide" };
}
export interface SekaiChart extends ChartDocument {
  notes: SekaiNote[];
  lines: SekaiLine[];
}
export interface SekaiDocument {
  readonly chart: SekaiChart;
  /** Original text, including unsupported metadata and source modifiers. */
  readonly sourceSus: string;
  readonly metadata: Readonly<Record<string, string>>;
  /** Media time = chart time + bgmOffsetMs. WAVEOFFSET is negated once. */
  readonly bgmOffsetMs: number;
  readonly audio?: string;
  readonly sourceUrl?: string;
}
export interface SekaiConvertOptions {
  readonly audio?: string;
  readonly sourceUrl?: string;
  /** Explicit replacement for SUS WAVEOFFSET; never inferred from fillerSec. */
  readonly bgmOffsetMs?: number;
}
