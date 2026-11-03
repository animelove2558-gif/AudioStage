// npm run test:vst
// Exercises the offline plugin host against a real effect plugin.
//   set VST3_TEST_PLUGIN=C:\path\to\SomeEffect.vst3   (bundle folder or the binary inside it)
// Skipped (exit 0) when the host packages or the plugin are missing.
const assert = require('assert');
const path = require('path');
const { VstHost } = require(path.join(__dirname, '../electron/vst-host.js'));

(async () => {
  const h = new VstHost(), st = h.status();
  if (!st.available) { console.log('SKIP  plugin host not installed:', st.error); return; }
  const plug = process.env.VST3_TEST_PLUGIN;
  if (!plug) { console.log('SKIP  set VST3_TEST_PLUGIN to an effect plugin (.vst3) to run the host tests'); h.shutdown(); return; }
  let fail = 0;
  const ok = async (name, fn) => { try { await fn(); console.log('ok   ', name); } catch (e) { fail++; console.log('FAIL ', name, '-', e.message); } };
  const sr = 44100, imp = new Float32Array(sr); imp[100] = 1;

  await ok('ping reports pedalboard', async () => { const r = await h.request('ping'); assert(r.pedalboard); });
  let info;
  await ok('load effect and list parameters', async () => { info = await h.request('load', { path: plug }); assert(info.name); assert(Array.isArray(info.params)); });
  await ok('setParam returns the plugin\'s own display text', async () => { const p = info.params.find((x) => !x.boolean); if (!p) return; const r = await h.request('setParam', { key: p.key, raw: 0.5 }); assert(typeof r.param.text === 'string'); assert(Math.abs(r.param.raw - 0.5) < 0.02); });
  await ok('stereo processing keeps length and adds the requested tail', async () => { const o = await h.process([imp, imp.slice()], sr, 1.5); assert.strictEqual(o.length, 2); assert.strictEqual(o[0].length, sr + Math.round(1.5 * sr)); for (let i = 0; i < o[0].length; i += 997) assert(Number.isFinite(o[0][i])); });
  await ok('mono processing returns one channel of the same length', async () => { const o = await h.process([imp.slice(0, 20000)], sr, 0); assert.strictEqual(o.length, 1); assert.strictEqual(o[0].length, 20000); });
  await ok('rejects non-plugin files', async () => { await assert.rejects(h.request('load', { path: path.join(__dirname, 'dsp.test.js') }), /Not a plugin/); });
  await ok('plugin-host crash is reported and the host restarts', async () => {
    const big = new Float32Array(sr * 60).fill(0.1), job = h.process([big, big.slice()], sr, 0);
    await new Promise((r) => setTimeout(r, 300)); process.kill(h.child.pid);
    await assert.rejects(job, /stopped unexpectedly/);
    assert.strictEqual((await h.request('ping')).pedalboard, st.pedalboard);
  });
  h.shutdown();
  console.log(fail ? `\n${fail} FAILED` : '\nall passed'); process.exit(fail ? 1 : 0);
})();
