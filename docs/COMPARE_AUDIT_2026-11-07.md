# AudioStage compared with soundcraft: crash / bug audit and gap analysis (2026-11-07)

Audit only: no application code was changed. Version audited: AudioStage 2.1.0 (git HEAD `3f0081f`).
Reference: `soundcraft` (Rust DAW), read-only, used only to compare behaviour and features. Nothing from it was built, run or copied.

## Method and limits

- Finished work was read first and is NOT repeated: `PROMPT_FIX_AUDIT_2026-11-02.md` (A1-A6, B1-B3, G1-G10, H1-H4 done: atomic saves, ZIP `.asession`, chunked IO, undo budget, recording spool, autosave in pieces, navigation guards), `ROADMAP-MISSING.md` (sections 1-12 done), `ROADMAP-AUDITION-PLUS.md` (phases 0-2 done; open `[ ]` items are listed under "Already tracked" at the end).
- No crash dumps and no tester logs exist on this machine. Every crash cause below is inferred from reading code, not from a reproduction. CONFIRMED = the code path is proven by reading it (file:line given); it does not mean a crash was observed. SUSPECTED = plausible mechanism, but a threshold, environment or Chromium behaviour was not verified.
- Nothing was reproduced in a running app, except the one failing app test in C-10.
- Reference checklist used (soundcraft README "Logs" and "Robustness", docs/gaps.md): panic report and per-launch log rotation that keeps the log of the crashed run; broken audio devices are logged; plugins refusing state are logged; a plugin producing NaN/Inf is disabled; plugins are loaded off the audio thread; property tests with mutated session files and hostile parameters; Session Audio Health report; "errors are values, never a crash on bad input".

### Unit test result (run once, 2026-11-07)

`npm test` -> **31 test files, 479 passed, 1 failed**. Failing file: `tests/app.test.js`, scenario `00-boot`: "multitrack playback stops by itself at the end of the session (timer, works without animation frames)" -> `Error: still playing after the end`. All 30 plain-Node test files passed. See C-10. Note: `npm test` starts Electron (app.test.js) and was started without taking `.electron-lock` (the lock rule was applied only after the run had started; no other Electron process was found afterwards). About 4 GB RAM was free at the start.

Tiers: T1 = simple/mechanical, T2 = hard (crash root causes, concurrency, DSP/real-time), T3 = subsystem redesign. Sizes: S < 1 h, M = a few hours, L = a day or more.

---

## Part 1. Crashes and bugs (ordered by user impact, crashes first)

### C-01 Renderer crash leaves a dead window, no recovery prompt
- Status: CONFIRMED. Evidence: `main.js:381` (`render-process-gone` only logs and aborts writers); no `unresponsive`, `did-fail-load` or reload logic anywhere in `main.js`.
- Trigger: renderer out-of-memory (long file, big undo, big offline render) or a GPU/renderer crash.
- Impact: the window goes blank with no explanation and no way back. The autosave crash flag (`app/js/autosave.js`) only helps after a manual restart.
- Fix: on `render-process-gone` (reason not `clean-exit`) show one dialog (Reload / Quit), log reason + exit code, then `win.reload()` so the existing "recover interrupted session" flow runs. Also handle `unresponsive`/`responsive`, and make the GPU `child-process-gone` log (`main.js:19`) visible.
- Size: S. Tier: T1.

### C-02 Plugin-host stdin write error is unhandled (EPIPE)
- Status: CONFIRMED by reading. Evidence: `electron/vst-host.js:94` (`this.child.stdin.write(...)`); no `child.stdin.on('error')` in the file.
- Trigger: a plugin kills the Python helper (common) and a request is written before the `exit` event is processed.
- Impact: Node emits `error` on the stdin stream with no listener -> `uncaughtException` -> modal error box (`main.js:17`) and an inconsistent host manager.
- Fix: attach `child.stdin.on('error', e => dead(...))` in `ensureChild`, check `stdin.writable` before writing, reject the request on failure.
- Size: S. Tier: T1.

### C-03 Every uncaught exception opens a modal dialog, with no throttle
- Status: CONFIRMED. Evidence: `main.js:17`.
- Trigger: any repeated main-process exception (a failing timer, stream errors like C-02).
- Impact: `dialog.showErrorBox` blocks the main thread; repeats stack dialogs, the app looks hung, and execution continues in an unknown state.
- Fix: at most one dialog per N seconds, log the rest with a repeat counter (the reference logger keeps the first record and counts the rest); offer "Restart" after repeated errors.
- Size: S. Tier: T1.

### C-04 Render loop repeats an exception 60 times a second; no global error handlers in the renderer
- Status: CONFIRMED. Evidence: `app/js/app.js:2167-2168` (`tick()` schedules the next frame first, then runs code that can throw); no `window.onerror` / `unhandledrejection` anywhere in `app/js` (grep); `main.js:380` writes every console error to disk.
- Trigger: any exception inside `tick` (a corrupt session with `clip.src` undefined, see C-11; a closed AudioContext, see C-08).
- Impact: the log reaches its 2 MB rotation in seconds and the original error is overwritten (C-18); CPU stays high; the user gets no message.
- Fix: wrap the `tick` body in try/catch with a "first error + count" report and one toast; add `error` and `unhandledrejection` listeners that send one line to `log:write` and show one toast; de-duplicate identical messages in the main-process console hook.
- Size: S. Tier: T1.

### C-05 Whole-file reads in the main process (2 to 3 copies of up to 1.5 GB)
- Status: CONFIRMED path. Evidence: `main.js:124` (`media:read`), `main.js:143` (`recent:read`), `main.js:340` (`open:read`), `main.js:347` (`extedit:read`, no size cap at all): `new Uint8Array(fs.readFileSync(p))`.
- Trigger: opening a large media file through Media Browser, a recent entry, double-click, or EditorStage "Edit in AudioStage".
- Impact: `readFileSync` (N bytes) + `new Uint8Array(buffer)` (typed-array-from-typed-array makes a second full copy) + the IPC structured clone (third copy) = about 3x the file in the main process; a 1.5 GB file means about 4.5 GB, which can kill the main process (the whole app). The chunked `files:read` path (`main.js:271`) already exists and is the safe one.
- Fix: make the renderer use `files:read` / `AS.disk.source` for all four entry points, then delete or size-limit (for example 64 MB) the four whole-file handlers.
- Size: S. Tier: T1.

### C-06 Opening a large compressed file multiplies memory in the renderer
- Status: CONFIRMED path, threshold SUSPECTED. Evidence: `app/js/app.js:73-83` (`decodeFile`): the whole file as an ArrayBuffer, a `buf.slice(0)` copy for `decodeAudioData`, then `ab.getChannelData(i).slice()` copies every channel again; `app/js/engine.js:182-184` (`Doc.audioBuffer`) builds another full AudioBuffer copy at first play, and `engine.js:47` (`toBuffer`) copies each time.
- Trigger: opening a 1 to 3 hour MP3/FLAC/M4A (up to the 1.5 GB limit, `main.js:235`).
- Impact: peak is roughly compressed x2 + decoded x2 (+ decoded again at first play). A 1 h stereo 48 kHz file is 1.4 GB decoded, so 3 to 4 GB peaks and a renderer out-of-memory (-> C-01). The "File is too large" limit applies to the compressed size, so it does not protect against this.
- Fix: read tags before decoding and drop the `slice(0)` copy; use the AudioBuffer channels directly and release the buffer; limit by estimated decoded size with a clear message; longer term decode in segments (ffmpeg or WebCodecs `AudioDecoder`) straight into Float32Arrays.
- Size: M. Tier: T2.

### C-07 Mixdown, Freeze, Bounce and the scrub cache render the whole session in one OfflineAudioContext
- Status: CONFIRMED path, threshold SUSPECTED. Evidence: `app/js/multitrack.js:390` (`new OfflineAudioContext(nch, len, sr)`), `:395` (`.slice()` copy of every channel), `app/js/app.js:547` (`mixCache.buf = eng.toBuffer(...)`, another copy kept).
- Trigger: Export Mixdown / Freeze Track / Bounce / scrub-shuttle on a long session (2 h stereo 48 kHz = 5.5 GB for the context alone).
- Impact: `RangeError`/`NotSupportedError` from the context, or renderer out-of-memory (C-01). Saving long sessions was fixed in G4; rendering them was not.
- Fix: render in time slices (for example 5 minutes) with a warm-up pre-roll for effect state and a tail overlap, streaming each slice into the WAV/FLAC sink; for the scrub cache render only a window around the playhead.
- Size: L. Tier: T2 (effect state continuity across slices is the hard part).

### C-08 No handling of AudioContext failure, device change or a closed/interrupted context
- Status: CONFIRMED absence (grep: no `onstatechange`, `devicechange`, `ctx.onerror` in `app/js`), impact SUSPECTED. Evidence: `app/js/engine.js:10-27` (`init` has no try/catch and returns early forever once `this.ctx` exists, even if it later becomes `closed`); `engine.js:16` swallows `setSinkId` errors (`.catch(() => {})`); `app/js/app.js:1929`.
- Trigger: no or blocked audio device at start; the chosen output device is unplugged or an interface changes sample rate; OS sleep/wake; Bluetooth profile switch.
- Impact: `new AudioContext` throws and everything audio-related fails (even opening MP3, C-09); after a device loss the context can stay `suspended`/`closed`, playback is silent while the UI says "playing" (see C-10). The reference logs devices that failed or broke and recovers.
- Fix: wrap context creation; listen to `statechange` and `navigator.mediaDevices.ondevicechange`; recreate the context (keeping `outId`) when `closed`; show a clear toast and retry on `resume`; log it.
- Size: M. Tier: T2.

### C-09 Opening MP3/FLAC/M4A requires a live AudioContext and silently resamples to the device rate
- Status: CONFIRMED. Evidence: `app/js/app.js:77-79` (`eng.init()` then `eng.ctx.decodeAudioData`); also `app/js/fxmodal.js:230`, `app/js/panels-ui.js:170`. Per the Web Audio spec `decodeAudioData` resamples to the context's rate.
- Trigger: any non-WAV file on a machine with no usable output device, or a 44.1 kHz file on a 48 kHz device.
- Impact: the open fails with a confusing message, or the document is created at the device rate (`res.sr = ab.sampleRate`), so saving writes a different sample rate and slightly altered audio compared with the original.
- Fix: decode with an `OfflineAudioContext` at the file's own rate (read the rate from the header) or use ffmpeg/WebCodecs; never depend on the live context for decoding.
- Size: M. Tier: T2.

### C-10 Failing app test: multitrack playback does not stop at the end of the session
- Status: SUSPECTED (one failure in one run, under load from other agents, hidden window; not re-run). Evidence: test output in "Unit test result"; `app/js/app.js:213` (end-of-session timer depends on `eng.pos()`); `app/js/engine.js` `clock()` falls back to `ctx.currentTime`, which does not advance while the context is suspended or has no device.
- Trigger: context suspended / no output device / heavy load.
- Impact: if real, playback "plays" forever with no sound, the transport state is wrong and punch timing breaks. It may also just be a slow test machine (1.2 s wait for a 0.5 s clip).
- Fix: first re-run `00-boot` alone with the Electron lock held to see if it is flaky; if it fails again, make the end-of-session timer also use `performance.now()` against the start time and handle `ctx.state !== 'running'` (see C-08).
- Size: S. Tier: T2.

### C-11 Session loading does no validation of its content
- Status: CONFIRMED (no validation exists). Evidence: `app/js/sessionio.js:59` (`get(r)` returns `undefined` for a bad source index) and the next line (clips keep `src: undefined`); `migrate` only fills defaults; numeric fields (`t`, `dur`, `off`, gains) are never checked for NaN/negative values; `decCh` throws `RangeError` when the byte length is not a multiple of 4; `Math.max(0, ...spread)` fails on a huge clip count.
- Trigger: a damaged or hand-edited `.asession`, a file with an unexpected field, or a corrupt `autosave.json` / `versions/*.json`.
- Impact: the session "opens" and then every frame throws (C-04) or a render fails midway; the user cannot close it cleanly. The reference states a malformed file never crashes and fuzzes mutated session files.
- Fix: after `migrate`, sanitise: drop clips whose source is missing (and tell the user how many), coerce numbers with `Number.isFinite` defaults, clamp ranges, cap array sizes; add a mutation test (flip/truncate bytes of a valid session and assert no uncaught exception).
- Size: M. Tier: T1.

### C-12 Synchronous child-process calls on the main thread (UI freeze, "not responding")
- Status: CONFIRMED path, durations SUSPECTED. Evidence: `electron/vst-host.js:46` (`spawnSync` with a 30 s timeout, up to 3 candidates: env/runtime/venv, then `py -3`, `python`; the Windows Store `python.exe` stub can hang or open the Store); `:42-52` (a failed detection is not cached, so each `vst:status` / `vst:call` repeats it); `electron/video.js:11` (3 candidates x 8 s) and `:20` (`probe`, 20 s), both called inside IPC handlers (`main.js:168-171`); `vst-host.js:110` (`scan` walks folders synchronously to depth 3, including user-added folders).
- Trigger: opening the VST panel or Preferences without Python installed; adding a very large folder as a plugin folder; opening a video.
- Impact: the whole app freezes for seconds up to a minute; Windows shows "not responding"; testers report a crash.
- Fix: cache the negative result for a while, use async `spawn` with timeouts, make `scan` async and bounded (skip huge trees, limit entries).
- Size: M. Tier: T1.

### C-13 Media Browser root list probes every drive letter synchronously
- Status: CONFIRMED path, hang SUSPECTED. Evidence: `main.js:100` (`fs.existsSync(l + ':\\')` for C..Z); `main.js:108-120` (`media:list` runs `statSync` per file).
- Trigger: a disconnected network drive, an empty card reader or a sleeping USB disk.
- Impact: the main thread blocks per unavailable drive, so the panel and the window freeze; a folder with thousands of files makes `media:list` slow too.
- Fix: async `fs.promises.access` with a short timeout per drive, in parallel; use `Dirent` info and lazy `stat`, or cap the listing.
- Size: S. Tier: T1.

### C-14 A hung or slow plugin request is not recovered
- Status: SUSPECTED. Evidence: `electron/vst-host.js:92-94` (the timeout only rejects the promise; the helper keeps running the old job and later requests queue behind it); `main.js:90` and `vst-host.js:122-125` (`process` timeout 15 min); only `verifyPlugins` kills the host after a timeout (`vst-host.js` slow branch).
- Trigger: a plugin that blocks (license dialog, endless loop, big job).
- Impact: every later plugin action times out for minutes ("did not answer in time"), the rack looks dead until restart; raw temp files remain.
- Fix: on timeout kill the helper and let `ensureChild` start a new one; serialise requests per helper; expose Cancel for `process`; add a heartbeat from the Python side.
- Size: M. Tier: T2.

### C-15 Offline VST processing copies the whole clip several times and blocks the main thread
- Status: CONFIRMED path, thresholds SUSPECTED. Evidence: `electron/vst-host.js:120-125` (`Buffer.alloc(ch*n*4)`, synchronous `writeFileSync` of the whole clip, `readFileSync` of the output, per-channel copies); `main.js:90-93` (the Float32Array[] arrives and returns by IPC: one copy each way).
- Trigger: applying a plugin to a long file (1 h stereo 48 kHz = 1.4 GB per copy, 4+ copies live).
- Impact: UI freeze during the sync write; several GB peak in the main process (the whole app can die).
- Fix: have the renderer write the input to a temp file in pieces through the existing atomic writer and read results back in pieces; use `fs.promises`; process in blocks (with tail handling) on the Python side.
- Size: M. Tier: T2.

### C-16 Recorder `stop()` can wait forever; worklet failures are not handled
- Status: CONFIRMED path. Evidence: `app/js/engine.js:37` (the promise resolves only when the worklet posts `done`; no timeout, no `onprocessorerror`, no check that the context is running); `app/js/rack.js:60` (a failed worklet load resolves `false`, but `startRecord` awaits `this.wl` without checking it, so `new AudioWorkletNode('as-rec')` throws later).
- Trigger: the AudioContext closes or the device is lost while recording; the worklet module fails to load.
- Impact: Stop never completes; a recording (possibly hours long) cannot be saved; the UI stays busy.
- Fix: a 3 s fallback that flushes the chunks collected so far, `node.onprocessorerror`, check `await this.wl === false` and show a clear message.
- Size: S. Tier: T1.

### C-17 No NaN / Infinity protection in the effects chain
- Status: SUSPECTED. Evidence: no `isFinite`/`isNaN` guard in `app/js/worklet.js` (all `process()` methods), `rack.js`, `rack2.js` (grep).
- Trigger: extreme parameter values, a feedback filter or dynamics state that overflows, a VST returning NaN.
- Impact: one NaN poisons recursive state: permanent silence (or a full-scale burst) until the graph is rebuilt; offline renders and exports can contain NaN samples that other programs cannot play. The reference disables an insert that produces NaN/Inf and carries on (docs/gaps.md).
- Fix: a cheap check at each worklet output block and at the end of every offline render and VST result: zero the block, reset the effect state, report once.
- Size: M. Tier: T2.

### C-18 Log rotation can overwrite the evidence of the crashed run
- Status: CONFIRMED. Evidence: `electron/logs.js:8-14` (rotation only when the file is over 2 MB, one old file kept; `mkdirSync` + `statSync` + `appendFileSync` on every call).
- Trigger: error storms like C-04, or just a long session.
- Impact: Help > Report a Problem has no useful content for the run that crashed. The reference rotates per launch (keeps 3), caps size at 16 MiB and counts repeated messages.
- Fix: rotate at start (`.1`, `.2`), collapse repeats ("last message repeated N times"), keep a "clean exit" marker so the next start can say the previous run ended abnormally.
- Size: S. Tier: T1.

### C-19 A second launch still runs the whole start-up path before quitting
- Status: SUSPECTED. Evidence: `main.js:344` (`app.quit()` when the single-instance lock fails, but the rest of the module has already executed and `app.whenReady().then(...)` at `main.js:386` is still registered).
- Trigger: double-clicking the icon twice, or a file association opening a second process while the first is slow.
- Impact: a second window may flash up and touch the same files (`logs`, `folders.json`, `vst-scan.json`, `store/`); a second process lingers for a moment.
- Fix: check the lock first and `process.exit(0)` before creating `Log`, `VstHost` and handlers; guard `createWindow` with the lock result.
- Size: S. Tier: T1.

### C-20 Temporary files from hard crashes are never swept
- Status: CONFIRMED. Evidence: `electron/savefile.js` `begin()` (`<name>.<hex>.tmp` next to the target, removed only by the live process); `electron/video.js:30` (`.partial.mp4`); `electron/vst-host.js:8` and `:120` (`os.tmpdir()/audiostage-vst-<pid>-*` raw f32 files, removed only by `shutdown()`); `main.js:304` hides `*.tmp` in the store list but never deletes them.
- Trigger: power loss, task-manager kill, renderer/main crash during a save or a plugin render.
- Impact: orphan `.tmp` files beside the user's documents and gigabytes of raw audio in the temp folder.
- Fix: at start-up delete `audiostage-vst-*` folders whose pid is not running and `store/**/*.tmp`; offer cleanup of `*.tmp` next to recent sessions.
- Size: S. Tier: T1.

### C-21 Cached AudioBuffer copies are never released
- Status: CONFIRMED path. Evidence: `app/js/multitrack.js:15` (`src._ab` created once per source and kept), `app/js/engine.js:182-184` (`doc._ab`), `app/js/app.js:547` (`mixCache.buf`).
- Trigger: a session with several long sources that was played once.
- Impact: memory per source is doubled (Float32Array plus AudioBuffer) for the life of the session, even after the clip is deleted.
- Fix: an LRU with a byte budget; drop `_ab` when playback stops and when a source loses its last clip; clear `mixCache` on stop.
- Size: M. Tier: T2.

### C-22 Waveform undo budget is per file, not global
- Status: CONFIRMED path. Evidence: `app/js/engine.js:215` (`Doc.undoBudget` = min(1.5 GB, deviceMemory/4), applied inside each `Doc`).
- Trigger: several large files open, each edited a lot.
- Impact: N files can each hold 1.5 GB of undo; `deviceMemory` is capped at 8 by Chromium, so the limit does not follow real RAM.
- Fix: one shared budget across all open documents (drop the oldest step of the least recently used document first). Multitrack session snapshots were not checked in this audit.
- Size: S. Tier: T1.

### C-23 Recording stays in memory and is joined into a second copy on Stop
- Status: SUSPECTED. Evidence: `app/js/engine.js:30-35` (all chunks kept in `chunks`; `join()` allocates the final arrays while the chunks are still referenced); the disk spool (`app/js/recspool.js`) protects against a crash but does not free the in-memory chunks.
- Trigger: a multi-hour recording.
- Impact: about 1.4 GB per hour of stereo 48 kHz kept, and about 2x at Stop; an out-of-memory at the moment the user presses Stop is the worst possible time.
- Fix: when the spool is active, stop keeping chunks in memory and rebuild the recording from the spool in pieces; release chunks as `join` consumes them.
- Size: M. Tier: T2.

### C-24 File-name check accepts Windows-reserved names
- Status: CONFIRMED. Evidence: `main.js:212` (`okName` allows `CON`, `NUL`, `AUX`, trailing dot or space); `main.js:247` (`files:chooseSave` only replaces illegal characters).
- Trigger: exporting ranges or CD tracks from clip/track names such as "Aux", "Con", "Intro." or "Track ".
- Impact: Windows rejects or silently renames the file, so the stored path no longer matches the written file (save errors, wrong recent entry).
- Fix: reject or rewrite reserved device names and trailing dots/spaces. Thai/Unicode names themselves are fine (Node uses UTF-16 paths).
- Size: S. Tier: T1.

### C-25 `AudioBuffer` creation throws for unusual sample rates or channel counts
- Status: SUSPECTED. Evidence: `app/js/engine.js:47-51` (`new AudioBuffer(...)`: valid rates are about 3000-768000 Hz, at most 32 channels; the WAV reader `app/js/wav.js` accepts other values).
- Trigger: a very-low-rate WAV, or a file with more than 32 channels.
- Impact: the file opens but playback/peaks throw `NotSupportedError` every time.
- Fix: validate on open; resample to a supported rate or refuse with a message; cap channels.
- Size: S. Tier: T1.

### C-26 Export audio into video has no timeout or cancel
- Status: CONFIRMED path. Evidence: `electron/video.js:35` (`spawn(ff, ...)` with no timer; `writeFileSync` of the whole WAV at `:34`), `main.js:172-182`.
- Trigger: a corrupt or huge video, ffmpeg stuck on a network path.
- Impact: the busy overlay stays forever; the temp WAV stays in `os.tmpdir()`.
- Fix: add a timeout and an abort IPC (kill the process, delete `.partial` and the temp WAV); write the WAV through the chunked writer.
- Size: S. Tier: T1.

### C-27 Browser-mode server (`npm run web`) can be killed by one bad URL
- Status: CONFIRMED. Evidence: `server.js:6` (`decodeURIComponent` throws `URIError` on a malformed `%`, an uncaught exception ends the process), `:8` (`startsWith(root)` also accepts sibling folders whose name starts with `app`), no `error` handler on `listen` (port in use).
- Trigger: a request such as `/%`; port 5173 already used.
- Impact: the dev/web server exits (local only, 127.0.0.1).
- Fix: try/catch around the decoding, compare with `root + path.sep`, handle `server.on('error')`.
- Size: S. Tier: T1.

### C-28 The plugin editor holds the single helper for up to 6 hours
- Status: SUSPECTED. Evidence: `main.js:88` (`editor` request timeout 6 h on the same `vst` helper used by `vst:process`, `params`, `load`).
- Trigger: a plugin editor window left open while the user processes another clip.
- Impact: other plugin requests wait behind the editor and time out after 120 s; it looks like a frozen rack.
- Fix: run the editor in its own helper process, or make the editor request non-blocking on the Python side.
- Size: M. Tier: T2.

### C-29 ffmpeg download is checked against a checksum file from the same server and a moving "latest" release
- Status: SUSPECTED. Evidence: `electron/runtimes.js:14` (`.../releases/download/latest/`), `:155-156` (`pickFfmpeg` reads `checksums.sha256` from the same release; Python and pip are pinned by hash, ffmpeg is not).
- Trigger: the upstream release changes between the checksum fetch and the file fetch, or the release is tampered with.
- Impact: random failed installs ("checksum test failed"); the checksum protects against corruption only, not tampering.
- Fix: pin a dated release tag and hash for ffmpeg as is done for Python.
- Size: S. Tier: T1.

### C-30 Small settings files are written without the atomic writer
- Status: CONFIRMED. Evidence: `main.js:196` (`folders.json` via `writeFileSync`), `electron/recent.js:14` and `electron/vst-host.js:142` (temporary file + rename but no `fsync` and no cleanup of the `.tmp`).
- Trigger: power loss or a crash during the write.
- Impact: a truncated file; the read side catches parse errors, so the damage is a lost list (remembered folders, plugin scan cache, recent files).
- Fix: use `writeFileAtomic` from `electron/savefile.js` everywhere.
- Size: S. Tier: T1.

---

## Part 2. Feature gaps against soundcraft (what a user would notice)

Ignored on purpose: Rust internals, egui, the WebAssembly build, FreeBSD, MCP server details, Pro Tools parity tables. "Partly" means AudioStage has something smaller; this was judged by reading file names and greps, not by running the app.

### G-01 Real-time plugin hosting (VST3 / CLAP / AU) in the rack, with editors and delay compensation
- Status: CONFIRMED gap. AudioStage hosts VST3 offline only (Python pedalboard helper, `electron/vst-host.js`; `ROADMAP-AUDITION-PLUS.md` phase 4 still `[ ]`). soundcraft: CLAP/VST3/AU as live inserts, state saved in the session, created off the audio thread, automatic plugin delay compensation.
- Impact: no live VST inserts on tracks, no plugin parameter automation, no instruments.
- Proposed: out-of-process plugin graph (native helper with a shared-memory audio ring, per-plugin crash isolation), PDC in the mixer, state stored in `.asession`. A subsystem redesign.
- Size: L. Tier: T3.

### G-02 MIDI and instrument tracks
- Status: gap. soundcraft: instrument/MIDI tracks, piano roll with velocity lane, step input, quantize, SMF import/export, built-in synth, drum synth and sampler. AudioStage has no MIDI model.
- Proposed: a small MIDI clip type, Web MIDI input, piano-roll editor, SMF import/export, one built-in synth and a sampler as AudioWorklets. Skip if the product stays audio-only.
- Size: L. Tier: T2.

### G-03 Automation recording (Write / Touch / Latch / Trim) and automation of every effect parameter
- Status: partly (drawn volume/pan automation exists in `multitrack.js` / `rack.js`; no recorded passes found). soundcraft: modes recorded live from faders, thin/glide/coalesce, convert to clip gain, plugin parameters.
- Proposed: record fader/knob moves into breakpoints with Touch/Latch modes and point thinning; let any rack effect parameter be an automation lane.
- Size: M. Tier: T2.

### G-04 Audio device and buffer-size choice, input channel mapping
- Status: partly. AudioStage has output device (`setSinkId`) and input device choice (`app.js:1929`), but only `latencyHint: 'interactive'` (`engine.js:12`); no buffer size, channel mapping or ASIO, and no device-loss recovery (C-08). soundcraft lists this as an alpha blocker.
- Proposed: expose `latencyHint`/`sampleRate` in Preferences, per-channel input routing, a device health message. ASIO would need a native module (out of scope for plain JS).
- Size: M. Tier: T2.

### G-05 Session Audio Health report
- Status: gap. soundcraft: a window listing missing audio, sample-rate mismatches and clip source bounds, each with a fix hint, also as JSON for scripts.
- Proposed: a dialog that checks sources (length, rate vs session rate, clips outside the source, missing video file path, NaN samples) and reports counts; reuse the sanitiser from C-11.
- Size: M. Tier: T1.

### G-06 Tempo and meter maps with ramps, Bars|Beats timebase everywhere
- Status: partly (`app/js/tempo.js` is a single tempo, grid and metronome). soundcraft: tempo and meter maps, linear/parabolic/S-curve ramps, key signatures, tempo editor.
- Proposed: a tempo map in the session (list of tempo/meter changes), tempo-aware grid, ruler and snap; migrate old sessions to a one-entry map.
- Size: M. Tier: T2.

### G-07 Beat detection and beat-based warping (Beat Detective / Identify Beat)
- Status: gap (clip time-stretch exists). soundcraft: detect beats, separate at transients, conform audio to the grid, elastic warp.
- Proposed: an onset-detection job, "Separate at transients" and "Conform to grid" commands built on the existing stretch.
- Size: M. Tier: T2.

### G-08 VCA masters, routing folders, mute/solo groups, solo-in-place and implicit solo
- Status: partly (bus tracks, sends and clip groups exist; no VCA, track groups or solo modes found). soundcraft has all of these.
- Proposed: track groups (shared fader/mute/solo/arm), a VCA track type multiplying gains, solo modes in the engine graph.
- Size: M. Tier: T2.

### G-09 Edit commands and edit modes: consolidate, heal, separate on grid, repeat, shift, insert silence, Shuffle/Slip/Spot/Grid
- Status: partly (basic split/trim/ripple exist; the rest not found). soundcraft lists all of them.
- Proposed: add the missing commands one by one on the existing clip operations (each is mechanical); Spot (type a time) and Shuffle (ripple while moving) as modes.
- Size: M. Tier: T1.

### G-10 Export formats and stem bounce
- Status: partly. AudioStage exports WAV, FLAC, MP3, Opus, M4A with LUFS reporting and dither; no AIFF/CAF/RF64 export and no WAV above 4 GB found (`wav.js` writes 32-bit sizes), no one-click "bounce every track as a stem". soundcraft: WAV/BWF/RF64, AIFF/AIFC, FLAC, 16/24/32-bit float, stems.
- Proposed: AIFF writer, RF64 for large files, "Export Stems" using the existing track bounce.
- Size: M. Tier: T1.

### G-11 Surround and immersive beyond 5.1
- Status: partly (a 5.1 session mixes to 6 channels, `multitrack.js:391`). soundcraft: stereo to 9.1.6, Ambisonics, object/bed renderer, divergence/height panner.
- Proposed: only if there is demand; generalise the channel count and add a panner per layout.
- Size: L. Tier: T2.

### G-12 Video track quality: thumbnails, sync offset, codec coverage
- Status: partly (preview through `<video>` and ffmpeg mux, `app/js/videotrack.js`). soundcraft: thumbnails on the track, timecode burn-in, sync offset, own decoders.
- Proposed: a thumbnail strip on the video track, a per-video offset in ms, and a clear message for codecs Chromium cannot decode.
- Size: M. Tier: T2.

### G-13 Headless batch / command-line interface
- Status: gap. soundcraft has `soundcraft-cli` (every command with JSON parameters, headless bounce, exit codes). AudioStage has Favorites/Macros inside the app only.
- Proposed: a small Node `audiostage-cli` for batch convert / normalise / apply an effect chain over a folder, using the existing DSP files, with exit codes.
- Size: M. Tier: T1.

### G-14 Interface languages
- Status: gap (UI strings are English; Thai appears only in Linux desktop metadata). soundcraft has a localization roadmap and a parity file.
- Proposed: extract UI strings into a table, load a language file (Thai first), keep English as the fallback.
- Size: M. Tier: T2.

### G-15 macOS build
- Status: gap (only Windows NSIS and Linux AppImage/deb in `package.json` `build`). soundcraft ships signed macOS builds.
- Proposed: add a `mac` target (signing needs a Mac and an Apple account) and a macOS path check for the VST helper.
- Size: M. Tier: T1.

### G-16 Memory locations, Big Counter, more timecode formats
- Status: partly (markers and a time display exist; drop-frame timecode and Feet+Frames were not found). soundcraft: memory locations with recall, Big Counter, every timecode rate, Samples timebase.
- Proposed: numbered memory locations with recall keys, a floating large counter window, timecode at all frame rates including drop-frame.
- Size: M. Tier: T1.

---

## Already tracked (not re-reported)

Open `[ ]` items in `ROADMAP-AUDITION-PLUS.md`: Whisper transcription and text-based editing, filler-word removal, SRT/VTT export, diarization, Demucs stem separation, Enhance Speech, platform loudness presets and ACX check, non-destructive edit list / history panel, Match EQ, automixer, room-tone fill, podcast template, command palette, and real-time VST (G-01 above is the same item with the reference comparison). `PROMPT_FIX_AUDIT_2026-11-02.md` section D (features 1-10) was left for a later round. ROADMAP-LINUX items 2-6 need a Linux machine. A 2-hour session test on the real app was never run.

## Summary

| Tier | Crash/bug (C) | Gap (G) | Total |
|---|---|---|---|
| T1 | 19 | 6 | 25 |
| T2 | 11 | 9 | 20 |
| T3 | 0 | 1 | 1 |
| All | 30 | 16 | 46 |

Not verified (no running app, no Linux/macOS machine, no tester logs): real memory thresholds of C-06, C-07, C-15 and C-23; Chromium behaviour after an output device is unplugged (C-08); the Windows Store `python.exe` stub behaviour (C-12); Thai/Unicode path handling in the packaged build together with the Python helper (no defect found by reading, not run); packaged (asar/unpacked) behaviour of the VST helper beyond the path rewrite at `electron/vst-host.js:6` (read as correct); Multitrack session undo size; whether the `app.test.js` failure (C-10) is flaky.
