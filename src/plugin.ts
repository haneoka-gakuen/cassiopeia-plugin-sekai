import { defineCassiopeiaPlugin, defineCassiopeiaService } from "@haneoka/cassiopeia/plugin";
import { convertSekaiSus } from "./convert.js";
import { SekaiPreviewSession } from "./session.js";

export const SEKAI_DISPLAY = defineCassiopeiaService<{
  readonly convert: typeof convertSekaiSus;
  readonly createSession: (chart: ReturnType<typeof convertSekaiSus>["chart"]) => SekaiPreviewSession;
}>("sekai.display.v1");

export function createSekaiPlugin() {
  return defineCassiopeiaPlugin({
    manifest: { id: "cassiopeia.sekai", version: "0.1.0", apiVersion: 1, provides: [SEKAI_DISPLAY.id] },
    setup(context) {
      context.provide(SEKAI_DISPLAY, { convert: convertSekaiSus, createSession: (chart) => new SekaiPreviewSession(chart) });
    },
  });
}
