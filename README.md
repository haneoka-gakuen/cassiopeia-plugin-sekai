# Cassiopeia Sekai adapter

`@haneoka/cassiopeia-plugin-sekai` converts Project Sekai SUS input into a typed display document and provides a display-only session through the Cassiopeia plugin registry. It preserves source note kinds, lines, easing and critical flags. The converted chart is a complete Cassiopeia chart document: every note carries the kernel's operation and judgement type, so a kernel session can auto-play or judge it and any Cassiopeia renderer can draw it. The bundled preview is a light vector view with a caller-owned audio URL and media clock; it does no scoring of its own.

## Install and build

Use Node 20 or newer. Prepare the Cassiopeia peer package first. From this independent checkout:

```sh
npm install
npm run check
npm pack --dry-run
```

The `@haneoka/embed-core` peer supplies `sekaiDataSource` and the browser loader. The optional `@haneoka/cassiopeia-host-web` peer supplies the browser audio clock. Supply the browser clock peer as well when using the `/browser` entry or the data-source adapter. The core converter and display session require no Our Notes game adapter.

## Convert caller-owned SUS

```ts
import { convertSekaiSus, createSekaiPlugin, SEKAI_DISPLAY } from "@haneoka/cassiopeia-plugin-sekai";
import { CassiopeiaRuntime } from "@haneoka/cassiopeia/plugin";

const runtime = new CassiopeiaRuntime([createSekaiPlugin()]);
const document = convertSekaiSus(susText, { sourceUrl: "https://example.org/chart.sus" });
const session = runtime.require(SEKAI_DISPLAY).createSession(document.chart);
const snapshot = session.updateReusable(1000);
console.log(snapshot);
runtime.dispose();
```

Read the exported `SekaiDocument`, `SekaiChart`, `SekaiNote` and `SekaiIssue` types for the full contract. Unsupported or malformed source data is reported through conversion issues or `SekaiFormatError`; preserve those diagnostics in an authoring host.

## Browser preview

`@haneoka/cassiopeia-plugin-sekai/browser` exports `mountSekaiPreview`, `SekaiCanvasRenderer` and their option types. Pass an `EmbedLoaderOptions<SekaiDocument>` data source with an audio resource. The handle exposes play, pause, seek in media seconds, rate, volume, scroll duration and disposal. Chart time is media milliseconds minus `document.bgmOffsetMs`. Trigger audio playback from a user gesture. Dispose the handle when removing its container.

The included examples are a separate consumer. They use existing Material components and caller-selected files; the library does not ship chart or music binaries.

## License

Haneoka-authored code uses MPL-2.0. The vendored SUS analyzer/converter retains its MIT notice in `THIRD_PARTY_NOTICES.md`. Caller-supplied charts, audio and artwork retain their own terms.
