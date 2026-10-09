// MIT © 2023 NonSpicyBurrito. Pinned source and license: THIRD_PARTY_NOTICES.md.
const analyze = (sus) => {
  const { lines, measureChanges, meta } = parse(sus);
  const offset = -+(meta.get("WAVEOFFSET") || "0");
  if (Number.isNaN(offset)) throw new Error("Unexpected offset");
  const ticksPerBeat = getTicksPerBeat(meta);
  if (!ticksPerBeat) throw new Error("Missing or unexpected ticks per beat");
  const barLengths = getBarLengths(lines, measureChanges);
  const toTick = getToTick(barLengths, ticksPerBeat);
  const bpms = /* @__PURE__ */ new Map();
  const bpmChanges = [];
  const timeScaleChanges = [];
  const tapNotes = [];
  const directionalNotes = [];
  const streams = /* @__PURE__ */ new Map();
  for (const [index, line] of lines.entries()) {
    const [header, data] = line;
    const measureOffset = measureChanges.find(([changeIndex]) => changeIndex <= index)?.[1] ?? 0;
    if (header.length === 5 && header.startsWith("TIL")) {
      timeScaleChanges.push(...toTimeScaleChanges(line, toTick));
      continue;
    }
    if (header.length === 5 && header.startsWith("BPM")) {
      bpms.set(header.substring(3), +data);
      continue;
    }
    if (header.length === 5 && header.endsWith("08")) {
      bpmChanges.push(...toBpmChanges(line, measureOffset, bpms, toTick));
      continue;
    }
    if (header.length === 5 && header[3] === "1") {
      tapNotes.push(...toNotes(line, measureOffset, toTick));
      continue;
    }
    if (header.length === 6 && (header[3] === "3" || header[3] === "9")) {
      const key = `${header[5]}-${header[3]}`;
      const stream = streams.get(key);
      if (stream) {
        stream.notes.push(...toNotes(line, measureOffset, toTick));
      } else {
        streams.set(key, {
          type: +header[3],
          notes: toNotes(line, measureOffset, toTick)
        });
      }
      continue;
    }
    if (header.length === 5 && header[3] === "5") {
      directionalNotes.push(...toNotes(line, measureOffset, toTick));
      continue;
    }
  }
  const slides = [...streams.values()].flatMap(toSlides);
  return {
    offset,
    ticksPerBeat,
    timeScaleChanges,
    bpmChanges,
    tapNotes,
    directionalNotes,
    slides
  };
};
const parse = (sus) => {
  const lines = [];
  const measureChanges = [];
  const meta = /* @__PURE__ */ new Map();
  for (const line of sus.split("\n").map((line2) => line2.trim()).filter((line2) => line2.startsWith("#"))) {
    const isLine = line.includes(":");
    const index = line.indexOf(isLine ? ":" : " ");
    if (index === -1) continue;
    const left = line.substring(1, index).trim();
    const right = line.substring(index + 1).trim();
    if (isLine) {
      lines.push([left, right]);
    } else if (left === "MEASUREBS") {
      measureChanges.unshift([lines.length, +right]);
    } else {
      meta.set(left, right);
    }
  }
  return {
    lines,
    measureChanges,
    meta
  };
};
const getTicksPerBeat = (meta) => {
  const request = meta.get("REQUEST");
  if (!request) return;
  if (!request.startsWith('"ticks_per_beat ') || !request.endsWith('"')) return;
  return +request.slice(16, -1);
};
const getBarLengths = (lines, measureChanges) => {
  const barLengths = [];
  for (const [index, line] of lines.entries()) {
    const [header, data] = line;
    if (header.length !== 5) continue;
    if (!header.endsWith("02")) continue;
    const measure = +header.substring(0, 3) + (measureChanges.find(([changeIndex]) => changeIndex <= index)?.[1] ?? 0);
    if (Number.isNaN(measure)) continue;
    barLengths.push({ measure, length: +data });
  }
  return barLengths;
};
const getToTick = (barLengths, ticksPerBeat) => {
  let ticks = 0;
  const bars = barLengths.sort((a, b) => a.measure - b.measure).map(({ measure, length }, i, values) => {
    if (i) {
      const prev = values[i - 1];
      ticks += (measure - prev.measure) * prev.length * ticksPerBeat;
    }
    return { measure, ticksPerMeasure: length * ticksPerBeat, ticks };
  }).reverse();
  return (measure, p, q) => {
    const bar = bars.find((bar2) => measure >= bar2.measure);
    if (!bar) throw new Error("Unexpected missing bar");
    return bar.ticks + (measure - bar.measure) * bar.ticksPerMeasure + p * bar.ticksPerMeasure / q;
  };
};
const toBpmChanges = (line, measureOffset, bpms, toTick) => toRaws(line, measureOffset, toTick).map(({ tick, value }) => ({
  tick,
  bpm: bpms.get(value) ?? 0
}));
const toTimeScaleChanges = ([, data], toTick) => {
  if (!data.startsWith('"') || !data.endsWith('"'))
    throw new Error("Unexpected time scale changes");
  return data.slice(1, -1).split(",").map((segment) => segment.trim()).filter((segment) => !!segment).map((segment) => {
    const [l, rest] = segment.split("'");
    const [m, r] = rest.split(":");
    const measure = +l;
    const tick = +m;
    const timeScale = +r;
    if (Number.isNaN(measure) || Number.isNaN(tick) || Number.isNaN(timeScale))
      throw new Error("Unexpected time scale change");
    return {
      tick: toTick(measure, 0, 1) + tick,
      timeScale
    };
  }).sort((a, b) => a.tick - b.tick);
};
const toNotes = (line, measureOffset, toTick) => {
  const [header] = line;
  const lane = parseInt(header[4], 36);
  return toRaws(line, measureOffset, toTick).map(({ tick, value }) => {
    const width = parseInt(value[1], 36);
    return {
      tick,
      lane,
      width,
      type: parseInt(value[0], 36)
    };
  });
};
const toSlides = (stream) => {
  const slides = [];
  let notes;
  for (const note of stream.notes.sort((a, b) => a.tick - b.tick)) {
    if (!notes) {
      notes = [];
      slides.push({
        type: stream.type,
        notes
      });
    }
    notes.push(note);
    if (note.type === 2) {
      notes = void 0;
    }
  }
  return slides;
};
const toRaws = ([header, data], measureOffset, toTick) => {
  const measure = +header.substring(0, 3) + measureOffset;
  return (data.match(/.{2}/g) ?? []).map(
    (value, i, values) => value !== "00" && {
      tick: toTick(measure, i, values.length),
      value
    }
  ).filter((object) => !!object);
};
export {
  analyze
};
