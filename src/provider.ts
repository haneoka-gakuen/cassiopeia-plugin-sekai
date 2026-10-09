import type { DataContext, DataSource } from "@haneoka/embed-core";
import { convertSekaiSus } from "./convert.js";
import type { SekaiConvertOptions, SekaiDocument } from "./types.js";

/** Bounded, abortable SUS input using embed-core's fetch/progress contract. */
export function sekaiDataSource(input: { readonly sus: string | Blob | URL } & SekaiConvertOptions): DataSource<SekaiDocument> {
  return {
    ...(input.sus instanceof URL ? { assetsBase: new URL(".", input.sus).href } : {}),
    async load(context) {
      context.signal.throwIfAborted();
      let text: string;
      if (typeof input.sus === "string") {
        const bytes = new TextEncoder().encode(input.sus);
        if (bytes.byteLength > context.maxBytes) throw new RangeError("SUS exceeds maxBytes");
        context.progress({ loaded: bytes.byteLength, total: bytes.byteLength }); text = input.sus;
      } else {
        if (input.sus instanceof URL && !/^https?:$/u.test(input.sus.protocol)) throw new TypeError("SUS URL requires HTTP(S)");
        const response = input.sus instanceof URL
          ? await context.fetcher(new Request(input.sus, { signal: context.signal }))
          : new Response(input.sus);
        text = await readText(response, context);
      }
      context.signal.throwIfAborted();
      return convertSekaiSus(text, { ...input, ...(input.sus instanceof URL ? { sourceUrl: input.sus.href } : {}) });
    },
  };
}

async function readText(response: Response, context: DataContext): Promise<string> {
  if (!response.ok) { await response.body?.cancel(); throw new Error(`SUS HTTP ${response.status}: ${response.url}`); }
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const parts: string[] = [];
  let loaded = 0;
  const abort = () => { void reader.cancel(context.signal.reason).catch(() => {}); };
  context.signal.addEventListener("abort", abort, { once: true });
  try {
    context.signal.throwIfAborted();
    for (;;) {
      const item = await reader.read(); context.signal.throwIfAborted();
      if (item.done) break;
      loaded += item.value.byteLength;
      if (loaded > context.maxBytes) throw new RangeError("SUS exceeds maxBytes");
      parts.push(decoder.decode(item.value, { stream: true })); context.progress({ loaded });
    }
    parts.push(decoder.decode()); return parts.join("");
  } catch (error) { await reader.cancel(error).catch(() => {}); throw error; }
  finally { context.signal.removeEventListener("abort", abort); reader.releaseLock(); }
}
