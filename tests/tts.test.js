// Run: node tests/tts.test.js — Effects > Generate > Speech…: electron/tts.js with a mocked PowerShell (spawn), the
// renderer helpers in app/js/speech.js, and — on Windows with a voice installed — one real offline synthesis.
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), { EventEmitter } = require('events');
const { load, ok, okAsync, done } = require('./_sandbox');
const T = require('../electron/tts');

/* a fake powershell.exe: decodes -EncodedCommand and lets the test answer it */
function fakeSpawn(answer) {
  const calls = [];
  const spawn = (cmd, args) => {
    const script = Buffer.from(args[args.indexOf('-EncodedCommand') + 1], 'base64').toString('utf16le'), p = new EventEmitter();
    p.stdout = new EventEmitter(); p.stderr = new EventEmitter(); p.kill = () => {};
    const call = { cmd, args, script }; calls.push(call);
    setImmediate(() => { const r = answer(call) || {}; if (r.throwSpawn) { p.emit('error', new Error(r.throwSpawn)); return; } if (r.out) p.stdout.emit('data', r.out); p.emit('close', r.code || 0); });
    return p;
  };
  return { spawn, calls };
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-tts-'));
const pathIn = (script, re) => { const m = re.exec(script); return m && m[1].replace(/''/g, "'"); };
const wav16k = (secs) => T.mockEngine().speak({ text: 'x'.repeat(Math.round(secs / 0.08)), rate: 1 });

okAsync('not on Windows: no voices, and speaking says why (no fake button)', async () => {
  const t = new T.Tts({ platform: 'linux' }); assert.strictEqual(t.available, false); assert.deepStrictEqual(await t.voices(), []);
  await assert.rejects(t.speak({ text: 'hi' }), /voices of Windows/);
});
okAsync('voices: WinRT (OneCore, e.g. Thai) + SAPI; a SAPI "… Desktop" copy of a WinRT voice is listed once', async () => {
  const f = fakeSpawn(() => ({ out: [{ engine: 'winrt', id: 'TOK_th', name: 'Microsoft Pattara', lang: 'th-TH' }, { engine: 'winrt', id: 'TOK_dav', name: 'Microsoft David', lang: 'en-US' }, { engine: 'sapi', id: 'Microsoft David Desktop', name: 'Microsoft David Desktop', lang: 'en-US' }, { engine: 'sapi', id: 'Acme Voice', name: 'Acme Voice', lang: 'de-DE' }].map((o) => JSON.stringify(o)).join('\r\n') + '\r\nnoise\r\n' }));
  const v = await new T.Tts({ platform: 'win32', spawn: f.spawn }).voices();
  assert.deepStrictEqual(v.map((x) => x.engine + ':' + x.name), ['winrt:Microsoft Pattara', 'winrt:Microsoft David', 'sapi:Acme Voice']);
  assert.strictEqual(f.calls[0].cmd, 'powershell.exe'); assert(f.calls[0].args.includes('-NonInteractive') && !f.calls[0].args.some((a) => /Bypass|ExecutionPolicy/i.test(a)), 'no execution-policy change');
  assert(/AllVoices/.test(f.calls[0].script) && /GetInstalledVoices/.test(f.calls[0].script));
});
okAsync('speak (WinRT): Thai text goes through a UTF-8 file intact, speed → SpeakingRate, WAV back, temp files removed', async () => {
  const text = 'สวัสดีครับ ทดสอบเสียงภาษาไทย 123'; let seen = '';
  const f = fakeSpawn(({ script }) => { seen = fs.readFileSync(pathIn(script, /ReadAllText\('([^']*(?:''[^']*)*)'/), 'utf8'); fs.writeFileSync(pathIn(script, /WriteAllBytes\('([^']*(?:''[^']*)*)'/), wav16k(0.5)); return { out: 'ok\r\n' }; });
  const b = await new T.Tts({ platform: 'win32', spawn: f.spawn, tmp }).speak({ text, voice: 'TOK_th', engine: 'winrt', rate: 1.5 });
  assert.strictEqual(seen, text, 'text file'); assert(!f.calls[0].script.includes('สวัสดี'), 'the text is not in the command line');
  assert(/SpeakingRate = 1\.500/.test(f.calls[0].script) && /\$_\.Id -eq 'TOK_th'/.test(f.calls[0].script));
  assert.strictEqual(b.slice(0, 4).toString(), 'RIFF'); assert.deepStrictEqual(fs.readdirSync(tmp), [], 'temp files removed');
});
okAsync('speak (SAPI): voice name quoted safely, speed → Rate −10…10', async () => {
  const f = fakeSpawn(({ script }) => { fs.writeFileSync(pathIn(script, /SetOutputToWaveFile\('([^']*(?:''[^']*)*)'/), wav16k(0.2)); return { out: 'ok' }; });
  await new T.Tts({ platform: 'win32', spawn: f.spawn, tmp }).speak({ text: 'Hello', voice: "O'Brien'); Remove-Item x; ('", engine: 'sapi', rate: 3 });
  assert(f.calls[0].script.includes("SelectVoice('O''Brien''); Remove-Item x; (''')"), 'quote doubled: ' + /SelectVoice.*/.exec(f.calls[0].script)[0]);
  assert(/\$s\.Rate = 10/.test(f.calls[0].script)); assert.strictEqual(T.sapiRate(1), 0); assert.strictEqual(T.sapiRate(0.5), -6); assert.strictEqual(T.sapiRate(9), 10);
});
okAsync('errors are readable: PowerShell exception, missing voice, PowerShell missing, empty / too long text', async () => {
  const t = (answer) => new T.Tts({ platform: 'win32', spawn: fakeSpawn(answer).spawn, tmp });
  await assert.rejects(t(() => ({ out: 'ERR:Exception calling "Speak" with "1" argument(s): "Audio device error"', code: 1 })).speak({ text: 'a', voice: 'v' }), /^Error: Audio device error$/);
  await assert.rejects(t(() => ({ out: 'ERR:voice not found', code: 1 })).speak({ text: 'a', voice: 'v' }), /not installed \(any more\)/);
  await assert.rejects(t(() => ({ throwSpawn: 'spawn powershell.exe ENOENT' })).speak({ text: 'a', voice: 'v' }), /PowerShell could not be started/);
  await assert.rejects(t(() => ({ out: 'ok' })).speak({ text: 'a', voice: 'v' }), /no audio/);
  await assert.rejects(t(() => ({})).speak({ text: '   ' }), /Type the text/); await assert.rejects(t(() => ({})).speak({ text: 'x'.repeat(T.MAX_CHARS + 1) }), /too long/);
  assert.deepStrictEqual(fs.readdirSync(tmp), [], 'temp files removed after errors');
});
ok('a language without a voice: how to add it with a Windows language pack', () => {
  const h = T.missingVoiceHelp('th-TH'); assert(/No Thai voice/.test(h) && /Time & language/.test(h) && /Add a language > Thai/.test(h) && /Text-to-speech/.test(h), h);
  assert(T.LANGS.some((l) => l[0] === 'th-TH' && l[2] === 'ภาษาไทย'));
});

/* ---- renderer: app/js/speech.js ---- */
const sb = load(['dsp.js', 'wav.js', 'speech.js']), S = sb.AS.speech, D = sb.AS.dsp;
const langs = T.LANGS.map(([tag, name, own]) => ({ tag, name, own, help: T.missingVoiceHelp(tag) }));
const voices = [{ engine: 'winrt', id: 'TOK_dav', name: 'Microsoft David', lang: 'en-US' }, { engine: 'winrt', id: 'TOK_th', name: 'Microsoft Pattara', lang: 'th-TH' }, { engine: 'sapi', id: 'Haruka', name: 'Microsoft Haruka Desktop', lang: 'ja-JP' }];
ok('browser mode (no desktop bridge): Speech… is not offered', () => { assert.strictEqual(S.available(), false); assert(load(['dsp.js', 'wav.js', 'speech.js'], { audioStageTts: {} }).AS.speech.available()); });
ok('voice list: Thai first, then by language; languages without a voice say how to add one', () => {
  const o = S.voiceOptions(voices, langs);
  assert.deepStrictEqual(Array.from(o.slice(0, 3), (x) => x[0]), ['winrt|TOK_th', 'winrt|TOK_dav', 'sapi|Haruka']); assert(/^Thai \(ภาษาไทย\) — Microsoft Pattara$/.test(o[0][1]), o[0][1]);
  const miss = o.filter((x) => x[0].startsWith(S.MISSING)).map((x) => x[0].slice(S.MISSING.length)); assert(miss.includes('ko-KR') && !miss.includes('th-TH') && !miss.includes('en-US'));
  const noThai = S.voiceOptions(voices.filter((v) => v.lang !== 'th-TH'), langs); assert(noThai.some((x) => x[0] === 'missing:th-TH' && /no voice installed/.test(x[1])));
  assert.deepStrictEqual({ ...S.parseVoice('missing:th-TH') }, { missing: 'th-TH' }); assert.deepStrictEqual(JSON.parse(JSON.stringify(S.parseVoice('winrt|HKEY\\X|Y'))), { engine: 'winrt', id: 'HKEY\\X|Y' });
});
ok('default voice: the last one used, else Thai for Thai text, else the first', () => {
  assert.strictEqual(S.defaultVoice(voices, 'sapi|Haruka', 'hello'), 'sapi|Haruka'); assert.strictEqual(S.defaultVoice(voices, 'gone|x', 'สวัสดี'), 'winrt|TOK_th');
  assert.strictEqual(S.defaultVoice(voices.filter((v) => v.lang !== 'th-TH'), '', 'สวัสดี'), 'winrt|TOK_dav');
});
ok('render: 16 kHz mono voice → the file’s rate and channels; pitch keeps the duration; no clicks at the ends', () => {
  const w = wav16k(1), n16 = (w.length - 44) / 2, out = S.render(new Uint8Array(w), 44100, 2, 0);
  assert.strictEqual(out.length, 2); assert(Math.abs(out[0].length - (n16 * 44100) / 16000) < 5, 'length ' + out[0].length); assert.strictEqual(out[0][0], 0); assert(Math.abs(out[1][out[1].length - 1]) < 1e-6);
  const up = S.render(new Uint8Array(w), 44100, 1, 4); assert.strictEqual(up.length, 1); assert(Math.abs(up[0].length - out[0].length) < 50, 'pitch shift keeps the length');
  const zc = (x) => { let c = 0; for (let i = 5000; i < 35000; i++) if (x[i - 1] < 0 && x[i] >= 0) c++; return c / (30000 / 44100); };
  assert(Math.abs(zc(out[0]) - 300) < 5 && Math.abs(zc(up[0]) - 300 * Math.pow(2, 4 / 12)) < 8, `${zc(out[0]).toFixed(0)} Hz → ${zc(up[0]).toFixed(0)} Hz`);
  assert.throws(() => S.render(new Uint8Array(10), 44100, 1, 0), /no audio/);
});

/* ---- the real thing (Windows with at least one voice): offline, nothing leaves the computer ---- */
okAsync('real Windows voice: speaks a Thai (or the first available) phrase to a WAV', async () => {
  if (process.platform !== 'win32') { console.log('skip  (not Windows)'); return; }
  const t = new T.Tts({ tmp }); let v;
  try { v = await t.voices(); } catch (e) { console.log('skip  (PowerShell unavailable: ' + e.message + ')'); return; }
  if (!v.length) { console.log('skip  (no voice installed)'); return; }
  const th = v.find((x) => /^th/i.test(x.lang)), voice = th || v[0], b = await t.speak({ text: th ? 'ทดสอบเสียงภาษาไทย' : 'Speech test', voice: voice.id, engine: voice.engine, rate: 1 });
  const ch = S.render(new Uint8Array(b), 44100, 1, 0); assert(ch[0].length > 44100 * 0.4 && D.peakOf(ch) > 0.01, `${voice.name}: ${(ch[0].length / 44100).toFixed(2)} s, peak ${D.peakOf(ch).toFixed(3)}`);
  console.log('      (' + voice.name + ', ' + voice.lang + ')');
});
done().finally(() => fs.rmSync(tmp, { recursive: true, force: true }));
