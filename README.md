# AudioStage

เครื่องมือตัดต่อเสียงและมิกซ์มัลติแทร็กสไตล์ DAW (Waveform editor + Multitrack) เขียนด้วย HTML/Canvas/Web Audio และห่อด้วย Electron

## รัน

```
npm install
npm start          # แอปเดสก์ท็อป (Electron)
npm run web        # หรือเปิดในเบราว์เซอร์ที่ http://localhost:5173
npm test           # รันทุกไฟล์ใน tests/ (รวมเทสต์ในแอปจริง — บรรทัดสุดท้ายพิมพ์ยอดรวมจริง)
```

## ฟีเจอร์ที่มีแล้ว

**Waveform Editor** — เปิด WAV (8/16/24/32/float, คง sample rate เดิม) และ MP3/OGG/FLAC/M4A ผ่านตัวถอดรหัสของระบบ · ซูม/เลื่อน/เลือกช่วง/ลากขอบ selection · มุมมอง Spectral (log-frequency) · Markers · Undo/Redo 40 ขั้น (เก็บเฉพาะช่วงที่แก้ และจำกัดหน่วยความจำ undo ไม่เกิน ¼ ของ RAM / 1.5 GB — ขั้นเก่าสุดถูกตัดก่อนพร้อมแจ้งครั้งเดียว) · Cut/Copy/Paste/Mix Paste/Copy-to-New/Paste-to-New/Crop/Delete/Trim Silence · Convert Sample Rate / Mono⇄Stereo · Loop playback · Record จากไมค์ (lossless PCM)

**Effects (พรีวิวสดก่อน Apply)** — Amplify, Normalize, Loudness Normalize (LUFS, ITU-R BS.1770), Fade, Gain Ramp, Compressor, Hard Limiter (look-ahead), Noise Gate, DC offset, Invert, Reverse · Parametric EQ, Graphic EQ 10 แบนด์, HP/LP/BP/Notch · Time Stretch (WSOLA), Pitch Shifter, Varispeed · Echo, Chorus, Flanger, Vibrato, Phaser, Tremolo, Reverb · Distortion, Bit Crusher · Stereo Width, Balance, Swap, Vocal Remover · **Restoration:** Noise Reduction (capture noise print), Click/Pop Eliminator, DeHummer, DeEsser

**Generate** — Silence, Tone (sweep ได้), Noise (white/pink/brown), DTMF

**Analyze** — Frequency Analysis, Amplitude Statistics (peak/RMS/DC/clipping/LUFS)

**Multitrack** — หลายแทร็ก, วางไฟล์ตรง playhead, ลากย้ายคลิปข้ามแทร็ก, trim ขอบคลิป, split, duplicate, copy/paste, fade in/out, clip gain, Mute/Solo/Record-arm, Volume/Pan ต่อแทร็ก, snap, อัดทับ (overdub), เอฟเฟกต์ใช้กับคลิป, Mixdown ไปไฟล์ใหม่/ส่งออก WAV, บันทึก/เปิดเซสชัน (`.asession`)

**ส่งออก** — WAV 16/24/32-float (มี dither)

## เวอร์ชัน 1.1 — ส่วนที่เติมให้ครบก่อนแจกจ่าย (ROADMAP-MISSING.md)

- **VST ในแอปที่ติดตั้งแล้ว**: Effects > Install VST Support… / Plugin Manager…, Help > Check VST / ffmpeg Status…, Install ffmpeg… (รายละเอียดในหัวข้อ "ปลั๊กอิน VST3 / AU")
- **Recent Files**: File > **Open Recent** (ไฟล์เสียง) และ **Open Recent Session** (`.asession`) อย่างละ 10 รายการ ล่าสุดอยู่บน + **Clear Recent** · แอปเดสก์ท็อปเก็บใน `recent.json` ในโฟลเดอร์ข้อมูลของแอป เปิดซ้ำจาก path ได้ และเพิ่มลง **Windows Jump List** (คลิกขวาไอคอนบน taskbar) · ถ้าไฟล์ถูกย้าย/ลบไปแล้ว แอปแจ้งเตือนและเอาออกจากรายการ · โหมดเบราว์เซอร์จำแค่ชื่อไฟล์ใน localStorage (เบราว์เซอร์เปิดไฟล์เองไม่ได้ จึงเปิดหน้าต่าง Open ให้เลือกไฟล์นั้นอีกครั้ง)
- **หน้าต้อนรับ (Start screen)**: ขึ้นตอนเปิดแอปเมื่อยังไม่มีงานเปิดอยู่ (ไม่ขึ้นถ้ากู้คืนงานหลังแครช หรือเปิดไฟล์จาก Explorer) — New Audio File… / New Multitrack Session / Open… / Open Multitrack Session… / รายการ Recent Files + Recent Sessions (คลิกเปิดได้เลย) / AudioStage Help / Keyboard Shortcuts · หายไปเองเมื่อสั่งอะไรก็ได้ · ปิดได้ด้วยช่อง "Show this screen when AudioStage opens" (= Preferences > General) · เปิดอีกครั้งได้ที่ Help > Start Screen
- **คู่มือในตัวโปรแกรม** (Help > AudioStage Help, **F1** — คีย์ลัด Keyboard Shortcuts ย้ายไป **Shift+F1**): หน้า HTML ออฟไลน์ `app/help/index.html` สร้างจาก README นี้ด้วย `node tools/make-help.js` (เทสต์ตรวจว่าตรงกับ README เสมอ) แบ่งหัวข้อตาม section และย่อหน้าที่ขึ้นต้นด้วยตัวหนา มีช่องค้นหา (ไทย/อังกฤษ, ไฮไลต์คำที่พบ) · แอปเดสก์ท็อปเปิดเป็นหน้าต่างแยก, เบราว์เซอร์เปิดแท็บใหม่
- **Help > Show Log Files** (เดสก์ท็อป: เปิดโฟลเดอร์ `logs` ในโฟลเดอร์ข้อมูลของแอป — บันทึกการเริ่มแอป, error ของหน้าต่าง, โพรเซสที่ล่ม; เกิน 2 MB เก็บไฟล์เก่าไว้หนึ่งชุด) · **Report a Problem…** รวบรวมเวอร์ชัน, ระบบปฏิบัติการ, สถานะ VST / ffmpeg และท้าย log ให้คัดลอกไปส่งเอง (แอปไม่ส่งอะไรออกไปเอง) · **Check VST / ffmpeg Status…**
- **Tooltip** อธิบายพารามิเตอร์ทุกตัวของเอฟเฟกต์ทุกตัว (หน้าต่างเอฟเฟกต์ offline, generator, หน้าต่าง/แผง Effects Rack) — `app/js/tips.js`, เทสต์ตรวจว่าครบทุกพารามิเตอร์ · ช่องใน Preferences ก็มี tooltip
- **Preferences** (Edit > Preferences…, **Ctrl+K** — ในพรีเซ็ตคีย์ลัด Adobe Audition ปุ่ม Ctrl+K เป็น Split จึงเปิดจากเมนูแทน): หน้าต่างเดียวแบ่งแท็บ **General** (ธีม, ถามก่อนปิดเมื่อมีไฟล์ยังไม่บันทึก, Snap to Zero Crossings, pre/post-roll ของ Preview Edit) · **Audio Hardware** (อุปกรณ์เข้า/ออก — File > Audio Hardware Setup… เปิดแท็บนี้) · **Recording** (latency, punch pre/post-roll, โฟลเดอร์ที่บันทึกไฟล์อัดเป็น WAV เพิ่มอีกชุด — เดสก์ท็อป) · **Autosave** · **Files** (โฟลเดอร์เริ่มต้นของ Open / Save — เดสก์ท็อป, ฟอร์แมตส่งออกเริ่มต้น, sample rate / channels / bit depth ของไฟล์ใหม่ และ sample rate / bit depth ของเซสชันใหม่ — บันทึกลง `.asession` ด้วย) · **Multitrack** (crossfade อัตโนมัติ, เส้นโค้ง, Overlapping Clips, Snap, ระดับเสียงของแทร็กใหม่) · **Display** (หน่วยเวลา, ค่า Spectral) · **VST / ffmpeg** (สถานะ + ปุ่ม Manage / Plugin Manager)
  - ทุกค่ามี **ที่เก็บเดียว**: ค่าที่เคยมีเมนู/หน้าต่างของตัวเอง (Recording Settings, Pre-roll / Post-roll, Autosave, Spectral Display Settings, Toggle Theme, Cycle Time Display Format, Snap to Zero Crossings) อ่าน-เขียนค่าชุดเดียวกับ Preferences · ปุ่ม **Reset All Preferences…** คืนค่าเริ่มต้นทั้งหมด (คีย์ลัด, favorites, workspaces ไม่ถูกแตะ) · เทสต์ในแอปจริงตรวจว่าค่าที่ตั้งถูกใช้จริงตอนสร้างไฟล์/เซสชัน/ส่งออก/อัดเสียง
- **เปิดไฟล์ด้วยการดับเบิลคลิก**: ตัวติดตั้งผูกไฟล์ `.asession` กับ AudioStage (ไอคอน `build/asession.ico` สร้างจากโลโก้ด้วย `node tools/make-ico.js`) และเพิ่ม AudioStage ในเมนู **"Open with"** ของ `.wav .mp3 .flac .ogg .opus .m4a .aac .aif .aiff` โดย **ไม่ตั้งเป็นโปรแกรมหลัก** (`build/installer.nsh` เขียนแค่ OpenWithProgids; ถอนการติดตั้งแล้วลบออก) · ดับเบิลคลิก `.asession` → เปิดในมัลติแทร็ก, ไฟล์เสียง → เปิดใน Waveform ทั้งตอนแอปยังไม่เปิด (argv) และตอนเปิดอยู่แล้ว (second-instance: ใช้หน้าต่างเดิม) · ไฟล์ที่เปิดแบบนี้เข้า Recent Files ด้วย

- **Workspaces** (Window > Workspace แบบ Audition): ชุดเลย์เอาต์ของแผง (แผงไหนเปิด/ย่อ) + โหมด Waveform/Multitrack + มุมมอง Spectral · สำเร็จรูป 5 ชุด **Default** (ค่าเริ่มต้นของทุกแผง), **Editing** (Files, Markers, History, Effects, Properties), **Mixing** (มัลติแทร็ก + Mixer, Effects Rack, Level Meters, Loudness), **Spectral Repair** (Spectral + Spectrum Analyzer, Diagnostics, History), **Podcast / Radio** (มัลติแทร็ก + Essential Sound, Loudness Meter, Match Loudness, Media Browser, Mixer) · คีย์ลัด **Alt+Shift+1…5** สลับ 5 รายการแรก (แก้ได้ใน Keyboard Shortcuts; ใช้ปุ่มตัวเลขจริงไม่ว่าแป้นพิมพ์ภาษาอะไร) · **Save as New Workspace…** บันทึกเลย์เอาต์ปัจจุบัน, **Edit Workspaces…** สลับ/เปลี่ยนชื่อ/ลบ (ชุดสำเร็จรูปลบหรือเปลี่ยนชื่อไม่ได้), **Reset to Saved Layout** กลับไปเลย์เอาต์ที่บันทึกของ workspace ที่ใช้อยู่ (ปรับแผงหลังสลับแล้วยังจำไว้ข้ามการเปิดแอปตามปกติ) · เก็บใน localStorage (`as-workspaces-v1`) — `app/js/workspaces.js`
- **DeReverb** (Effects > Noise Reduction / Restoration): ลดเสียงก้องห้องด้วย DSP ล้วน — ประมาณพลังงานของเสียงก้องช่วงท้าย (late reverberation) ในแต่ละย่านความถี่จากเสียงเมื่อ 50 ms ก่อน ที่ลดลงตามเวลาก้องของห้อง (T60) แล้วหักออกแบบ spectral subtraction (แนวทางของ Lebart, Boucher & Denbigh 2001) · **DeReverb (process)…** แบบ offline: Amount, Processing Focus (ทุกความถี่ / ต่ำ / กลาง-เสียงพูด / สูง), Gain compensation, Auto gain compensation (คืนความดังเท่าเดิม) และ Room decay T60 (0 = **ประมาณจากไฟล์เอง** จากช่วงที่เสียงจางลง) มีปุ่ม Preview · **DeReverb…** แบบเรียลไทม์ใน Effects Rack (AudioWorklet เรียกฟังก์ชันต่อเฟรมตัวเดียวกับแบบ offline จึงได้ผลเท่ากัน; ตั้ง T60 เอง เพราะตอนเล่นสดไม่มีทั้งไฟล์ให้วัด) ใส่ในแทร็ก/คลิป หรือ Preview + Apply ใน Waveform ได้ · latency 3072 แซมเปิล ชดเชยอัตโนมัติ (แก้ค่า latency ที่ประกาศของ DeNoise / Adaptive Noise Reduction จาก 1536 เป็น 3072 ให้ตรงของจริงด้วย) · เทสต์: เสียงแห้ง + convolution reverb สังเคราะห์ → ผลใกล้เสียงแห้งกว่าเดิม, การประมาณ T60, เรียลไทม์ = offline
- **Generate > Speech…** (Text to Speech, เฉพาะแอปเดสก์ท็อปบน Windows): พิมพ์ข้อความ เลือกเสียง/ภาษา — รายการคือ **เสียงที่ติดตั้งใน Windows** (ภาษาไทยขึ้นก่อน เช่น Microsoft Pattara) ความเร็ว (50–300 %), pitch (±12 st, ความยาวเท่าเดิม), ระดับเสียง (normalize peak) · ถ้ามี selection: **แทนที่ selection** หรือ **แทรกที่ต้น selection**; ไม่มี selection: แทรกที่ playhead; ไม่มีไฟล์เปิดอยู่ (หรืออยู่ในมัลติแทร็ก): สร้างไฟล์ใหม่ · **Undo ได้** (Generate Speech) · ทำงาน **ออฟไลน์ทั้งหมด** ไม่ใช้บริการคลาวด์ ไม่ส่งข้อความหรือเสียงออกนอกเครื่อง: main process เรียก Windows PowerShell 5.1 (`-EncodedCommand` ไม่ต้องแก้ execution policy; ข้อความส่งผ่านไฟล์ชั่วคราว UTF-8 ภาษาไทยไม่เพี้ยน) ใช้ **WinRT `Windows.Media.SpeechSynthesis`** (เห็นเสียง OneCore ที่ language pack ติดตั้ง — เสียงไทยอยู่ที่นี่) และ **System.Speech (SAPI)** เป็นตัวสำรอง แล้วรับกลับเป็น WAV · ภาษาที่เครื่องยังไม่มีเสียง (ไทย, อังกฤษ, ญี่ปุ่น, จีน, เกาหลี, ฝรั่งเศส, เยอรมัน, สเปน, เวียดนาม) ขึ้นในรายการว่า "no voice installed" และบอกวิธีติดตั้ง: Windows Settings > Time & language > Language & region > Add a language > (ภาษา) > ติ๊ก **Text-to-speech** — ติดตั้งแล้วเปิดหน้าต่างใหม่ได้เลยไม่ต้องรีสตาร์ท · โหมดเบราว์เซอร์ไม่มีเมนูนี้ (เบราว์เซอร์อัดเสียงพูดลงไฟล์แบบออฟไลน์ไม่ได้) · `electron/tts.js`, `app/js/speech.js` · เทสต์: `tests/tts.test.js` (PowerShell จำลอง + เสียงจริงหนึ่งครั้งถ้าเครื่องมีเสียง) และ `tests/app/94-speech.scenario.js` (เอนจินเสียงจำลอง)
- **File > File Info / Metadata…**: Title, Artist, Album, Year, Genre, Track (เช่น `3/12`), Comment และ **ภาพปก** (PNG / JPEG ไม่เกิน 8 MB, มีตัวอย่างภาพ + Remove) ของไฟล์ที่เปิดอยู่ · Title / Artist ในหน้าต่าง Save As เป็นค่าชุดเดียวกัน และเขียนลง **BWF / CART** ของ WAV เหมือนเดิม · ตอนบันทึก (Save As / Save Selection As / Batch Process) เขียนแท็กลงไฟล์ด้วยโค้ดของโปรเจกต์เอง (`app/js/tags.js` ไม่ใช้ไลบรารี GPL) รองรับ UTF-8 ภาษาไทยไม่เพี้ยน: **MP3 / AAC (ADTS)** → ID3v2.4 · **FLAC** → VORBIS_COMMENT + PICTURE · **Opus** → OpusTags (ภาพปกเป็น METADATA_BLOCK_PICTURE; แบ่งหน้า Ogg และคำนวณ CRC ใหม่) · **M4A** → atoms `©nam ©ART ©alb ©day ©gen ©cmt trkn covr` ใน `moov/udta/meta/ilst` (ขยับ chunk offset ให้) · **WAV** → LIST/INFO + chunk `id3 ` (ภาพปก) · **อ่านแท็กตอนเปิดไฟล์** (ID3v2.2–2.4 / ID3v1, Vorbis comments ของ FLAC / Opus / Ogg Vorbis, MP4, WAV INFO / id3 / CART / BWF) และเก็บไว้กับไฟล์ (รวมใน Autosave) บันทึกซ้ำแล้วแท็กไม่หาย · ติ๊ก "Include metadata" ออกในหน้าต่าง Save As ถ้าไม่ต้องการแท็ก · **Batch Process** เขียนแท็กของแต่ละไฟล์ด้วย และใช้ `{title}` `{artist}` `{album}` `{year}` `{genre}` `{track}` ในชื่อไฟล์ได้ (`{title}` ว่างจะใช้ชื่อไฟล์แทน) · Export Multitrack Mixdown ยังไม่ใส่แท็ก (ใช้กับไฟล์ใน Waveform) · เทสต์: `tests/tags.test.js` (เขียน → อ่านกลับทุกฟิลด์ รวมภาษาไทยและภาพปก, เสียงไม่ถูกแตะ) และ `tests/app/95-metadata.scenario.js` (encoder จริงทุกฟอร์แมต ไฟล์ที่ติดแท็กแล้วยังถอดรหัสได้)
- **อัปเดต**: AudioStage รับเวอร์ชันใหม่ผ่าน **BYS All Stages Launcher** · `package.json` ไม่มี `build.publish` จึงไม่สร้าง `app-update.yml` และ **ไม่แสดง Help > Check for Updates…** (และตัวเลือกใน Preferences) — โค้ด electron-updater (`electron/updater.js`, `app/js/updates.js`) ยังอยู่และเปิดเองเฉพาะเมื่อตัวที่ติดตั้งมีแหล่งอัปเดตจริง (ถามก่อนดาวน์โหลด/ติดตั้งทุกครั้ง) · เทสต์: `tests/updater.test.js`, `tests/app/96-updates.scenario.js` (เซิร์ฟเวอร์อัปเดตจำลอง)

### วิธีออกเวอร์ชันใหม่

1. เพิ่มเลข `version` ใน `package.json` (About และคู่มือใช้เลขนี้เอง)
2. `npm test` (0 failed) แล้ว `npm run dist` (`predist` สร้างคู่มือ `app/help/index.html` ใหม่จาก README ก่อน; `--publish never`)
3. ส่ง `dist/AudioStage Setup <version>.exe` ให้ BYS All Stages Launcher

- ตัวติดตั้งยังไม่ได้เซ็นโค้ด (ไม่ซื้อใบรับรอง): Windows SmartScreen อาจเตือนตอนติดตั้ง/อัปเดต — กด "More info > Run anyway"

## เพิ่มในเวอร์ชัน 2.1.0

- **Save จริง**: File > **Save** (Ctrl+S) บันทึกทับไฟล์ที่เปิดมา (WAV ที่ bit depth เดิม / FLAC; ไฟล์ lossy ถามรูปแบบครั้งแรกครั้งเดียว) · **Save As…** (Ctrl+Shift+S) เลือกที่บันทึกด้วยหน้าต่างของระบบ · ไฟล์ถูกนับว่า "บันทึกแล้ว" เฉพาะเมื่อเขียนครบจริง — กด Cancel หรือเขียนไม่สำเร็จ เครื่องหมาย `*` ยังอยู่ · ชื่อไฟล์/เซสชัน + `*` อยู่บน title bar
- **เขียนไฟล์อย่างปลอดภัย**: ทุกการบันทึก (Save, Save Session, Export Mixdown, Save back to EditorStage, Export Ranges, CD Layout, Batch, autosave) เขียนลงไฟล์ชั่วคราว → fsync → เปลี่ยนชื่อทับ จึงไม่มีไฟล์ครึ่งๆ กลางๆ เมื่อแครช/ดิสก์เต็ม (`electron/savefile.js`) · ส่งออกหลายไฟล์ลงโฟลเดอร์ที่มีชื่อซ้ำ: ถาม Replace / Keep Both (เติม " (2)") / Cancel — ไม่ทับเงียบๆ
- **เซสชันมัลติแทร็ก**: มีสถานะ "ยังไม่บันทึก" — ปิดหน้าต่าง, เปิดเซสชันอื่น, New Session หรือ Recover จะถาม Save / Don’t Save / Cancel · **Save Multitrack Session** (Ctrl+S ในมัลติแทร็ก) บันทึกทับไฟล์เดิม, **Save Multitrack Session As…** · Recent Sessions จำ path จริง
- **`.asession` รูปแบบ 4 (ZIP)**: `session.json` + เสียงแต่ละก้อนเป็น WAV 32-bit float แยกไฟล์ เขียน/อ่านเป็นชิ้น (มีแถบ % และ Cancel) จึง **ไม่มีเพดานความยาว** (รูปแบบเดิมเก็บเสียงเป็น base64 ใน JSON ก้อนเดียว บันทึกเกิน ~17 นาทีสเตอริโอ 48 kHz ไม่ได้) · ใช้ ZIP64 เมื่อเกิน 4 GB · ตรวจ CRC ตอนเปิด · เช็กพื้นที่ดิสก์ก่อนบันทึก · ไฟล์ v1–v3 เปิดได้เหมือนเดิม · เปิดดูด้วยโปรแกรม zip ทั่วไปได้
- **File > Open หลายไฟล์ใหญ่**: อ่านทีละไฟล์เป็นชิ้น (มี % และ Cancel) ไม่โหลดทุกไฟล์เข้าหน่วยความจำพร้อมกัน
- **File > Recover Last Session…**: ปิดแอปปกติแล้วงาน autosave ล่าสุดยังเก็บไว้ (เผลอกด Close Without Saving ก็กู้ได้)
- **การอัดเสียงเขียนลงดิสก์ระหว่างอัด** (ทุก 5 วินาที) — แอปแครช/ไฟดับระหว่างอัด เปิดใหม่แล้วกู้ take ได้ (Recover interrupted recording)
- **Export Video with Mixdown**: ตัดเสียงให้ยาวเท่าวิดีโอพอดี (`-t` ความยาววิดีโอ) ไม่เกิน 1 เฟรม
- **ความปลอดภัย**: หน้าต่างหลักไม่เปิดหน้าต่างใหม่/ไม่เปลี่ยนไปหน้าอื่น (ลิงก์เว็บเปิดในเบราว์เซอร์) · F12 / DevTools เฉพาะตอนรันจากซอร์ส (`npm start`) หรือ `AUDIOSTAGE_DEVTOOLS=1`
- About แสดงเวอร์ชันจริงจาก `package.json` + `Copyright (c) BYS & RB. All rights reserved by BYS & RB` · license `UNLICENSED`, author `BYS & RB`

## เพิ่มในเวอร์ชันนี้

- **ส่งออก MP3 (128–320 kbps) และ FLAC 16/24-bit** นอกเหนือจาก WAV — FLAC เขียนเอง (ทดสอบแล้วว่าถอดรหัสกลับตรงบิต), MP3 ใช้ lamejs (`app/vendor`)
- **ประมวลผลใน Web Worker** — UI ไม่ค้าง, มีปุ่ม Cancel, ถ้า worker เริ่มไม่ได้จะถอยกลับไปรันบน main thread อัตโนมัติ
- **Effects Rack เรียลไทม์ต่อแทร็กและ Master Bus** — Gain, 3-Band EQ, Filter, Compressor, Limiter, Delay, Reverb, Chorus, Flanger, Phaser, Tremolo, Distortion; เปิด/ปิด, เรียงลำดับ, พรีเซ็ต Essential-Sound (Dialogue, Voiceover, Music, SFX, Ambience, Telephone)
- **Automation envelope** ของ Volume/Pan ต่อแทร็ก (คลิกเพิ่มจุด, ลากย้าย, ดับเบิลคลิก/คลิกขวาลบ) และ **Auto-Duck** สร้าง automation ให้อัตโนมัติจากแทร็กเสียงพูด
- **Spectral editing** — เครื่องมือ Marquee ในมุมมอง Spectral: Delete, Attenuate, Amplify, Spot Heal ตามกรอบเวลา×ความถี่
- **Adaptive Noise Reduction**, **Speech Volume Leveler**
- **Batch Process** — ใช้เอฟเฟกต์เดียวกับทุกไฟล์ที่เปิด แล้วส่งออกเป็นรูปแบบที่เลือกได้
- เปิด/ปิดช่อง L/R ที่จะแก้ไข (คลิกกล่อง L/R ข้างเวฟ), ไม้บรรทัดแอมพลิจูด dB, รูปแบบเวลา Decimal / Samples / SMPTE / Bars&Beats (คลิกที่นาฬิกา)
- เปิดไฟล์วิดีโอ (mp4/mov/webm/mkv) เพื่อดึงเสียงมาตัดต่อ (เท่าที่ตัวถอดรหัสของระบบรองรับ)

## เพิ่มล่าสุด

- ส่งออก **OGG Opus** และ **AAC (ADTS)** ผ่าน WebCodecs (ขึ้นกับการรองรับของระบบ — ตัวเลือกจะโชว์เฉพาะที่ใช้ได้)
- WAV: อ่าน/เขียน **markers (cue + label)** และ **BWF `bext`**
- **Audio Hardware Setup** — เลือกอุปกรณ์เอาต์พุต/อินพุต (ผ่านระบบ WASAPI/CoreAudio)
- **พรีวิววิดีโอ** ซิงก์กับ playhead เมื่อเปิดไฟล์วิดีโอ
- **Music Remix** — ปรับความยาวเพลงโดยตัด/ซ้ำช่วงที่เสียงคล้ายกัน แล้วละลายรอยต่อ
- **Sound Remover (เรียนรู้จริง)** — จับ print ของเสียงที่ไม่ต้องการ (Effects > Capture Noise Print) แล้วระบบเรียนรู้ basis ของมันด้วย NMF (non-negative matrix factorization) และแยกออกจากเนื้อหาที่เหลือ รองรับเสียงที่ไม่นิ่ง เช่น beep, ไซเรน, เสียงโทรศัพท์ — เป็นโมเดลที่เรียนจากไฟล์ของผู้ใช้ ไม่ใช่โมเดลสำเร็จรูปที่เทรนล่วงหน้า
- **Essential Sound แบบ auto-detect** — วิเคราะห์เนื้อหาแทร็ก (จังหวะพยางค์, ช่วงเงียบ, ความแบนของสเปกตรัม, centroid) แล้วเลือก preset Dialogue / Music / Sound effects / Ambience ให้ (ปุ่ม Auto-detect ใน rack หรือเมนู Multitrack > Auto-Match Essential Sound) — เป็นกฎฮิวริสติก ควรตรวจผลและแก้เองได้
- ส่งออก **M4A (AAC ในคอนเทนเนอร์ MP4)** ด้วย muxer ที่เขียนเอง
- WAV: เขียน/อ่าน **CART chunk** (title/artist) เพิ่มจาก BWF และ cue
- **Automation ครบทุกพารามิเตอร์ที่เป็น AudioParam ใน rack** (32 พารามิเตอร์ใน 12 เอฟเฟกต์ — Gain, EQ, Filter, Compressor, Limiter, Delay, Reverb mix, Chorus, Flanger, Phaser, Tremolo, Distortion) ผ่านเมนู Auto ในมัลติแทร็ก

## Effects Rack, Clip Envelopes และแผงต่างๆ (Window menu)

**Effects Rack** (ปุ่ม FX บนหัวแทร็ก / Window > Effects Rack / ปุ่ม Master) — แท็บ **Clip Effects** และ **Track Effects**; สล็อต 1–16 เรียงลำดับ ลากสลับตำแหน่งได้ ปุ่มไฟเขียวเปิด/ปิดเอฟเฟกต์ทีละช่อง ดร็อปดาวน์เลือกชนิด (กดลูกศรเพื่อดูพารามิเตอร์); **Input / Output gain**, **VU L/R**, **Dry/Wet 0–100%**, ปุ่ม **Power** เปิด/ปิดทั้งแร็ค; Presets: ดร็อปดาวน์ + ปุ่มบันทึก (ไอคอนแผ่นดิสก์) + ปุ่มลบ (ไอคอนถังขยะ) พร้อม **พรีเซ็ตในตัว 38 ชุด** (AM Radio … Wide Spooky Echo) และพรีเซ็ตของผู้ใช้ — Undo/Redo ครอบคลุมทุกการแก้แร็ค

เอฟเฟกต์ในแร็ค: Gain, 3-Band EQ, Filter, Compressor, Limiter, Noise Gate (AudioWorklet), De-esser, Delay/Echo (ทั้งสัญญาณ / เฉพาะ center / เฉพาะ side), Reverb, Chorus, Flanger, Phaser, Tremolo, Distortion, Bit Crusher, Stereo Widener, Haas Stereo Maker, Center Channel Cut

**Clip envelopes และ fade** (มัลติแทร็ก) — เส้น Volume สีเหลืองทอง (#FFD700, 0.0–2.0 เท่า, กลางคลิป = 1.0 = 0 dB) และ Pan สีฟ้า (#00E5FF, ล่าง = ซ้าย, กลาง = Center, บน = ขวา) พาดบนทุกคลิป แบบ Adobe Audition · ดับเบิลคลิกบนเส้นเพื่อเพิ่ม keyframe · คลิกลากที่จุดเพื่อย้าย (เวลาไม่เลยจุดข้างเคียงและความยาวคลิป) · คลิกขวาที่จุดเพื่อลบ · ชี้/คลิกที่เส้นแล้วจุดจะไฮไลต์พร้อมแสดงค่า · ตรงที่สองเส้นทับกัน (ค่าเริ่มต้นอยู่กลางคลิปทั้งคู่) คลิกจะได้เส้นเหลือง (Volume) — กด **Alt** ค้างเพื่อเลือกเส้นฟ้า (Pan) · แก้ระหว่างเล่นได้ทันทีโดยเสียงไม่สะดุด · ดรอปดาวน์ *Clip envelopes* (Off / Volume + Pan / Volume / Pan) เลือกเส้นที่แสดง · โค้ดอยู่ที่ `app/js/envelope.js` · **Dynamic Waveform Scaling**: กราฟคลื่นในคลิปพอง/ยุบตามความดังจริง (Volume envelope × fade × clip gain, ที่ 0.0 เป็นเส้นตรง) ระหว่างลากจุดวาดใหม่เฉพาะคลิปนั้น — เป็นการแสดงผลเท่านั้น ไม่แตะข้อมูลเสียง (`app/js/wavescale.js`) · **Fade handle** ที่มุมซ้ายบน/ขวาบนของคลิป ลากปรับความยาว fade คลิกขวาหรือดับเบิลคลิกที่ handle เพื่อเลือกโค้ง (Linear / Cosine / Logarithmic / Exponential) — เสียงตามโค้งจริงในทั้งการเล่นและการเรนเดอร์

**Bus, Sends และ Sidechain** (มัลติแทร็ก)
- ปุ่ม **+ Bus** สร้างแทร็กชนิด bus (ไม่มีคลิป มี rack, volume, pan, mute/solo, automation เหมือนแทร็กเสียง; เลนเป็นลายทแยงและบอกว่าแทร็กไหนส่งเข้ามา) — คลิปลาก/วาง/วางซ้ำลง bus ไม่ได้ จะไปลงแทร็กเสียงถัดไปแทน
- **Output** ของทุกแทร็ก (ดรอปดาวน์ “→ Master” บนหัวแทร็กและใน Mixer): Master หรือ bus ใดก็ได้
- **Sends** สูงสุด 16 ช่องต่อแทร็ก (ใน Mixer: ปุ่ม **+ Send**, เลือก bus ปลายทาง, ปุ่มระดับ dB, ปุ่ม **PRE/POST** fader, ×ลบ, แถบ pan) · automation ระดับและ pan ของ send ได้ที่ *Track automation*
- **Sidechain**: Single-band Compressor, Dynamics, Dynamics Processing, Noise Gate และเอฟเฟกต์ใหม่ **Auto-Duck (Sidechain)** มีพารามิเตอร์ *Sidechain input* เลือกแทร็ก/bus อื่นเป็น key (ใช้สัญญาณหลัง fader ของแทร็กนั้น) — ถ้าไม่เลือก key จะใช้ DynamicsCompressor เดิม เสียงเหมือนเดิมทุกอย่าง; ถ้าเลือก key จะใช้ AudioWorklet `as-dyn` ที่เรียกอัลกอริทึม `AS.dsp.createDynamics` ใน `dsp.js` (โค้ดเดียวกับที่เทสต์ใน Node)
- **กันลูป**: output, send และ sidechain นับเป็นเส้นทางเดียวกันหมด (`app/js/routing.js`) ตัวเลือกที่จะทำให้วนลูปจะไม่ขึ้นให้เลือก และเซสชันที่ถูกแก้มือจนวนลูปจะถูกตัดเส้นที่ทำให้วนทิ้งตอนเล่น (Web Audio จะปิดเสียงทั้งวงถ้าปล่อยไว้)
- **Solo**: แทร็กที่ solo + bus ที่มันส่งไปยังได้ยิน, solo bus แล้วแทร็กที่ส่งเข้า bus นั้นได้ยินด้วย; แทร็กที่ถูก mute/ไม่ได้ solo แต่เป็น key ของ sidechain ยังส่ง key ต่อ (ducking ยังทำงานตอน solo เพลง)
- ลำดับสัญญาณต่อแทร็กเป็นแบบ Audition: คลิป → **rack ของแทร็ก → fader → pan** → output (*เดิม fader อยู่ก่อน rack* — แทร็กที่มี compressor และตั้ง volume ไม่ใช่ 0 dB จะได้ยินต่างเล็กน้อย) · pre-fader send แตกหลัง rack, post-fader send แตกหลัง fader
- การเล่นสดกับการมิกซ์ดาวน์ใช้ graph builder ตัวเดียวกัน และมีเทสต์ในแอปจริงที่อัดเสียงจากการเล่นสดเทียบกับไฟล์ที่เรนเดอร์ (ต้องตรงกันระดับ < −30 dB)

**Crossfade อัตโนมัติ และนโยบายคลิปทับกัน** (มัลติแทร็ก)
- ลากคลิปให้ทับกันบนแทร็กเดียว → ส่วนที่ทับกลายเป็น **crossfade** อัตโนมัติ (คลิปหลัง fade in, คลิปหน้า fade out) แสดงเป็นรูป **X** (เส้นขาว = fade in, เส้นทอง = fade out) — ลาก **จุดกลางของ X** เพื่อปรับความยาว crossfade (ตัด/ยืดขอบคลิปทั้งสองรอบจุดกลาง เสียงของทั้งสองคลิปอยู่ตำแหน่งเดิม)
- เมนู **Multitrack > Crossfades**: เปิด/ปิด Automatic Crossfades, โค้ง Linear / Cosine / Logarithmic / Exponential, **Symmetric** หรือ **Asymmetric** (fade out ใช้โค้งตรงข้าม log↔exp)
- crossfade เก็บแยกจาก fade ที่ผู้ใช้ตั้งเอง: เมื่อคลิปไม่ทับกันแล้ว fade เดิมกลับมา · Cosine/Linear แบบ symmetric ให้ระดับรวมคงที่ตลอดช่วงทับ (เทสต์ด้วยเสียงจริง)
- เมนู **Multitrack > Overlapping Clips**: **Overlap (crossfade)** · **Overwrite** (คลิปที่วางอยู่ด้านหน้าและได้ยินแทนสิ่งที่อยู่ใต้มัน — ส่วนที่ถูกบังไม่ถูกลบ ย้ายคลิปออกหรือ Send Clip to Back แล้วกลับมา · การอัดแบบ punch-in ยังตัดของเดิมจริงเหมือนเดิม) · **Insert (ripple)** (คลิปถัดไปทั้งแทร็กเลื่อนขวาเท่าความยาวคลิปที่วาง คลิปที่คร่อมจุดวางถูก split) — ใช้ตอนลากย้าย วางไฟล์ วาง/duplicate คลิป อัดเสียง และเปลี่ยน Start ใน Clip Properties
- ตั้งค่าเก็บในเซสชันและ Undo ได้ · เซสชันเก่า (ก่อนมีฟีเจอร์นี้) เปิดมาโดยปิด crossfade อัตโนมัติไว้ เพื่อให้เสียงเหมือนเดิม

**สลับเลเยอร์ในมัลติแทร็ก** (แบบ Adobe Audition)
- **ย้ายลำดับแทร็ก**: ลากหัวแทร็ก (ส่วนที่ไม่ใช่ปุ่ม/ช่องกรอก) ขึ้น/ลง — มีเส้นบอกตำแหน่งที่จะวาง และเลื่อนจอเองเมื่อลากไปถึงขอบ · ใช้ได้กับแทร็กเสียง, Bus และ Video · **Ctrl+คลิก / Shift+คลิก** หัวแทร็กเพื่อเลือกหลายแทร็กแล้วลากหรือสั่งย้ายพร้อมกัน (ลำดับระหว่างกันคงเดิม)
- เมนู **Multitrack > Move Track Up / Move Track Down / Move Track to Top / Move Track to Bottom** (คีย์ลัด **Alt+Shift+↑ / ↓ / Home / End** แก้ได้ใน Keyboard Shortcuts — Audition ไม่มีคีย์ลัดเริ่มต้นของคำสั่งนี้ พรีเซ็ต Audition จึงใช้ค่าเดียวกัน) และเมนูคลิกขวาที่หัวแทร็ก
- **Mixer** เรียงช่องตามลำดับแทร็กทันที และลาก strip (จับที่ชื่อ) เพื่อสลับลำดับได้เหมือนกัน
- routing / sends / sidechain / automation / สี / freeze อ้างแทร็กด้วย id จึงไม่เสียเมื่อย้าย · ลำดับใหม่บันทึกลง `.asession`, Autosave, Versions และ FCP XML · หนึ่งการลาก = Undo หนึ่งขั้น · เสียงเล่นสดและมิกซ์ดาวน์เหมือนเดิมทุกตัวอย่าง (เทสต์เทียบทีละ sample)
- **ลำดับคลิปที่ซ้อนกัน**: คลิกขวาคลิป หรือเมนู Multitrack > **Bring Clip to Front / Send Clip to Back** — ในช่วงที่คลิปบนแทร็กเดียวกันทับกัน ได้ยินเฉพาะคลิปด้านหน้า (ตัดเข้า-ออกด้วย ramp 3 ms กันเสียงคลิก) คลิกที่ช่วงทับจะเลือกคลิปด้านหน้า คลิปด้านหลังแสดงจางในส่วนที่ถูกบัง · คลิปใหม่/คลิปที่วางในโหมด Overwrite อยู่ด้านหน้าเสมอ · โหมด **Overlap (crossfade)**: ช่วงที่เป็น crossfade อัตโนมัติยังผสมสองคลิปเหมือนเดิม ลำดับมีผลกับส่วนที่บังกันจริง (คลิปซ้อนอยู่กลางอีกคลิป หรือเมื่อปิด crossfade อัตโนมัติ)
- ลำดับเก็บในคลิป (`z`) และ `settings.stack` ใน `.asession` · Undo ได้ · live = offline (ใช้ graph เดียวกัน) · **เซสชันเก่า** เปิดมาด้วยลำดับตามเดิมและปิดการบังไว้ (คลิปที่ทับกันยังรวมเสียงกันเหมือนเดิม) จนกว่าจะใช้ Bring to Front / Send to Back หรือโหมด Overwrite
- โค้ด: `Session.moveTracks / shiftTracks / stackFront / stackBack / hiddenRanges` ใน `app/js/multitrack.js` (เสียงที่ถูกบังปิดด้วย GainNode ใน graph เดียวกับการเล่นสด) · เทสต์: `tests/clips.test.js` (มิกซ์ดาวน์ก่อน-หลังย้ายแทร็กเท่ากันทุก sample ทั้ง live และ offline, routing/sends/sidechain ยังถูก, Bring to Front เปลี่ยนเสียงในช่วงทับ, Undo, เซสชันเก่า) และ `tests/app/71-layers.scenario.js` (ลากหัวแทร็ก/Bus/Video ด้วยเมาส์จริง, auto-scroll, เลือกหลายแทร็ก, เมนู + คีย์ลัด, ลาก strip ใน Mixer, Bring/Send ด้วย Web Audio จริง)

**Tempo, Grid และ Metronome**
- **Edit > Tempo and Time Signature…** ตั้ง BPM, จำนวนจังหวะต่อห้อง, หน่วยจังหวะ (x/2, x/4, x/8, x/16) และจุดเริ่มห้องที่ 1 — ในมัลติแทร็กเป็นค่าของเซสชัน (เก็บใน `.asession`, Undo ได้) ใน Waveform เป็นค่าของไฟล์ (Undo ได้; ติดไปกับคลิปเมื่อแทรกเข้ามัลติแทร็ก)
- ปุ่ม **Detect from audio** ในหน้าต่างเดียวกัน: ตรวจ BPM และตำแหน่งจังหวะจาก selection/ไฟล์ (Waveform) หรือคลิปที่เลือก/ทั้งมิกซ์ (Multitrack) — onset (spectral flux) + autocorrelation + comb search ใน `dsp.detectTempo` · ความเร็วครึ่ง/สองเท่ากำกวมโดยธรรมชาติ (เช่น DnB 174 ↔ 87) จึงมีปุ่มให้เลือกค่าทางเลือก
- **Bars:Beats** (View > Cycle Time Display Format หรือคลิกนาฬิกา): นาฬิกาแสดง `ห้อง | จังหวะ | tick` ตาม tempo จริง (เดิมล็อก 120 BPM) และไม้บรรทัด/เส้นกริดทั้ง Waveform และ Multitrack แสดงห้อง จังหวะ และจังหวะย่อยตามระดับซูม
- **Multitrack > Snap to Grid**: Off / Bar / Beat / 1/8 / 1/16 (ทำงานร่วมกับ Snap to Clips & Playhead เดิม)
- **Metronome**: ปุ่มเมโทรนอมบนแถบ transport (คลิกขวา = ตั้งค่า) หรือ Transport > Metronome / Metronome Settings… — เสียง Beep / Click / Woodblock / Cowbell (สร้างจาก oscillator), ระดับเสียง, **count-in 1–2 ห้อง** ก่อนอัด (ส่วน count-in ถูกตัดออกจากเสียงที่อัด), **เฉพาะตอนอัด** · จังหวะแรกของห้องเน้นเสียง · เมโทรนอมเป็นเสียงสำหรับฟังเท่านั้น ไม่ถูกเรนเดอร์ลง mixdown/ส่งออก · ใช้ scheduler แบบ lookahead (สร้างคลิกล่วงหน้า 150 ms) จึงไม่สร้าง node เป็นพันตัวในเพลงยาว · เทสต์ในแอปจริงวัดเวลาคลิกได้ตรงกริดภายใน 3 ms

**Recording ระดับมืออาชีพ**
- การอัดทำบน audio thread (AudioWorklet `as-rec`) แทน ScriptProcessor เดิมที่ทำ block เสียงหายเมื่อ UI ยุ่ง — รู้เวลาของทุกแซมเปิลที่อัด จึงวางเสียงลงไทม์ไลน์ได้ตรงระดับแซมเปิล
- **ชดเชย latency**: Transport > Recording Settings… ตั้ง round-trip latency (ms) เอง หรือกด **Measure…** (เล่นคลิกทดสอบ 5 ครั้งแล้วจับเสียงที่วนกลับเข้ามา — ต่อสายจาก output เข้า input หรือถือไมค์ไว้ที่ลำโพง) · overdub จะตรงกับสิ่งที่ได้ยินตอนอัด
- **เลือกช่วงเวลาในมัลติแทร็ก**: ลากบนพื้นที่ว่างของแทร็ก (Ctrl+A = ทั้งเซสชัน, Ctrl+Shift+A = ยกเลิก)
- **Punch In/Out** (Transport menu): อัดเฉพาะช่วงที่เลือก — เล่นก่อนช่วง *pre-roll* วินาที, เก็บเฉพาะช่วงที่เลือก (แทนที่เสียงเดิมตรงนั้น), หยุดเองหลังช่วง *post-roll* วินาที (ใช้ timer ของ audio clock ทำงานแม้หน้าต่างถูกย่อ)
- **Loop recording → Takes**: เปิด Loop + เลือกช่วง แล้วอัด — ทุกรอบกลายเป็น take ในคลิปเดียว (รอบสุดท้ายที่อัดไม่ถึงครึ่งจะถูกทิ้ง) · การเล่นวนช่วงในมัลติแทร็กสร้าง graph ของแต่ละรอบล่วงหน้า ~0.5 วินาที เสียง reverb/delay ต่อข้ามรอบได้
- **Comping**: คลิกขวาที่คลิปที่มีหลาย take → เลือก take ทั้งคลิป หรือ **Comp Takes** — คลิปแสดงเลน take ละแถว **ลาก (swipe) บนเลน** เพื่อใช้ช่วงนั้นจาก take นั้น, คลิกเฉยๆ = ใช้ทั้งช่วงที่อยู่ใต้เมาส์จาก take นั้น · รอยต่อระหว่าง take มี crossfade แบบ equal-power 10 ms · Esc ออกจากโหมด comp · **Keep Comp, Delete Other Takes** · Undo ได้ทุกขั้น และ take ถูกเก็บใน `.asession`
- **Input monitoring** ต่อแทร็ก (ปุ่ม **I** ข้าง R): แทร็กที่ arm และเปิด I จะได้ยินเสียง input ผ่าน rack / fader / pan / routing ของแทร็กนั้น ทั้งตอนเล่น ตอนอัด และตอนหยุด (ใช้หูฟังเพื่อกันเสียงหอน)
- **เตือน clip**: ถ้า input แตะ 0 dBFS ระหว่างอัด ปุ่ม R ของแทร็กจะกะพริบแดง และแถบสถานะเตือน
- ระหว่างอัด การแก้ไขต่างๆ ไม่ทำให้การเล่นสะดุด (graph จะไม่ถูกสร้างใหม่จนกว่าจะหยุดอัด) และเลื่อน playhead ไม่ได้

**Clip time-stretch ในมัลติแทร็ก**
- กด **Alt ค้างแล้วลากขอบคลิป** = ยืด/หดเวลา (ขอบอีกด้านอยู่ที่เดิม) — ลากเฉยๆ ยังเป็นการ trim เหมือนเดิม · ช่วง 25–400 %
- **Clip Properties**: Stretch %, Pitch shift (±12 st), โหมด **Polyphonic** (WSOLA หน้าต่างยาว เหมาะกับดนตรี) / **Monophonic** (หน้าต่างสั้น เหมาะกับเสียงพูด/เครื่องดนตรีเดี่ยว) / **Varispeed** (เร็ว-ช้าและ pitch เปลี่ยนพร้อมกันแบบเทป)
- **Match to session tempo** (ใน Clip Properties หรือ Multitrack > Match Clip to Session Tempo): ใช้ BPM ของไฟล์ (ตั้ง/ตรวจใน Waveform แล้วแทรกเข้ามา) หรือตรวจ BPM ของคลิปให้อัตโนมัติ แล้วยืดให้ตรง tempo ของเซสชัน
- ไม่ทำลายต้นฉบับ: คลิปเก็บเสียงเดิม + ค่าการยืด เสียงที่ประมวลผลแล้วถูก **เรนเดอร์ใน Web Worker** และแคชตามค่าการตั้ง (ระหว่างเรนเดอร์ชื่อคลิปขึ้น “rendering…” และคลื่นแสดงจากต้นฉบับแบบย่อ/ขยาย) · ก่อนเล่น/มิกซ์ดาวน์ระบบรอให้เรนเดอร์ครบ จึงไม่มีการเล่นผิดความเร็ว · fade, envelope และ offset ปรับตามสัดส่วนการยืด · Undo ได้ และเก็บใน `.asession`
- การใช้เอฟเฟกต์ (process) กับคลิปที่ยืดอยู่ จะใช้เสียงที่ยืดแล้วเป็นอินพุต และผลลัพธ์กลายเป็นเสียงของคลิป (stretch กลับเป็น 100 %)

**Autosave, กู้คืนหลังแครช และ Project versions**
- **Autosave** ทุก N นาที (File > Autosave…, ค่าเริ่มต้น 2 นาที, ปิดได้) เก็บเซสชันมัลติแทร็ก + ไฟล์ใน Waveform ที่ยังไม่ได้บันทึก ลงเครื่องผู้ใช้เท่านั้น (แอปเดสก์ท็อป: โฟลเดอร์ `store` ใน userData · เบราว์เซอร์: IndexedDB) — เสียงเก็บเป็น WAV 32-bit float (ไม่สูญเสีย) เสียงแต่ละก้อนเขียนครั้งเดียว รอบถัดไปเขียนแค่ JSON เล็กๆ และลบไฟล์เสียงที่ไม่ถูกอ้างถึงแล้วอัตโนมัติ · ไม่ autosave ระหว่างอัด
- **กู้คืนหลังแครช**: ถ้าแอปไม่ได้ปิดตามปกติ ครั้งถัดไปจะขึ้นหน้าต่าง **Recover unsaved work** บอกว่ามีอะไรบ้าง (จำนวนแทร็ก/คลิป, ชื่อไฟล์) ให้เลือก Recover หรือ Discard — ถ้าปิดแอปตามปกติ autosave เก่าจะถูกลบ
- **Project versions** (File > Save Version… / Versions…): บันทึกสแนปช็อตของเซสชันพร้อมชื่อ ย้อนกลับไปเวอร์ชันใดก็ได้ ลบได้ — ก่อนย้อนกลับระบบเก็บเซสชันปัจจุบันเป็นเวอร์ชัน “Auto: before restoring …” ให้ก่อนเสมอ (Audition ไม่มีฟีเจอร์นี้)
- แก้บั๊กเดิม 2 จุดที่เจอระหว่างทำ: (1) แอปเดสก์ท็อปปิดหน้าต่างไม่ได้เลยเมื่อมีไฟล์ที่ยังไม่บันทึก (Electron ยกเลิกการปิดเงียบๆ) — ตอนนี้ถามยืนยันแทน (2) ถ้าเปิดแผง Mixer ค้างไว้ตอนปิดแอป ครั้งถัดไปจะมี error ตอนเริ่ม

**จัดการคลิป/แทร็ก (มัลติแทร็ก)**
- **เลือกหลายคลิป**: Ctrl+คลิก เพิ่ม/เอาออก · Ctrl+ลากบนพื้นที่ว่าง = กรอบเลือก (marquee) · ลากคลิปที่เลือกอยู่ = ย้ายทั้งหมดพร้อมกัน (เปลี่ยนแทร็กได้ถ้าทุกคลิปลงแทร็กเสียงได้) · Delete ลบทั้งหมด
- **คลิกขวาที่คลิป**: Split, Duplicate, Delete, **Ripple Delete** (ลบแล้วคลิปถัดไปบนแทร็กนั้นเลื่อนมาชิด; Shift+Delete), **Group / Ungroup** (Ctrl+G / Ctrl+Shift+G — คลิปในกลุ่มถูกเลือกและย้ายด้วยกัน), **Lock in Time** (คลิปไม่ขยับในเวลา), **Loop**, **Clip Color** (หรือใช้สีแทร็ก), Bounce, Properties, และเมนู Takes ถ้ามี — ชื่อคลิปแสดงสัญลักษณ์ 🔒 ⛓ ↻
- **Track color**: คลิกแถบสีบนหัวแทร็ก
- **Clip loop**: เปิด Loop แล้วลากขอบขวาออกไปได้ไม่จำกัด — เนื้อหาคลิปตอนเปิด loop วนซ้ำต่อเนื่องไร้รอยต่อ (ใช้ loop ของ AudioBufferSourceNode จึงตรงกันทั้งตอนเล่นและมิกซ์ดาวน์) มีเส้นประบอกจุดเริ่มแต่ละรอบ
- **Freeze Track** (Multitrack menu): เรนเดอร์คลิป + เอฟเฟกต์ของคลิปและแทร็ก (ก่อน fader) เป็นเสียงก้อนเดียว ระหว่างเล่นจึงไม่ต้องประมวลผลเอฟเฟกต์ (ลด CPU) — fader, pan, sends, routing ยังทำงาน · แทร็กที่ freeze แสดงจางและมีป้าย ❄ แก้คลิปไม่ได้จนกว่าจะ **Unfreeze** · ข้อจำกัด: sidechain จากแทร็กอื่นถูกเรนเดอร์ตามตอน freeze
- **Bounce to New Track**: แทร็กที่เลือก (หลัง fader + pan), คลิปที่เลือก (พร้อมเอฟเฟกต์/envelope/fade ของคลิป ไม่รวมเอฟเฟกต์แทร็ก), หรือทั้งมิกซ์ — ใช้ช่วงเวลาที่เลือก ถ้าไม่ได้เลือกใช้ทั้งหมด
- **Video track**: Multitrack > Insert Video… หรือลากไฟล์วิดีโอลงมัลติแทร็ก → แถววิดีโอด้านบนแสดง thumbnail ตามระดับซูม, เสียงในวิดีโอถูกแยกเป็นคลิปบนแทร็กเสียง, แผง Video เล่นตาม playhead ของมัลติแทร็ก, ลากแถววิดีโอเพื่อเลื่อนเวลา
- **Export audio back into video**: File > Export Video with Mixdown (ffmpeg)… — ใช้ ffmpeg ที่ไม่ได้รวมในแอป: ถ้ายังไม่มี แอปเสนอ **Install ffmpeg…** (หรือ Help > Check VST / ffmpeg Status… > Manage) ซึ่งดาวน์โหลดบิลด์ **LGPL shared** ของ BtbN/FFmpeg-Builds (GitHub) ตรวจกับ `checksums.sha256` ของรีลีสเดียวกัน แล้วแตกเฉพาะ `bin/` + LICENSE ลง `%APPDATA%\AudioStage\ffmpeg` (ราว 80 MB, มีปุ่ม Cancel / Repair / Remove) · ลำดับการหา: `AUDIOSTAGE_FFMPEG` → ที่แอปติดตั้ง → ffmpeg ใน PATH (เช่นที่ดาวน์โหลดเองจาก ffmpeg.org) · ffmpeg ติดตั้งแยกบนเครื่องผู้ใช้ ไม่ได้รวมในโค้ดของโปรเจกต์ · คัดลอกภาพเดิมโดยไม่เข้ารหัสใหม่ ใส่มิกซ์ดาวน์เป็นเสียง AAC ความยาวเท่าวิดีโอ · ใช้ได้ในแอปเดสก์ท็อป (เบราว์เซอร์ไม่รู้ตำแหน่งไฟล์วิดีโอ)

**Spectral editing (Waveform > มุมมอง Spectral)**
- เครื่องมือเลือกบนแถบ Spectral และเมนู **Spectral**: **Time** (T), **Marquee** (E — กรอบเวลา×ความถี่), **Lasso** (D — วาดรูปอิสระ), **Brush** (P — ระบายตามเสียง, Shift = ระบายเพิ่ม, ขนาดแปรงด้วยแถบเลื่อนหรือ `[` / `]`), **Spot Healing Brush** (B — ระบายทับคลิก/เสียงแปลกปลอมแล้ว heal ทันทีเมื่อปล่อยเมาส์ เป็น Undo 1 ขั้น), **Auto-select Harmonics** (H — คลิกที่เสียง แล้วระบบเลือกโน้ตนั้นทั้งช่วงเวลาพร้อมฮาร์มอนิกทุกตัว ตาม pitch ที่เปลี่ยนไปตามเวลา; ถ้าคลิกบนเสียงที่ไม่ใช่ฮาร์มอนิกของ pitch จะเลือกเฉพาะ partial นั้นตามที่มันเลื่อน)
- ทุกแบบใช้กับ **Delete / Attenuate / Amplify / Spot Heal** เดิมได้ (Delete key ก็ได้) — selection เป็นข้อมูล (`shape`) ส่งเข้า worker แล้วแปลงเป็น mask เวลา×ความถี่ต่อ bin ของ STFT (`dsp.shapeMask` / `spectralEdit`) ขอบนุ่มเพื่อไม่ให้เกิด artifact
- **Spectral Pitch Display** (Spectral > Show Pitch): เส้น pitch สีฟ้าอมเขียวซ้อนบน spectrogram — YIN (`dsp.yin`) + ขั้นปรับละเอียดด้วย harmonic comb (แม่นแม้มีเสียงอื่นที่ไม่ใช่ฮาร์มอนิกปนอยู่) คำนวณเฉพาะช่วงที่มองเห็น
- **Spectral Display Settings…**: FFT size 256–16384, window (Hann / Hamming / Blackman / Blackman-Harris / Rectangular), ช่วง dB (floor/top) และ color map (Audition / Grayscale / Viridis / Inferno / Rainbow) — เปลี่ยนแล้วเห็นผลทันที จำค่าไว้ข้ามการเปิดแอป

**การเลือกและการเล่น (Waveform)**
- **Edit > Snap to Zero Crossings**: ขอบ selection ที่ลากด้วยเมาส์ไปอยู่ที่จุดตัดศูนย์ใกล้ที่สุด (ภายใน 20 ms) — ตัดแล้วไม่มีเสียงคลิก · **Edit > Zero Crossings**: Adjust Selection Inward / Outward (Shift+I / Shift+O) และปรับทีละด้าน Left/Right Side to Left/Right (Shift+H / J / K / L) เหมือน Audition
- **Scrub**: ลาก playhead ในไม้บรรทัด (ตอนหยุดเล่น) แล้วได้ยินเสียงตรงนั้น ความเร็ว/ทิศทางตามการลาก (ลากถอยหลัง = เสียงถอยหลัง) — ใช้ได้ทั้ง Waveform และ Multitrack (มัลติแทร็กใช้มิกซ์ของเซสชันที่เรนเดอร์แคชไว้ เรนเดอร์ใหม่เมื่อเซสชันเปลี่ยน)
- **Shuttle J / K / L**: L เล่นไปข้างหน้า, J เล่นถอยหลัง, กดซ้ำ = เร็วขึ้น 1× → 2× → 4× → 8×, K หยุด, กด K ค้างแล้ว J/L = ครึ่งความเร็ว — ทั้ง Waveform และ Multitrack · **Loop playback ย้ายจาก L เป็น Ctrl+L** (ตาม Audition เพื่อให้ L เป็น shuttle)
- **Transport > Skip Selection**: เปิดแล้วกด Play จะเริ่มก่อน selection (pre-roll) แล้วกระโดดข้าม selection ไปเล่นต่อจนจบ · **Preview Edit** (Ctrl+Shift+Space): เล่น pre-roll ก่อน selection แล้วต่อด้วย post-roll หลัง selection ทันที = ได้ยินผลของการตัดก่อนตัดจริง (ตั้ง pre/post-roll ที่ Transport > Pre-roll / Post-roll…)
- **Range markers**: กด M ตอนมี selection = marker แบบช่วง (แสดงเป็นแถบในไม้บรรทัด) · เพิ่ม/ลบ/เปลี่ยนชื่อ marker เป็น Undo ได้แล้ว · ส่งออก/นำเข้า WAV เก็บความยาวช่วงไว้ด้วย (`ltxt` ใน cue list)
- **Playlist** (Window > Playlist หรือปุ่มในแผง Markers): เรียงลำดับ range markers, จำนวนรอบ (Loops) ต่อรายการ, เล่นต่อกันแบบไม่มีช่องว่าง (ตรงระดับแซมเปิล) — Undo ได้
- **Export Range Markers…** (Edit menu / ปุ่มในแผง Markers): ทุก range marker เป็นไฟล์แยก เลือกฟอร์แมต และตั้งชื่อด้วย template `{file}` `{marker}` `{n}` — แอปเดสก์ท็อปถามโฟลเดอร์ครั้งเดียวแล้วเขียนทุกไฟล์ลงไป (เขียนได้เฉพาะในโฟลเดอร์ที่ผู้ใช้เลือก), เบราว์เซอร์ดาวน์โหลดทีละไฟล์

**Favorites, คีย์ลัด และ Batch Process**
- **Favorites** (เมนู Favorites + Window > Favorites): ลำดับเอฟเฟกต์พร้อมพารามิเตอร์ (และ Convert to Mono/Stereo, Trim Silence) กดครั้งเดียวใช้กับ selection / ทั้งไฟล์ / คลิปที่เลือกในมัลติแทร็ก — เป็น Undo 1 ขั้น และ Repeat Last Effect ทำซ้ำ favorite ได้ · สร้างได้ 2 แบบ: **● Start Recording Favorite** แล้วใช้เอฟเฟกต์ตามปกติ (บันทึกค่าที่ตั้งในหน้าต่างจริง) แล้ว Stop, หรือ **Save Last Effect as Favorite** · มี favorite ในตัว 6 ชุด (Normalize −3 dB, Fade In/Out S-curve, Podcast Voice, Broadcast −23 LUFS, Mono + Normalize) · เก็บเฉพาะพารามิเตอร์ที่ต่างจากค่าเริ่มต้น จำไว้ข้ามการเปิดแอป
- **Edit > Keyboard Shortcuts…** (Alt+K): แก้คีย์ลัดของทุกคำสั่งในเมนู (รวม favorite และแผงใน Window) — คลิกช่องคีย์แล้วกดคีย์ใหม่ (Backspace = ไม่มีคีย์, Esc = ยกเลิก), ↺ กลับค่าเดิม, ค้นหา, **เตือนคีย์ชน** (แดง + รายการ) · พรีเซ็ต **AudioStage** / **Adobe Audition** (คีย์ของ Audition สำหรับคำสั่งที่ AudioStage มี เช่น Redo Ctrl+Shift+Z, Zoom =/−/\, Split Ctrl+K, Snap S, Spectral Shift+D, Metronome Shift+C) — การแก้ของผู้ใช้ทับบนพรีเซ็ต มีผลทันทีโดยไม่ต้องเปิดแอปใหม่
- **File > Batch Process…**: เลือกเอฟเฟกต์เดียวหรือ **favorite หลายขั้น** ใช้กับทุกไฟล์ที่เปิด แล้วส่งออกด้วยชื่อแบบ template `{name}` `{n}` `{nn}` `{fav}` `{date}` — แอปเดสก์ท็อปเลือกโฟลเดอร์ครั้งเดียวแล้วเขียนทุกไฟล์ · ยกเลิกได้กลางทาง · ทุกไฟล์ Undo ได้

**Metering, Loudness และ Diagnostics**
- **True Peak (dBTP)** แบบ ITU-R BS.1770-4: oversampling 4× ด้วย windowed-sinc 4 เฟส (แบนราบ ±0.001 dB ถึง 0.4 fs) — ใช้ใน Loudness Meter, Amplitude Statistics, Match Loudness, Loudness Normalize (เพดานเป็น dBTP จริง) และ **Hard Limiter > True Peak limiting** (คำนวณ gain จากสัญญาณที่ oversample แล้ว จึงไม่มี inter-sample peak เกินเพดาน)
- **Loudness Meter** (Analyze > Loudness Meter หรือ Window): วัดสิ่งที่ได้ยินจริง (master output, ต่อ tap บน audio thread ไม่มีช่องว่าง) — Momentary 400 ms, Short-term 3 s, Integrated (gated), **LRA** (EBU Tech 3342), True Peak สูงสุด, **PLR**, ค่าสูงสุดของ M/S, เลือกเป้า (EBU −23 / ATSC −24 / Podcast −16 / Streaming −14) แสดงส่วนต่าง, ปุ่ม Reset
- **Amplitude Statistics** เพิ่มแถว True peak ต่อช่อง/รวม, LRA, Max momentary/short-term และ PLR · **Match Loudness** แสดง LUFS + dBTP และเลือกเพดาน true peak ได้
- **Phase Meter** (Analyze > Phase Meter & Vectorscope): correlation รวม + แยก 3 ย่าน (< 250 Hz / กลาง / > 4 kHz) และ **Vectorscope (goniometer)** — M ตั้ง, S นอน
- **Diagnostics** (Analyze > Diagnostics): เลือก DeClicker / DeClipper / Delete Silence / Mark Audio → **Scan** (selection หรือทั้งไฟล์) → รายการจุดที่เจอ (เวลา, ความยาว, ช่อง) คลิกเพื่อไปที่จุดนั้น → **Repair / Delete / Mark** ทีละจุด หรือ **… All** — ทุกครั้งเป็น Undo 1 ขั้น และสแกนใหม่ให้อัตโนมัติ (ใช้ตัวตรวจจับเดียวกับเอฟเฟกต์ DeClicker/DeClipper/Delete Silence เดิม)
- **แก้บั๊กเดิม 2 จุดที่เจอระหว่างทำ**: (1) K-weighting ของการวัด LUFS เดิมใช้สูตร shelf ทั่วไป (RBJ) ทำให้อ่านต่ำไป ~0.25 dB ที่ 1 kHz — ตอนนี้ใช้ค่าสัมประสิทธิ์ตามมาตรฐาน BS.1770 (ตรงกับค่าที่ตีพิมพ์ที่ 48 kHz) ทั้งใน Loudness Normalize, Match Loudness, Amplitude Statistics และ Loudness Meter ใน rack (2) DeClicker เดิมมองช่วง ~6 ms แรกของทุกไฟล์เป็นคลิก (เทียบกับค่าเฉลี่ยที่แทบว่าง) แล้วลากเส้นตรงทับเสียงจริงตรงนั้น

**5.1 Surround, CD Layout, Interchange และ Media Browser**
- **Multitrack > Master Channels > 5.1 Surround**: master 6 ช่อง (L R C LFE Ls Rs) · ทุกแทร็ก/bus ที่ออก Master มี **surround panner** (แผ่นวงกลมใน Mixer — ลากจุด, ดับเบิลคลิก = หน้ากลาง; หรือ Multitrack > Track Surround Panner… ตั้ง ซ้าย-ขวา / หน้า-หลัง / stereo spread / **LFE send** ที่ผ่าน low-pass 120 Hz) ใช้ pairwise constant-power panning ตามมุมลำโพง ITU-R BS.775 · มิกซ์ดาวน์และ Export ได้ **WAV 6 ช่อง** (WAVE_FORMAT_EXTENSIBLE + speaker mask 5.1) · เล่นสด: ถ้าอุปกรณ์มี 6 ช่องจะส่ง 6 ช่องจริง ถ้าไม่มี Web Audio พับลงสเตอริโอตามสูตรมาตรฐาน · เก็บในเซสชันและ Undo ได้ · **ข้อจำกัด**: ใน 5.1 เอฟเฟกต์ของ Master bus ถูกข้าม (rack ออกแบบสำหรับสเตอริโอ), send ไป bus ยังเป็นสเตอริโอ, ตำแหน่ง surround ยังทำ automation ไม่ได้, ส่งออก 5.1 เป็น WAV เท่านั้น (ตัวเข้ารหัส MP3/AAC/Opus ที่มีเป็นสเตอริโอ)
- **CD Layout** (File > CD Layout… หรือ Window): เพิ่มเพลงจากไฟล์ที่เปิด, เรียงลำดับ, gap ต่อเพลง, ชื่อเพลง/ศิลปิน (CD-Text ใน CUE), ชื่ออัลบั้ม, เวลารวม (เตือนเมื่อเกิน 79:57 หรือเพลงสั้นกว่า 4 วินาที), Undo/Redo · **Export CUE + WAV**: WAV 16-bit 44.1 kHz สเตอริโอ ไฟล์เดียว (แปลง sample rate/ช่องให้, dither) ทุกเพลงเริ่มตรง CD frame (1/75 s) และ gap เป็น pre-gap (INDEX 00 → 01) — เปิดเผาแผ่นด้วยโปรแกรมใดก็ได้ที่อ่าน CUE (การเผาแผ่นไม่ได้ทำในแอป)
- **FCP XML (Final Cut Pro 7 xmeml)**: File > Export Session as FCP XML… เขียน XML + ไฟล์เสียงของทุกคลิป (WAV 24-bit) ลงโฟลเดอร์ — เปิดได้ใน Premiere Pro, DaVinci Resolve และ Adobe Audition · File > Import FCP XML Session… สร้างเซสชันใหม่จาก XML (หาไฟล์เสียงจาก path ใน XML → ข้างไฟล์ XML → ให้ผู้ใช้เลือก) · ข้อมูลที่ส่ง: แทร็ก, คลิป, ตำแหน่ง, in-point ของต้นฉบับ, gain (clip gain × track volume เป็น Audio Levels), pan, fade in/out (audio transition) · คลิปที่ยืดเวลา/วนซ้ำถูกเขียนเป็นไฟล์เสียงที่เรนเดอร์แล้ว · **ข้อจำกัด**: เวลาใน xmeml เป็นเฟรม (30 fps) ตำแหน่งจึงปัดเป็น 1/30 วินาที, envelope/เอฟเฟกต์/bus/automation ไม่ถูกส่ง, ไม่ได้ทำ .sesx (ดูหมายเหตุใน roadmap)
- **Media Browser** (แอปเดสก์ท็อป): คลิกไฟล์ = เลือก + พรีวิวทันที (**Auto-play**), **Loop**, ปุ่ม ▶ / ■ · ดับเบิลคลิกเปิด · **ลากไฟล์** ไปวางบนเวฟฟอร์ม (เปิดไฟล์) หรือบนเลนมัลติแทร็ก (เป็นคลิปตรงตำแหน่งที่วาง) · พรีวิวออกลำโพงตรง ไม่เข้า mix/meter

**`.asession` รูปแบบ 4** — ZIP (`app/js/sessionzip.js`): `session.json` (มีฟิลด์ `version` และ `migrate()` ใน `app/js/sessionio.js`) + `audio/<n>.wav` · ไฟล์ JSON รูปแบบ 1/2/3 เปิดได้เหมือนเดิม (เติมค่า routing เริ่มต้น และแปลง clip volume envelope แบบ dB เดิมเป็นค่าเชิงเส้น) · ไฟล์จากเวอร์ชันที่ใหม่กว่าจะแจ้งให้อัปเดตแอปแทนการเปิดผิดๆ

**เมนู Window** — เปิด/ปิด (มีเครื่องหมายถูก) หรือดึง focus ไปยังแผง: Editor, Multitrack, CD Layout, Diagnostics, Effects, Effects Rack, Essential Sound, Favorites, Files, History, Level Meters, Loudness Meter, Markers, Match Loudness, Media Browser*, Metadata, Mixer, Phase Meter, Playlist, Properties, Selection/View, Spectrum Analyzer, Video, Status Bar, Time Display, Tools, Transport, Workspace (ชุดเลย์เอาต์ — ดูหัวข้อ Workspaces) และ Reset to Default Layout (เลย์เอาต์จำไว้ข้ามการเปิดแอป) — *Media Browser ใช้ได้ในแอปเดสก์ท็อป

**เมนูและ submenu** ทุกเมนูคำนวณตำแหน่งตามขอบหน้าจอ (พลิกซ้าย/เลื่อนขึ้น) และเลื่อนด้วยลูกกลิ้งได้เมื่อรายการยาวเกินจอ

## ปลั๊กอิน VST3 / AU แบบ offline (เฉพาะแอปเดสก์ท็อป)

เมนู **Effects > VST3 / AU Plugin (offline)…** (หรือปุ่มในแผง Effects) ประมวลผลช่วงที่เลือก / ทั้งไฟล์ / คลิปที่เลือกในมัลติแทร็ก ผ่านปลั๊กอินเอฟเฟกต์ที่ติดตั้งไว้ แล้ว Undo ได้เหมือนการแก้ไขอื่น

**ติดตั้งครั้งแรกในแอปที่ติดตั้งจาก .exe (ไม่ต้องใช้ npm / Python):** เมนู **Effects > Install VST Support…** (หรือกดปุ่มในหน้าต่าง "VST support is not installed yet" ที่ขึ้นเมื่อเปิดปลั๊กอินครั้งแรก) — แอปดาวน์โหลด Python embeddable package จาก python.org (ตรวจ SHA-256 ที่ปักไว้ในโค้ด) ลงใน `%APPDATA%\AudioStage\vst-runtime\python`, เปิด site-packages ผ่านไฟล์ `._pth`, ติดตั้ง pip (wheel ตรวจ SHA-256) แล้ว `pip install -r tools/vst/requirements.txt` (pedalboard + numpy แบบ wheel สำเร็จรูป) — มีแถบความคืบหน้า, ปุ่ม Cancel (ยกเลิกแล้วไม่เหลือไฟล์ค้าง และไม่แตะของเดิมที่ใช้งานได้), ข้อความผิดพลาดที่อ่านเข้าใจ (ไม่มีอินเทอร์เน็ต, checksum ไม่ตรง, ดิสก์เต็ม…), ปุ่ม **Repair / Reinstall** และ **Remove** · ใช้ได้ทันทีโดยไม่ต้องรีสตาร์ต · ดาวน์โหลดราว 40 MB ครั้งเดียว · งานทั้งหมดทำใน main process

ลำดับการหา Python ของโฮสต์ปลั๊กอิน: `AUDIOSTAGE_PYTHON` → runtime ที่แอปติดตั้งใน userData → `tools/vst/.venv` (นักพัฒนา) → Python ของระบบ · ดูสถานะได้ที่ **Help > Check VST / ffmpeg Status…** · ระบบอื่นที่ไม่ใช่ Windows 64-bit: แอปบอกให้ `python3 -m pip install pedalboard numpy` แทน

สำหรับนักพัฒนา (`npm start`) ใช้วิธีเดิมได้ (ต้องมี Python 3.10+):

```
npm run setup:vst      # สร้าง tools/vst/.venv และติดตั้ง pedalboard + numpy
npm start
```

**Plugin Manager…** (Effects > Plugin Manager… หรือปุ่มในหน้าต่างปลั๊กอิน) — แสดงโฟลเดอร์ VST3 มาตรฐาน + โฟลเดอร์ที่เพิ่มเอง (จำไว้, ลบได้), ปุ่ม **Scan** (ลองโหลดปลั๊กอินใหม่/ที่เปลี่ยนไป) และ **Rescan All** — ทุกตัวถูกโหลดทีละตัวในโพรเซสแยก ผลลัพธ์ ✓ OK / ✗ Cannot load (พร้อมเหตุผล) / ✖ Crashed จำไว้ใน `vst-scan.json` · ตัวที่ทำโฮสต์แครช (รวมถึงตัวที่กำลังโหลดตอนแอปปิดไปกะทันหัน) จะถูกข้ามในการสแกนครั้งต่อไปและซ่อนจากรายการปลั๊กอิน จนกว่าจะกด **Retry**

**ใช้ใน Favorites / Batch:** แอปจำปลั๊กอินตัวล่าสุดและค่าพารามิเตอร์ของแต่ละปลั๊กอิน · ปุ่ม **Save as Favorite…** ในหน้าต่างปลั๊กอินบันทึกปลั๊กอิน + state ปัจจุบัน + ความยาวหางเสียง เป็น Favorite (ขั้นตอนชนิด `vst`) ใช้กดครั้งเดียวหรือรันกับหลายไฟล์ใน File > Batch Process ได้ และการ Apply ปลั๊กอินระหว่าง "Start Recording Favorite" ก็ถูกบันทึกด้วย

- สแกนโฟลเดอร์มาตรฐานของระบบ + เพิ่มโฟลเดอร์/เลือกไฟล์เองได้ · พารามิเตอร์ทั้งหมดเป็นสไลเดอร์และแสดงค่าตามที่ปลั๊กอินรายงาน · เปิดหน้าต่างปลั๊กอินเนทีฟได้ · เก็บ/เรียกพรีเซ็ต (state ของปลั๊กอิน) · พรีวิวเสียง 8 วินาทีก่อน Apply · เลือกความยาวหางเสียง (reverb/delay) ได้ · ชดเชย latency ของปลั๊กอินอัตโนมัติ
- ปลั๊กอินรันใน **โพรเซสแยก** (`tools/vst/vst_host.py`) — ปลั๊กอินที่แครชจะไม่ทำให้แอปล่ม แอปแจ้งข้อผิดพลาดและเริ่มโฮสต์ใหม่ให้เอง
- **ไลบรารีที่รวมในแอป**: lamejs (LGPL-3.0, ไฟล์ `app/vendor/lame.min.js` ไม่ได้แก้ไข) · electron-updater 6.3.9 (MIT) และ dependency ของมัน builder-util-runtime, fs-extra, js-yaml, lazy-val, lodash.escaperegexp, lodash.isequal, tiny-typed-emitter (MIT), semver (ISC) · Electron (MIT) · DeReverb, Text to Speech และตัวเขียน/อ่านแท็กเขียนเองในโปรเจกต์ (ไม่มีไลบรารีใหม่)
- ใช้ไลบรารี [pedalboard](https://github.com/spotify/pedalboard) (JUCE) ซึ่งเป็นสัญญาอนุญาต **GPLv3** และถูกดาวน์โหลดจาก PyPI มาติดตั้งบนเครื่องผู้ใช้ (ผ่าน Install VST Support… หรือ npm run setup:vst) ไม่ได้รวมอยู่ในโค้ดหรือไฟล์ติดตั้งของโปรเจกต์นี้ · Python embeddable package เป็นสัญญาอนุญาต PSF · `tools/vst/vst_host.py` ถูกแตกไว้นอก app.asar (`resources/app.asar.unpacked/tools/vst/`) เพื่อให้ Python รันได้
- ทดสอบจริงกับปลั๊กอิน VST3 หนึ่งตัวบน Windows (Dragonfly Hall Reverb): `set VST3_TEST_PLUGIN=<path>.vst3` แล้ว `npm run test:vst` · macOS (AU/VST3) และ Linux โค้ดรองรับตามที่ pedalboard รองรับ แต่ยังไม่ได้ทดสอบ
- ข้อจำกัด: เป็นการประมวลผลแบบ offline เท่านั้น — **ยังไม่มีการเสียบปลั๊กอินแบบเรียลไทม์ใน rack ของแทร็ก**, ปลั๊กอินที่เป็น instrument (synth) ไม่รองรับ, ไม่มี automation ของพารามิเตอร์ปลั๊กอิน

## ทำไม่ได้ในสถาปัตยกรรมนี้

- **ปลั๊กอินแบบเรียลไทม์ใน rack / ASIO / sidechain** ของปลั๊กอินภายนอก — ต้องมีโมดูล native ที่เชื่อมเธรดเสียงเรียลไทม์เข้า Web Audio
- **ASIO โดยตรง** — Chromium/Electron เปิดไดรเวอร์ ASIO ไม่ได้ และ ASIO SDK ต้องมีสัญญาอนุญาตของ Steinberg; ให้ใช้ผ่านอุปกรณ์ระบบ (ASIO4ALL หรือโหมด WASAPI ของอินเทอร์เฟซ) ที่ Audio Hardware Setup

## โครงสร้าง

```
main.js / server.js         Electron entry / static server
app/index.html, styles.css
app/js/dsp.js               DSP ล้วน (FFT, biquad, WSOLA, reverb, limiter, NR, LUFS…) ทดสอบใน Node ได้
app/js/effects.js           registry ของ effects/generators (พารามิเตอร์ → UI อัตโนมัติ)
app/js/wav.js               WAV encode/decode
app/js/engine.js            AudioContext, เล่น/อัด/มิเตอร์, Doc (undo แบบ immutable snapshot)
app/js/waveview.js          Waveform/Spectral canvas + ruler + selection
app/js/multitrack.js        Session, graph builder (live + offline render), MultiView
app/js/routing.js           Bus / output / sends / sidechain: ตัวเลือก, กันลูป, solo (ทดสอบใน Node)
app/js/tempo.js             Tempo map: bars:beats, เส้นกริด, snap, ตำแหน่งคลิกเมโทรนอม (ทดสอบใน Node)
app/js/metronome.js         เมโทรนอม (oscillator, lookahead scheduler, count-in)
app/js/clipstretch.js       Clip time-stretch / pitch แบบไม่ทำลาย: แคชเสียงที่เรนเดอร์ใน worker, ปรับสัดส่วน, match tempo
app/js/recording.js         คณิตของการอัด: latency, punch, loop → takes, comp + crossfade, วัด latency (ทดสอบใน Node)
app/js/sessionio.js         อ่าน/เขียน .asession พร้อม version + migrate
app/js/sessionzip.js        .asession รูปแบบ 4: ZIP เขียน/อ่านเป็นชิ้น (ZIP64, CRC)
app/js/disk.js              Save dialog, เขียนไฟล์เป็นชิ้นแบบ atomic, อ่านไฟล์เป็นชิ้น (แอปเดสก์ท็อป)
app/js/recspool.js          สำรองเสียงที่กำลังอัดลงดิสก์ + กู้คืน
electron/savefile.js        เขียนไฟล์ชั่วคราว → fsync → rename, ชื่อไม่ซ้ำ " (2)"
app/js/videotrack.js        แถววิดีโอในมัลติแทร็ก: thumbnail, ลิงก์ไฟล์
electron/video.js           หา ffmpeg, probe, mux เสียงกลับเข้าวิดีโอ (ทดสอบใน Node)
app/js/store.js             ที่เก็บข้อมูลในเครื่อง (ดิสก์ผ่าน preload / IndexedDB / หน่วยความจำสำหรับเทสต์)
app/js/autosave.js          autosave, กู้คืนหลังแครช, project versions, เก็บกวาดไฟล์เสียงที่ไม่ใช้
app/js/envelope.js          Clip Volume/Pan envelopes (ข้อมูล, interpolation, scheduling)
app/js/wavescale.js         วาดคลื่นในคลิปตามความดังจริง (Dynamic Waveform Scaling)
app/js/fxmenu.js            แหล่งเดียวของชื่อ/หมวดเอฟเฟกต์: เมนู Effects, แผง Effects, ตัวเลือกสล็อตใน rack, ตัวเลขในหน้า About
app/js/rack.js              เอนจิน Effects rack (Web Audio): 19 เอฟเฟกต์, สล็อต 1–16, Input/Output/Dry-Wet, automation
app/js/rackpresets.js       พรีเซ็ตในตัว 38 ชุด
app/js/worklet.js           AudioWorklet: Noise Gate (มี key input), sidechain dynamics (as-dyn), recorder (as-rec), pitch, denoise, dereverb, loudness
app/js/rackpanel.js         แผง Effects Rack (แท็บ Clip/Track, พรีเซ็ต, สล็อต, VU, Power)
app/js/panels.js            ระบบแผง (แสดง/ซ่อน/ดึง focus, จำเลย์เอาต์) + โมเดลเมนู Window
app/js/workspaces.js        Window > Workspace: เลย์เอาต์สำเร็จรูป 5 ชุด + ของผู้ใช้ (บันทึก/สลับ/เปลี่ยนชื่อ/ลบ/Reset)
app/js/panels-ui.js         แผงอื่นๆ: Mixer, History, Properties, Metadata, Match Loudness, Media Browser, …
app/js/flac.js, vendor/     ตัวเข้ารหัส FLAC / MP3 (lamejs)
app/js/webenc.js            Opus / AAC / M4A ผ่าน WebCodecs
app/js/jobs.js, worker.js   งานเบื้องหลัง (fx, spectral, encode) + cancel
app/js/vst.js               UI โฮสต์ปลั๊กอิน VST3/AU (offline)
app/js/ui.js, app.js        dialog/menu/toast และตัวควบคุมหลัก
electron/                   preload, ตัวจัดการโพรเซสโฮสต์ปลั๊กอิน + Plugin Manager scan (vst-host.js),
                            ติดตั้ง/ลบ runtime ของ VST และ ffmpeg ใน userData (runtimes.js: ดาวน์โหลด, SHA-256, unzip)
app/js/prefs.js, recent.js  Preferences (ทะเบียนค่าทั้งหมด) และ Recent Files
app/js/welcome.js, tips.js  หน้าต้อนรับ และ tooltip ของพารามิเตอร์เอฟเฟกต์
app/help/                   คู่มือออฟไลน์ (สร้างจาก README ด้วย tools/make-help.js)
electron/recent.js, openfiles.js, logs.js  รายการ recent, ไฟล์ที่ Windows ส่งมาเปิด, log files
tools/make-ico.js           สร้าง build/asession.ico จาก build/icon.png
app/js/tags.js              แท็ก/เมทาดาทา: ID3v2.4, Vorbis comments + PICTURE, OpusTags, MP4 ilst, WAV INFO (เขียน + อ่าน)
app/js/speech.js, electron/tts.js   Generate > Speech… (เสียงของ Windows ผ่าน PowerShell, ออฟไลน์)
app/js/updates.js, electron/updater.js   Help > Check for Updates… (ปิด/ซ่อนเมื่อไม่มีแหล่งอัปเดต — อัปเดตผ่าน BYS All Stages Launcher)
app/js/runtimes.js          หน้าต่าง Install VST Support… / Install ffmpeg… / Check VST / ffmpeg Status…
tools/vst/                  vst_host.py (pedalboard) + สคริปต์ติดตั้ง
tests/run-all.js            ตัวรันของ npm test (รันทุก *.test.js ยกเว้น vst_host ที่ต้องใช้ Python: npm run test:vst)
tests/_sandbox.js           โหลดสคริปต์ใน app/js เข้า Node (vm) สำหรับเทสต์
tests/*.test.js             dsp, envelope, wavescale, menu, routing, … · vst_host.test.js
tests/app.test.js, app/     เปิดแอป Electron จริงแบบซ่อนหน้าต่าง (main.js โหมด AUDIOSTAGE_SELFTEST) แล้วรัน tests/app/*.scenario.js:
                            Web Audio จริง (live + offline), DOM จริง, ห้ามมี error ใน console · ถ่ายภาพหน้าจอได้ด้วย AUDIOSTAGE_SELFTEST_SHOTS=<โฟลเดอร์>
```

การเพิ่ม effect ใหม่: เพิ่มอ็อบเจ็กต์ใน `FX` ของ `effects.js` (`params` + `process`) แล้วจะขึ้นในเมนู, แผง Effects และไดอะล็อกพรีวิวเอง

