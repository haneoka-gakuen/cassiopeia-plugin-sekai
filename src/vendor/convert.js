// MIT © 2023 NonSpicyBurrito. Pinned source and license: THIRD_PARTY_NOTICES.md.
import { analyze } from "./analyze.js";
const susToUSC = (sus) => {
  const score = analyze(sus);
  const flickMods = /* @__PURE__ */ new Map();
  const traceMods = /* @__PURE__ */ new Set();
  const criticalMods = /* @__PURE__ */ new Set();
  const tickRemoveMods = /* @__PURE__ */ new Set();
  const slideStartEndRemoveMods = /* @__PURE__ */ new Set();
  const easeMods = /* @__PURE__ */ new Map();
  const preventSingles = /* @__PURE__ */ new Set();
  const dedupeSingles = /* @__PURE__ */ new Set();
  const dedupeSlides = /* @__PURE__ */ new Map();
  for (const slide of score.slides) {
    if (slide.type !== 3) continue;
    for (const note of slide.notes) {
      const key = getKey(note);
      switch (note.type) {
        case 1:
        case 2:
        case 3:
        case 5:
          preventSingles.add(key);
          break;
      }
    }
  }
  for (const note of score.directionalNotes) {
    const key = getKey(note);
    switch (note.type) {
      case 1:
        flickMods.set(key, "up");
        break;
      case 3:
        flickMods.set(key, "left");
        break;
      case 4:
        flickMods.set(key, "right");
        break;
      case 2:
        easeMods.set(key, "in");
        break;
      case 5:
      case 6:
        easeMods.set(key, "out");
        break;
    }
  }
  for (const note of score.tapNotes) {
    const key = getKey(note);
    switch (note.type) {
      case 2:
        criticalMods.add(key);
        break;
      case 5:
        traceMods.add(key);
        break;
      case 6:
        traceMods.add(key);
        criticalMods.add(key);
        break;
      case 3:
        tickRemoveMods.add(key);
        break;
      case 7:
        slideStartEndRemoveMods.add(key);
        break;
      case 8:
        criticalMods.add(key);
        slideStartEndRemoveMods.add(key);
        break;
    }
  }
  const objects = [];
  for (const timeScaleChange of score.timeScaleChanges) {
    objects.push({
      type: "timeScale",
      beat: timeScaleChange.tick / score.ticksPerBeat,
      timeScale: timeScaleChange.timeScale
    });
  }
  for (const bpmChange of score.bpmChanges) {
    objects.push({
      type: "bpm",
      beat: bpmChange.tick / score.ticksPerBeat,
      bpm: bpmChange.bpm
    });
  }
  for (const note of score.tapNotes) {
    if (note.lane <= 1 || note.lane >= 14) continue;
    if (note.type !== 1 && note.type !== 2 && note.type !== 5 && note.type !== 6) continue;
    const key = getKey(note);
    if (preventSingles.has(key)) continue;
    if (dedupeSingles.has(key)) continue;
    dedupeSingles.add(key);
    const object = {
      type: "single",
      beat: note.tick / score.ticksPerBeat,
      lane: note.lane - 8 + note.width / 2,
      size: note.width / 2,
      trace: note.type === 5 || note.type === 6,
      critical: note.type === 2 || note.type === 6
    };
    const flickMod = flickMods.get(key);
    if (flickMod) object.direction = flickMod;
    objects.push(object);
  }
  for (const slide of score.slides) {
    const startNote = slide.notes.find(({ type }) => type === 1 || type === 2);
    if (!startNote) continue;
    const object = {
      type: "slide",
      active: slide.type === 3,
      critical: criticalMods.has(getKey(startNote)),
      connections: []
    };
    for (const note of slide.notes) {
      const key2 = getKey(note);
      const beat = note.tick / score.ticksPerBeat;
      const lane = note.lane - 8 + note.width / 2;
      const size = note.width / 2;
      const trace = traceMods.has(key2);
      const critical = object.critical || criticalMods.has(key2);
      const ease = easeMods.get(key2) ?? "linear";
      switch (note.type) {
        case 1: {
          if (!object.active || slideStartEndRemoveMods.has(key2)) {
            const connection = {
              type: "ignore",
              beat,
              lane,
              size,
              ease
            };
            object.connections.push(connection);
          } else {
            const connection = {
              type: "start",
              beat,
              lane,
              size,
              trace,
              critical,
              ease: easeMods.get(key2) ?? "linear"
            };
            object.connections.push(connection);
          }
          break;
        }
        case 2: {
          if (!object.active || slideStartEndRemoveMods.has(key2)) {
            const connection = {
              type: "ignore",
              beat,
              lane,
              size,
              ease
            };
            object.connections.push(connection);
          } else {
            const connection = {
              type: "end",
              beat,
              lane,
              size,
              trace,
              critical
            };
            const flickMod = flickMods.get(key2);
            if (flickMod) connection.direction = flickMod;
            object.connections.push(connection);
          }
          break;
        }
        case 3: {
          if (tickRemoveMods.has(key2)) {
            const connection = {
              type: "attach",
              beat,
              critical
            };
            object.connections.push(connection);
          } else {
            const connection = {
              type: "tick",
              beat,
              lane,
              size,
              trace,
              critical,
              ease
            };
            object.connections.push(connection);
          }
          break;
        }
        case 5: {
          if (tickRemoveMods.has(key2)) break;
          const connection = {
            type: "ignore",
            beat,
            lane,
            size,
            ease
          };
          object.connections.push(connection);
          break;
        }
      }
    }
    objects.push(object);
    if (!object.active) continue;
    const key = getKey(startNote);
    const dupe = dedupeSlides.get(key);
    if (dupe) objects.splice(objects.indexOf(dupe), 1);
    dedupeSlides.set(key, object);
  }
  return {
    offset: score.offset,
    objects
  };
};
const getKey = (note) => `${note.lane}-${note.tick}`;
export {
  susToUSC
};
