// Effects > Generate > Speech… for the desktop app: offline text-to-speech with the voices Windows already has.
// WinRT Windows.Media.SpeechSynthesis sees the OneCore voices (the ones Windows language packs install, e.g. Thai
// "Microsoft Pattara"); System.Speech (SAPI desktop voices) is the fallback. Both run in Windows PowerShell 5.1 with
// -EncodedCommand (no script file, so no execution-policy change); the text goes through a temporary UTF-8 file and the
// audio comes back as a WAV file. Nothing leaves the computer. Plain Node: tested with a mocked spawn in tests/tts.test.js.
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');

const MAX_CHARS = 20000;
/* languages offered even when no voice is installed (so the dialog can say how to get one) — [tag, English name, own name] */
const LANGS = [['th-TH', 'Thai', 'ภาษาไทย'], ['en-US', 'English (United States)', 'English'], ['en-GB', 'English (United Kingdom)', 'English'], ['ja-JP', 'Japanese', '日本語'], ['zh-CN', 'Chinese (Simplified)', '中文'], ['ko-KR', 'Korean', '한국어'], ['fr-FR', 'French', 'Français'], ['de-DE', 'German', 'Deutsch'], ['es-ES', 'Spanish', 'Español'], ['vi-VN', 'Vietnamese', 'Tiếng Việt']];
const langName = (tag) => { const l = LANGS.find((x) => x[0].toLowerCase() === String(tag).toLowerCase()); return l ? l[1] : tag; };
/* how to get a voice for a language Windows has none for (Windows 10 / 11 Settings) */
function missingVoiceHelp(tag) {
  const name = langName(tag);
  return `No ${name} voice is installed in Windows. To add one: Windows Settings > Time & language > Language & region > Add a language > ${name} > tick "Text-to-speech" (or, if ${name} is already listed: … > Language options > Speech > Download). Then choose Effects > Generate > Speech… again — AudioStage does not need a restart.`;
}

const psQuote = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const encode = (script) => Buffer.from(script, 'utf16le').toString('base64');
const WINRT_LOAD = [
  "Add-Type -AssemblyName System.Runtime.WindowsRuntime",
  "$null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]",
  "$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]",
  "$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1",
  "function Await($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(); $task.Result }",
];
/* one JSON line per voice: {engine, id, name, lang} */
function voicesScript() {
  return ["$ErrorActionPreference = 'Stop'", '$out = @()',
    'try {', ...WINRT_LOAD, "foreach ($v in [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices) { $out += [pscustomobject]@{ engine = 'winrt'; id = $v.Id; name = $v.DisplayName; lang = $v.Language } }", '} catch { }',
    'try { Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    "foreach ($v in $s.GetInstalledVoices()) { if ($v.Enabled) { $out += [pscustomobject]@{ engine = 'sapi'; id = $v.VoiceInfo.Name; name = $v.VoiceInfo.Name; lang = $v.VoiceInfo.Culture.Name } } }", '} catch { }',
    "foreach ($o in $out) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress)) }"].join('\n');
}
/* rate: speed multiplier (1 = normal). WinRT SpeakingRate takes it directly (0.5–6); SAPI Rate is −10…10, ≈ ×3 at 10 */
const sapiRate = (rate) => Math.max(-10, Math.min(10, Math.round((10 * Math.log(rate)) / Math.log(3))));
function speakScript(o) {
  const head = ["$ErrorActionPreference = 'Stop'", `$text = [IO.File]::ReadAllText(${psQuote(o.textFile)}, [Text.Encoding]::UTF8)`];
  if (o.engine === 'sapi') {
    return [...head, 'Add-Type -AssemblyName System.Speech', '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
      `$s.SelectVoice(${psQuote(o.voice)})`, `$s.Rate = ${sapiRate(o.rate)}`, `$s.SetOutputToWaveFile(${psQuote(o.outFile)})`, '$s.Speak($text)', '$s.Dispose()', "[Console]::Out.WriteLine('ok')"].join('\n');
  }
  return [...head, ...WINRT_LOAD, '$s = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer',
    `$v = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.Id -eq ${psQuote(o.voice)} } | Select-Object -First 1`,
    "if (-not $v) { throw 'voice not found' }", '$s.Voice = $v', `$s.Options.SpeakingRate = ${Math.max(0.5, Math.min(6, o.rate)).toFixed(3)}`,
    '$st = Await ($s.SynthesizeTextToStreamAsync($text)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])',
    '$n = [uint32]$st.Size; $r = New-Object Windows.Storage.Streams.DataReader($st.GetInputStreamAt(0))', '$null = Await ($r.LoadAsync($n)) ([uint32])',
    `$b = New-Object byte[] $n; $r.ReadBytes($b); [IO.File]::WriteAllBytes(${psQuote(o.outFile)}, $b)`, "[Console]::Out.WriteLine('ok')"].join('\n');
}

class Tts {
  /* o.spawn (tests), o.platform, o.tmp (temporary folder), o.mock: a fake engine for the app tests */
  constructor(o) { this.o = o || {}; this.spawn = this.o.spawn || spawn; this.platform = this.o.platform || process.platform; this.tmp = this.o.tmp || os.tmpdir(); }
  get available() { return this.platform === 'win32' || !!this.o.mock; }
  run(script, timeoutMs) {
    return new Promise((resolve, reject) => {
      // errors come back as one 'ERR:' line on stdout (with -EncodedCommand PowerShell writes stderr as CLIXML)
      const wrapped = `try {
${script}
} catch { [Console]::Out.WriteLine('ERR:' + $_.Exception.Message); exit 1 }`;
      let p; try { p = this.spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encode(wrapped)], { windowsHide: true }); } catch (e) { reject(new Error('Windows PowerShell could not be started: ' + e.message)); return; }
      let out = '', err = '', done = false; const t = setTimeout(() => { if (!done) { done = true; try { p.kill(); } catch (e) { /* */ } reject(new Error('Speech synthesis took too long and was stopped.')); } }, timeoutMs || 120000);
      p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => { err += d; if (err.length > 20000) err = err.slice(-10000); });
      p.on('error', (e) => { if (done) return; done = true; clearTimeout(t); reject(new Error('Windows PowerShell could not be started: ' + e.message)); });
      p.on('close', (code) => { if (done) return; done = true; clearTimeout(t); const m = /^ERR:(.*)$/m.exec(out); if (code === 0 && !m) resolve(out); else reject(new Error(cleanErr(m ? m[1] : err) || 'PowerShell exited with code ' + code)); });
    });
  }
  /* installed voices, WinRT ones first; a SAPI voice is listed only when WinRT has none of that name */
  async voices() {
    if (!this.available) return [];
    if (this.o.mock) return this.o.mock.voices.slice();
    const list = String(await this.run(voicesScript(), 30000)).split(/\r?\n/).map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter((v) => v && v.id && v.lang);
    const winrt = list.filter((v) => v.engine === 'winrt'), names = new Set(winrt.map((v) => v.name.replace(/\s+Desktop$/, '').toLowerCase()));
    return [...winrt, ...list.filter((v) => v.engine === 'sapi' && !names.has(v.name.replace(/\s+Desktop$/, '').toLowerCase()))];
  }
  /* → Buffer with a WAV file. o = { text, voice (id), engine ('winrt' | 'sapi'), rate (×, 1 = normal) } */
  async speak(o) {
    if (!this.available) throw new Error('Text to speech uses the voices of Windows; it is not available on this system.');
    const text = String((o && o.text) || '').trim(); if (!text) throw new Error('Type the text to speak first.');
    if (text.length > MAX_CHARS) throw new Error(`The text is too long (${text.length} characters; at most ${MAX_CHARS} at a time).`);
    const rate = Math.max(0.3, Math.min(6, +o.rate || 1)), engine = o.engine === 'sapi' ? 'sapi' : 'winrt';
    if (this.o.mock) return this.o.mock.speak({ text, voice: o.voice, engine, rate });
    const base = path.join(this.tmp, 'audiostage-tts-' + process.pid + '-' + Date.now()), textFile = base + '.txt', outFile = base + '.wav';
    fs.writeFileSync(textFile, text, 'utf8');
    try {
      await this.run(speakScript({ textFile, outFile, voice: o.voice, engine, rate }), 300000);
      if (!fs.existsSync(outFile) || fs.statSync(outFile).size <= 44) throw new Error('The voice produced no audio.');
      return fs.readFileSync(outFile);
    } finally { for (const f of [textFile, outFile]) try { fs.unlinkSync(f); } catch (e) { /* */ } }
  }
}
/* the useful line of a PowerShell error message */
function cleanErr(s) {
  if (/voice not found|Cannot set voice|No matching voice/i.test(s)) return 'That voice is not installed (any more). Choose another voice.'; const l = String(s).split(/\r?\n/).map((x) => x.trim()).filter(Boolean); const m = l.find((x) => !/^(At line|\+|CategoryInfo|FullyQualifiedErrorId|~)/.test(x)); return (m || '').replace(/^Exception calling "\w+" with "\d+" argument\(s\): /, '').replace(/^"|"$/g, '').slice(0, 400); }

/* the app tests' engine: two voices (Thai + English) and a tone whose length follows the text and the speed */
function mockEngine() {
  return {
    voices: [{ engine: 'winrt', id: 'MOCK_thTH', name: 'Microsoft Pattara (test)', lang: 'th-TH' }, { engine: 'sapi', id: 'MOCK enUS', name: 'Microsoft Zira (test)', lang: 'en-US' }],
    speak: ({ text, rate }) => {
      const sr = 16000, n = Math.round((sr * 0.08 * [...text].length) / rate), b = Buffer.alloc(44 + n * 2);
      b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
      for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 300 * i) / sr)), 44 + i * 2);
      return b;
    },
  };
}

module.exports = { Tts, LANGS, langName, missingVoiceHelp, voicesScript, speakScript, sapiRate, encode, cleanErr, mockEngine, MAX_CHARS };
