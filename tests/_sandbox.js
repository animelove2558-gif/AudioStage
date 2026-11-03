// Loads app/js browser scripts into a vm sandbox (they attach themselves to window.AS) so tests can use them in Node.
const fs = require('fs'), path = require('path'), vm = require('vm');

function load(files, extra) {
  const sb = { console, Math, Float32Array, Float64Array, Int16Array, Int32Array, Uint8Array, Uint32Array, DataView, ArrayBuffer, Array, Object, JSON, Number, String, Boolean, Date, Map, Set, WeakMap, Promise, Error, RegExp, Infinity, NaN, isFinite, parseFloat, parseInt, setTimeout, clearTimeout, btoa, atob, TextEncoder, TextDecoder, performance: { now: () => 0 }, ...(extra || {}) };
  sb.window = sb; sb.globalThis = sb;
  if (!sb.AudioContext) sb.AudioContext = class {};
  if (!sb.AudioBuffer) sb.AudioBuffer = class { constructor(o) { this.numberOfChannels = o.numberOfChannels; this.length = o.length; this.sampleRate = o.sampleRate; this.ch = Array.from({ length: o.numberOfChannels }, () => new Float32Array(o.length)); } copyToChannel(d, i) { this.ch[i].set(d); } getChannelData(i) { return this.ch[i]; } };
  if (!sb.localStorage) { const m = new Map(); sb.localStorage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; }
  vm.createContext(sb);
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(__dirname, '../app/js', f), 'utf8'), sb, { filename: f });
  return sb;
}
/* the usual stack for multitrack / rack tests */
const CORE = ['dsp.js', 'effects.js', 'rack.js', 'rack2.js', 'fxmenu.js', 'engine.js', 'tempo.js', 'recording.js', 'clipstretch.js', 'routing.js', 'envelope.js', 'wavescale.js', 'multitrack.js', 'sessionio.js', 'wav.js', 'store.js', 'autosave.js'];

let fail = 0;
const ok = (name, fn) => { try { fn(); console.log('ok   ', name); } catch (e) { fail++; console.log('FAIL ', name, e.message); } };
/* async variant; call `await done()` at the end */
const pending = [];
const okAsync = (name, fn) => pending.push(async () => { try { await fn(); console.log('ok   ', name); } catch (e) { fail++; console.log('FAIL ', name, e.message); } });
async function done() { for (const p of pending) await p(); console.log(fail ? `\n${fail} failed` : '\nall passed'); process.exit(fail ? 1 : 0); }

module.exports = { load, CORE, ok, okAsync, done };
