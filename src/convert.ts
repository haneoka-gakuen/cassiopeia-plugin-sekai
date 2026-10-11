import {
  JudgementAreaOffsetType,
  NoteDirection,
  NoteJudgementType,
  NoteLineEaseType,
  NoteOperateType,
  PPQ,
  VisualTimeMap,
} from "@haneoka/cassiopeia";
import { susToUSC } from "./vendor/convert.js";
import type { USCSlideNote } from "./vendor/usc.js";
import { SekaiFormatError } from "./types.js";
import type { SekaiConvertOptions, SekaiDocument, SekaiIssue, SekaiNote, SekaiLine } from "./types.js";

interface Row {
  header: string;
  data: string;
  line: number;
  raw: string;
  measureOffset: number;
}
const numeric = (text: string) => Number(text);
const positive = (text: string) => Number.isFinite(numeric(text)) && numeric(text) > 0;
const unquote = (text: string) => text.replace(/^"|"$/gu, "");

const LINE_EASE = { linear: NoteLineEaseType.Linear, in: NoteLineEaseType.EaseIn, out: NoteLineEaseType.EaseOut };
/** Shape-only nodes and guide ends take no input. */
const UNJUDGED = new Set([NoteOperateType.Hidden, NoteOperateType.GuideBegin, NoteOperateType.GuideEnd]);
const UNDRAWN = new Set([...UNJUDGED, NoteOperateType.Combo]);

/** The kernel's operation for a Sekai note, so any Cassiopeia renderer and session can play it. */
function sekaiOperation(
  kind: SekaiNote["sekai"]["kind"],
  active: boolean,
  value: { trace?: boolean; direction?: string; type?: string },
): NoteOperateType {
  switch (kind) {
    case "tap":
      return NoteOperateType.Normal;
    case "flick":
      return NoteOperateType.Flick;
    case "trace":
      return NoteOperateType.Trace;
    case "slide-start":
      if (!active) return NoteOperateType.GuideBegin;
      return value.trace ? NoteOperateType.SlideBeginTrace : NoteOperateType.SlideBegin;
    case "slide-end":
      if (!active) return NoteOperateType.GuideEnd;
      if (value.direction) return NoteOperateType.SlideEndFlick;
      return value.trace ? NoteOperateType.SlideEndTrace : NoteOperateType.SlideEnd;
    case "slide-tick":
    case "attach":
      if (!active) return NoteOperateType.Hidden;
      return value.trace ? NoteOperateType.SlideConnectionTrace : NoteOperateType.SlideConnection;
    default:
      // USC "hidden" is the unseen combo tick; "ignore" only bends the path.
      return active && value.type === "hidden" ? NoteOperateType.Combo : NoteOperateType.Hidden;
  }
}
function judgementType(operation: NoteOperateType, critical: boolean): NoteJudgementType {
  switch (operation) {
    case NoteOperateType.Normal:
      return critical ? NoteJudgementType.EasyNormal : NoteJudgementType.Normal;
    case NoteOperateType.SlideBegin:
      return critical ? NoteJudgementType.SlideBeginEasy : NoteJudgementType.SlideBegin;
    case NoteOperateType.SlideEnd:
      return NoteJudgementType.SlideEnd;
    case NoteOperateType.SlideEndTrace:
      return NoteJudgementType.SlideEndTrace;
    case NoteOperateType.Flick:
    case NoteOperateType.SlideEndFlick:
      return NoteJudgementType.Flick;
    case NoteOperateType.Trace:
    case NoteOperateType.SlideBeginTrace:
    case NoteOperateType.SlideConnection:
    case NoteOperateType.SlideConnectionTrace:
    case NoteOperateType.Combo:
      return NoteJudgementType.Trace;
    default:
      return NoteJudgementType.None;
  }
}
function judgementArea(operation: NoteOperateType, critical: boolean): JudgementAreaOffsetType {
  switch (operation) {
    case NoteOperateType.Normal:
      return critical ? JudgementAreaOffsetType.EasyDefault : JudgementAreaOffsetType.Default;
    case NoteOperateType.SlideBegin:
      return critical ? JudgementAreaOffsetType.EasySlideBegin : JudgementAreaOffsetType.SlideBegin;
    case NoteOperateType.SlideConnection:
    case NoteOperateType.Combo:
      return JudgementAreaOffsetType.Slide;
    case NoteOperateType.SlideEnd:
      return JudgementAreaOffsetType.SlideEnd;
    case NoteOperateType.Flick:
    case NoteOperateType.SlideEndFlick:
      return JudgementAreaOffsetType.Flick;
    case NoteOperateType.Trace:
    case NoteOperateType.SlideBeginTrace:
    case NoteOperateType.SlideEndTrace:
    case NoteOperateType.SlideConnectionTrace:
      return JudgementAreaOffsetType.Trace;
    default:
      return JudgementAreaOffsetType.Default;
  }
}

/** Strictly validate gameplay channels before the upstream parser can skip them. */
export function inspectSekaiSus(source: string): {
  issues: SekaiIssue[];
  rows: Row[];
  metadata: Record<string, string>;
} {
  const issues: SekaiIssue[] = [];
  const rows: Row[] = [];
  const metadata: Record<string, string> = {};
  const streams = new Map<string, Array<{ row: Row; position: number; type: number }>>();
  let measureOffset = 0;
  const issue = (row: Row, code: SekaiIssue["code"], message: string) =>
    issues.push({ line: row.line, raw: row.raw, code, message });
  for (const [index, raw] of source.split(/\r\n|\r|\n/u).entries()) {
    const text = raw.trim();
    if (!text.startsWith("#")) continue;
    const match = /^#([a-z0-9]+)(?::\s*(.*)|\s+(.*))?$/iu.exec(text);
    if (!match) {
      issues.push({ line: index + 1, raw, code: "invalid", message: "Malformed SUS directive" });
      continue;
    }
    const header = match[1]!.toUpperCase();
    const data = (match[2] ?? match[3] ?? "").trim();
    const row = { header, data, line: index + 1, raw, measureOffset };
    rows.push(row);
    if (match[2] === undefined) {
      metadata[header] = unquote(data);
      if (header === "MEASUREBS") {
        measureOffset = numeric(data);
        if (!Number.isSafeInteger(measureOffset) || measureOffset < 0)
          issue(row, "invalid", "MEASUREBS must be a nonnegative integer");
      }
      if (header === "WAVEOFFSET" && !Number.isFinite(numeric(data)))
        issue(row, "invalid", "WAVEOFFSET must be finite");
      if (
        header === "REQUEST" &&
        (!/^"ticks_per_beat [1-9]\d*"$/u.test(data) || !Number.isSafeInteger(Number(unquote(data).slice(15))))
      )
        issue(row, "unsupported", `Unsupported REQUEST: ${data}`);
      if (header === "NOSPEED") issue(row, "unsupported", "NOSPEED control requires a separate scroll policy");
      continue;
    }
    if (/^BPM[0-9A-Z]{2}$/u.test(header) || /^\d{3}02$/u.test(header)) {
      if (!positive(data)) issue(row, "invalid", "BPM and measure length must be positive and finite");
      continue;
    }
    if (/^TIL[0-9A-Z]{2}$/u.test(header)) {
      if (!/^".*"$/u.test(data)) issue(row, "invalid", "TIL must be quoted");
      for (const item of unquote(data)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)) {
        const itemMatch = /^(\d+)'(\d+):(.+)$/u.exec(item);
        if (!itemMatch || !positive(itemMatch[3]!)) issue(row, "unsupported", `Unsupported scroll change: ${item}`);
      }
      continue;
    }
    // Empty ancillary controls are retained as metadata in the source text.
    if (header === "VOLUME" && unquote(data) === "") continue;
    const channel = /^(\d{3})(08|1[0-9A-Z]|5[0-9A-Z]|[39][0-9A-Z]{2})$/u.exec(header);
    if (!channel) {
      issue(row, "unsupported", `Unsupported SUS channel: ${header}`);
      continue;
    }
    if (Number(channel[1]) + row.measureOffset < 0 || data.length % 2 || !/^[0-9A-Z]*$/iu.test(data)) {
      issue(row, "invalid", "Channel data must contain base36 pairs");
      continue;
    }
    for (let i = 0; i < data.length; i += 2) {
      const pair = data.slice(i, i + 2).toUpperCase();
      if (pair === "00" || channel[2] === "08") continue;
      const type = parseInt(pair[0]!, 36);
      const lane = parseInt(header[4]!, 36);
      const width = parseInt(pair[1]!, 36);
      const family = header[3];
      const supported = family === "1" ? [1, 2, 3, 5, 6, 7, 8] : family === "5" ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 5];
      // Skill/fever channels lie outside the 12 playable lanes. Preserve their raw events.
      if (family === "1" && (lane <= 1 || lane >= 14) && [1, 2, 4].includes(type)) continue;
      if (!supported.includes(type)) issue(row, "unsupported", `Unsupported note type ${type} in ${header}`);
      if (lane < 2 || lane >= 14 || width <= 0 || lane + width > 14)
        issue(row, "invalid", `Note outside the 12 playable lanes: ${header}:${pair}`);
      if (family === "3" || family === "9") {
        const key = `${family}-${header[5]}`;
        const stream = streams.get(key) ?? [];
        stream.push({ row, position: Number(header.slice(0, 3)) + row.measureOffset + i / data.length, type });
        streams.set(key, stream);
      }
    }
  }
  for (const stream of streams.values()) {
    let open: Row | undefined;
    for (const point of stream.sort((a, b) => a.position - b.position)) {
      if (point.type === 1) {
        if (open) issue(point.row, "invalid", "Slide starts before the previous slide ends");
        open = point.row;
      } else if (!open) issue(point.row, "invalid", "Slide node has no start");
      if (point.type === 2) open = undefined;
    }
    if (open) issue(open, "invalid", "Slide has no end");
  }
  if (!metadata.REQUEST) issues.push({ line: 0, raw: "", code: "invalid", message: "Missing ticks_per_beat REQUEST" });
  const bpmIds = new Set(rows.filter((row) => /^BPM../u.test(row.header)).map((row) => row.header.slice(3)));
  for (const row of rows.filter((row) => /^\d{3}08$/u.test(row.header))) {
    for (let i = 0; i < row.data.length; i += 2) {
      const id = row.data.slice(i, i + 2).toUpperCase();
      if (id !== "00" && !bpmIds.has(id)) issue(row, "invalid", `Undefined BPM reference ${id}`);
    }
  }
  return { issues, rows, metadata };
}

/** Pure in-memory conversion. All ChartNotes are render-only (judged=false). */
export function convertSekaiSus(sourceSus: string, options: SekaiConvertOptions = {}): SekaiDocument {
  if (sourceSus.length > 8 * 1024 * 1024) throw new RangeError("SUS exceeds 8 Mi characters");
  const inspected = inspectSekaiSus(sourceSus);
  if (inspected.issues.length) throw new SekaiFormatError(inspected.issues);
  const { rows, metadata } = inspected;
  const speedIds = rows.filter((row) => /^TIL../u.test(row.header));
  const selectedSpeed = metadata.HISPEED?.toUpperCase() ?? speedIds[0]?.header.slice(3);
  if (selectedSpeed && !speedIds.some((row) => row.header.slice(3) === selectedSpeed))
    throw new SekaiFormatError([{ line: 0, raw: "", code: "invalid", message: `Undefined HISPEED ${selectedSpeed}` }]);
  // The upstream analyzer reads every TIL; select the active table before conversion.
  const normalized = rows
    .filter((row) => !/^TIL../u.test(row.header) || row.header.slice(3) === selectedSpeed)
    .map(
      (row) =>
        `#${row.header}${/^\d|^(BPM|TIL|VOLUME)/u.test(row.header) ? ": " : " "}${/^\d{3}(08|[1359])/u.test(row.header) ? row.data.toUpperCase() : row.data}`,
    )
    .join("\n");
  const usc = susToUSC(normalized);
  const bpmObjects = usc.objects.filter((object) => object.type === "bpm").sort((a, b) => a.beat - b.beat);
  if (!bpmObjects.length || bpmObjects[0]!.beat !== 0)
    throw new SekaiFormatError([
      { line: 0, raw: "", code: "invalid", message: "A BPM event at beat zero is required" },
    ]);
  const bpmChanges = bpmObjects.map((object) => ({
    tick: object.beat * PPQ,
    beat: object.beat,
    timeMs: 0,
    bpm: object.bpm,
  }));
  for (let i = 1; i < bpmChanges.length; i++) {
    const previous = bpmChanges[i - 1]!;
    bpmChanges[i]!.timeMs = previous.timeMs + ((bpmChanges[i]!.beat - previous.beat) * 60000) / previous.bpm;
  }
  const toTime = (beat: number) => {
    let low = 0,
      high = bpmChanges.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (bpmChanges[mid]!.beat <= beat) low = mid + 1;
      else high = mid;
    }
    const segment = bpmChanges[Math.max(0, low - 1)]!;
    return segment.timeMs + ((beat - segment.beat) * 60000) / segment.bpm;
  };
  const timeScaleChanges = usc.objects
    .filter((object) => object.type === "timeScale")
    .map((object) => ({ timeMs: toTime(object.beat), scale: object.timeScale }))
    .sort((a, b) => a.timeMs - b.timeMs);
  const visualMap = new VisualTimeMap(timeScaleChanges);
  const bars = rows
    .filter((row) => /^\d{3}02$/u.test(row.header))
    .map((row) => ({ measure: Number(row.header.slice(0, 3)) + row.measureOffset, length: Number(row.data), beat: 0 }))
    .sort((a, b) => a.measure - b.measure);
  if (!bars.length || bars[0]!.measure !== 0)
    throw new SekaiFormatError([
      { line: 0, raw: "", code: "invalid", message: "A measure length at measure zero is required" },
    ]);
  for (let i = 1; i < bars.length; i++)
    bars[i]!.beat = bars[i - 1]!.beat + (bars[i]!.measure - bars[i - 1]!.measure) * bars[i - 1]!.length;
  const notes: SekaiNote[] = [];
  const lines: SekaiLine[] = [];
  const add = (
    value: {
      beat: number;
      lane: number;
      size: number;
      critical?: boolean;
      trace?: boolean;
      direction?: "left" | "up" | "right";
      ease?: "in" | "out" | "linear";
      type?: string;
    },
    kind: SekaiNote["sekai"]["kind"],
    active: boolean,
    objectIndex: number,
    connectionIndex?: number,
  ): SekaiNote => {
    const critical = value.critical ?? false;
    const operation = sekaiOperation(kind, active, value);
    const pos = (value.lane - value.size + 6) * 2;
    const size = value.size * 4;
    const note: SekaiNote = {
      id: notes.length,
      tick: value.beat * PPQ,
      beat: value.beat,
      timeMs: toTime(value.beat),
      pos,
      size,
      laneX: value.lane / 6,
      width: value.size / 3,
      operateType: operation,
      judgementType: judgementType(operation, critical),
      judgementAreaOffsetType: judgementArea(operation, critical),
      direction:
        value.direction === "left"
          ? NoteDirection.Left
          : value.direction === "right"
            ? NoteDirection.Right
            : NoteDirection.Normal,
      critical,
      judged: !UNJUDGED.has(operation),
      visible: !UNDRAWN.has(operation),
      lineIds: [],
      slideAlong: kind === "attach" || operation === NoteOperateType.Combo,
      indexInLine: connectionIndex ?? null,
      easeL: connectionIndex === undefined ? null : LINE_EASE[value.ease ?? "linear"],
      easeR: connectionIndex === undefined ? null : LINE_EASE[value.ease ?? "linear"],
      sekai: {
        kind,
        active,
        trace: value.trace ?? false,
        ease: value.ease ?? "linear",
        objectIndex,
        ...(value.direction ? { direction: value.direction } : {}),
        ...(connectionIndex === undefined ? {} : { connectionIndex }),
      },
    };
    notes.push(note);
    return note;
  };
  for (const [objectIndex, object] of usc.objects.entries()) {
    if (object.type === "single")
      add(object, object.direction ? "flick" : object.trace ? "trace" : "tap", true, objectIndex);
    if (object.type !== "slide") continue;
    validateSlide(object, objectIndex);
    const path = object.connections.filter((connection) => "lane" in connection);
    const line: SekaiLine = {
      id: lines.length,
      kind: object.active ? "long" : "guide",
      critical: object.critical,
      noteIds: [],
      sekai: {
        active: object.active,
        kind: !object.active
          ? "guide"
          : path.every((point) => point.lane === path[0]!.lane && point.size === path[0]!.size)
            ? "hold"
            : "slide",
      },
    };
    for (const [connectionIndex, connection] of object.connections.entries()) {
      const kind =
        connection.type === "start"
          ? "slide-start"
          : connection.type === "end"
            ? "slide-end"
            : connection.type === "tick"
              ? "slide-tick"
              : connection.type === "attach"
                ? "attach"
                : "hidden";
      let position = "lane" in connection ? connection : undefined;
      if (!position) {
        const before = path.findLast((point) => point.beat <= connection.beat)!;
        const after = path.find((point) => point.beat >= connection.beat)!;
        const progress =
          after.beat === before.beat
            ? 0
            : (visualMap.toScaledTimeMs(toTime(connection.beat)) - visualMap.toScaledTimeMs(toTime(before.beat))) /
              (visualMap.toScaledTimeMs(toTime(after.beat)) - visualMap.toScaledTimeMs(toTime(before.beat)));
        const eased = sekaiEase("ease" in before ? before.ease : "linear", progress);
        position = {
          type: "ignore",
          beat: connection.beat,
          lane: before.lane + (after.lane - before.lane) * eased,
          size: before.size + (after.size - before.size) * eased,
          ease: "linear",
        };
      }
      const note = add({ ...position, ...connection }, kind, object.active, objectIndex, connectionIndex);
      note.lineIds.push(line.id);
      line.noteIds.push(note.id);
    }
    lines.push(line);
  }
  notes.sort((a, b) => a.timeMs - b.timeMs || a.id - b.id);
  const bgmOffsetMs = options.bgmOffsetMs ?? usc.offset * 1000;
  if (!Number.isFinite(bgmOffsetMs)) throw new RangeError("bgmOffsetMs must be finite");
  return {
    chart: {
      version: 1,
      bpmChanges,
      signatureChanges: bars.map((bar) => ({
        tick: bar.beat * PPQ,
        beat: bar.beat,
        timeMs: toTime(bar.beat),
        numerator: bar.length,
        denominator: 4,
      })),
      timeScaleChanges,
      notes,
      lines,
      timeline: { skills: [], fever: [], callChanges: [] },
      durationMs: notes.at(-1)?.timeMs ?? 0,
    },
    metadata,
    sourceSus,
    bgmOffsetMs,
    ...(options.audio === undefined ? {} : { audio: options.audio }),
    ...(options.sourceUrl === undefined ? {} : { sourceUrl: options.sourceUrl }),
  };
}

function validateSlide(slide: USCSlideNote, index: number): void {
  const connections = slide.connections;
  if (
    connections.length < 2 ||
    connections.at(-1)!.beat <= connections[0].beat ||
    connections.some((point, i) => i > 0 && point.beat <= connections[i - 1]!.beat)
  ) {
    throw new SekaiFormatError([
      { line: 0, raw: "", code: "invalid", message: `Incomplete or unordered slide object ${index}` },
    ]);
  }
}

/** Sekai's directional 2/5/6 modifiers select ease-in/ease-out. */
export function sekaiEase(ease: "linear" | "in" | "out", progress: number): number {
  const p = Math.max(0, Math.min(1, progress));
  return ease === "in" ? p * p : ease === "out" ? 1 - (1 - p) * (1 - p) : p;
}
