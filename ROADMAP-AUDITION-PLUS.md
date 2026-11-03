# AudioStage → ดีกว่า Adobe Audition : แผนงานสำหรับ Claude Code

> **วิธีใช้:** เปิด Claude Code ในโฟลเดอร์ `AudioStage` แล้วพิมพ์
> `อ่าน ROADMAP-AUDITION-PLUS.md ให้ครบ แล้วทำเฟส 0 ต่อด้วยเฟส 1 ตามลำดับ ทำเสร็จแต่ละข้อให้รันเทสต์และติ๊ก [x] ในไฟล์นี้`
> ทำต่อทีละเฟส (เฟส 2, 3, …) ในรอบถัดไป เพื่อไม่ให้งานใหญ่เกินไปในรอบเดียว

---

## กฎที่ต้องทำตามทุกข้อ (อ่านก่อนเริ่ม)

1. **ฟรี 100%** — ใช้เฉพาะไลบรารี/โมเดลโอเพนซอร์สที่ใช้ฟรีได้ (MIT, Apache-2.0, BSD, MPL, ISC, Zlib) ห้ามใช้บริการคลาวด์ที่เสียเงิน ห้ามใช้ API key ห้ามส่งเสียงของผู้ใช้ออกนอกเครื่อง ทุกอย่างต้องทำงาน **ออฟไลน์** ได้
   - ถ้าจำเป็นต้องใช้ของที่เป็น GPL/AGPL (เช่น pedalboard, JUCE) ให้ติดตั้งแยกบนเครื่องผู้ใช้แบบที่ทำกับ pedalboard อยู่แล้ว (ไม่รวมในโค้ดโปรเจกต์) และเขียนหมายเหตุสัญญาอนุญาตไว้ใน README
   - โมเดล AI ขนาดใหญ่ ให้ **ดาวน์โหลดตอนผู้ใช้กดใช้ครั้งแรก** (มีแถบความคืบหน้า + ยกเลิกได้ + เก็บใน userData) ไม่ยัดลงตัวติดตั้ง
2. **รักษาสถาปัตยกรรมเดิม** — vanilla JS, namespace `AS.*`, ไฟล์แบบ IIFE, ไม่มี bundler/framework ใหม่ DSP ล้วนอยู่ใน `dsp.js` (ทดสอบใน Node ได้), เอฟเฟกต์เรียลไทม์ลงทะเบียนด้วย `def()` ใน `rack.js`/`rack2.js`, เอฟเฟกต์ offline อยู่ใน `effects.js`, เมนูเอฟเฟกต์อยู่ที่ `fxmenu.js`, งานหนักให้รันผ่าน `jobs.js`/`worker.js` ไม่ให้ UI ค้าง
3. **Undo/Redo ต้องครอบคลุมทุกฟีเจอร์ใหม่** ทั้งใน Waveform (`Doc`) และ Multitrack (`Session.undoStack`)
4. **ไฟล์ `.asession` ต้องเข้ากันได้ย้อนหลัง** — เพิ่มฟิลด์ `version` และฟังก์ชัน migrate; เซสชันเก่าเปิดได้เหมือนเดิม
5. **ทุกฟีเจอร์ต้องมีเทสต์** ใน `tests/` (โดยเฉพาะ DSP/การเรนเดอร์ offline) และ `npm test` ต้องผ่านทั้งหมดก่อนไปข้อถัดไป
6. การเล่นสด (live) กับการเรนเดอร์/มิกซ์ดาวน์ (offline) **ต้องได้เสียงตรงกัน** — ใช้ graph builder ตัวเดียวกันใน `multitrack.js` อย่างที่ทำอยู่
7. UI ใช้ภาษาอังกฤษแบบ Audition (ชื่อเมนู/คำศัพท์ให้ตรงกับ Audition เท่าที่ทำได้) และรองรับธีมมืด/สว่างที่มีอยู่
8. อัปเดต `README.md` (ภาษาไทย) ทุกครั้งที่เพิ่มฟีเจอร์ และติ๊ก `[x]` ในไฟล์นี้
9. ถ้าข้อไหนทำไม่ได้จริงในสถาปัตยกรรม Electron/Web Audio ให้เขียนเหตุผลไว้ใต้ข้อนั้นแล้วไปข้อถัดไป **ห้ามทำปุ่มหลอกที่ไม่ทำงาน**

---

## เฟส 0 — แก้จุดเล็กที่เจอจากการตรวจโค้ด

- [x] หน้า About (`app.js` ~บรรทัด 778) ข้อความยังเขียนว่า "40+ effects · WAV import/export (other formats via system decoder)" → แก้ให้ตรงปัจจุบัน (จำนวนเอฟเฟกต์ให้นับจาก registry อัตโนมัติ, ระบุฟอร์แมตส่งออก WAV/FLAC/MP3/Opus/AAC/M4A)
  - นับจาก `AS.fxmenu.counts()` (rack / offline / generators) และรายชื่อฟอร์แมตดึงจากตาราง `FORMATS` · เทสต์: `tests/menu.test.js`
- [x] ตรวจว่าเมนู Effects ใน `app.js` กับ `fxmenu.js` ไม่ซ้ำ/ขัดกัน ให้ `fxmenu.js` เป็นแหล่งเดียว
  - เมนูกับแผง Effects ใช้ `fxmenu.js` อยู่แล้ว; ที่ขัดกันคือดรอปดาวน์สล็อตใน Effects Rack ที่จัดกลุ่มเองจาก `R.RACK` → เปลี่ยนให้ใช้ `fxmenu.rackGroups()` · ลบ action ค้าง `mt.applyfx` · เทสต์ตรวจว่าทุกรายการชี้ไปเอฟเฟกต์ที่มีจริง ไม่มี id/ชื่อซ้ำ
- [x] ตรวจตัวเลขจำนวนเทสต์ใน README ให้ตรงกับที่รันจริง
  - `npm test` → `tests/run-all.js` รันทุกไฟล์และพิมพ์ยอดรวม (README อัปเดตตามยอดนั้นทุกครั้ง)

**สรุปเฟส 0** — About นับเอฟเฟกต์จาก registry และระบุฟอร์แมตส่งออกจากตาราง `FORMATS` · `fxmenu.js` เป็นแหล่งเดียวของชื่อ/หมวดเอฟเฟกต์ (รวมดรอปดาวน์สล็อตใน rack) · `npm test` รันทุกไฟล์และพิมพ์ยอดรวม · เพิ่ม harness ทดสอบในแอปจริง (`tests/app.test.js`: เปิด Electron แบบซ่อนหน้าต่าง, รันสถานการณ์ใน renderer, ห้ามมี error ใน console) ซึ่งใช้ตลอดเฟส 1 · ไม่มีไลบรารีใหม่

---

## เฟส 1 — Multitrack ให้ใช้งานจริงได้เท่า Audition (สำคัญที่สุด)

### 1.1 Bus tracks, Sends และ Sidechain
ปัจจุบัน graph ใน `multitrack.js` (~บรรทัด 85–95) ต่อทุกแทร็ก → pan → `masterIn` → master rack เท่านั้น
- [x] ชนิดแทร็กใหม่ `type: 'bus'` (ไม่มีคลิป มี rack, volume, pan, mute/solo, automation เหมือนแทร็กเสียง) — ปุ่ม "+ Bus"
- [x] **Output routing** ต่อแทร็ก: Master หรือ Bus ใดก็ได้ (ป้องกัน routing วนลูป)
- [x] **Sends** ต่อแทร็ก สูงสุด 16 ช่อง: ปลายทาง (bus), ระดับ dB, pan, **Pre-fader / Post-fader**, automation ได้
  - ใน Mixer: แถว send มี ปลายทาง / ระดับ / PRE-POST / × / pan; automation ของระดับและ pan อยู่ใน *Track automation*
- [x] **Sidechain**: Compressor/Dynamics/Noise Gate/Auto-Duck ใน rack เลือกแหล่ง key input จากแทร็ก/bus อื่นได้
  - `DynamicsCompressorNode` ไม่มี key input → เมื่อเลือก key ใช้ AudioWorklet `as-dyn` (อัลกอริทึม `dsp.createDynamics`); Auto-Duck เป็นเอฟเฟกต์ rack ใหม่ "Auto-Duck (Sidechain)" (คำสั่ง Auto-Duck แบบ automation เดิมยังอยู่)
- [x] Mixer panel (`panels-ui.js`) แสดง bus strip, send knob, output selector
- [x] เรนเดอร์ offline ตรงกับ live, มีเทสต์ routing + ป้องกันลูป
  - `tests/routing.test.js` (Node) + `tests/app/10-routing.scenario.js` (แอปจริง: อัดเสียงการเล่นสดด้วย worklet recorder `as-rec` เทียบกับ mixdown) · `.asession` เป็นเวอร์ชัน 3 พร้อม migrate (`sessionio.js`)

### 1.2 Crossfade อัตโนมัติ
- [x] ลากคลิปทับกันบนแทร็กเดียว → สร้าง crossfade ในส่วนที่ทับอัตโนมัติ (ตั้งค่าได้: เปิด/ปิด, โค้ง Linear/Cosine/Log/Exp, symmetric/asymmetric)
  - เก็บเป็น `xfi`/`xfo` แยกจาก fade ของผู้ใช้ · เมนู Multitrack > Crossfades · เซสชันเก่าเปิดโดยปิดไว้ (เสียงเหมือนเดิม)
- [x] แสดงเป็นรูป X บนคลิป ลากปรับความยาวได้
- [x] นโยบายการทับ: Overlap (crossfade) / Overwrite / Insert-ripple
  - เมนู Multitrack > Overlapping Clips · เทสต์: `tests/crossfade.test.js`, `tests/app/20-crossfade.scenario.js` (เสียงจริง: ระดับคงที่ในช่วง crossfade, ลาก X ด้วยเมาส์)

### 1.3 Tempo, Grid และ Metronome
ปัจจุบัน Bars & Beats ล็อก 120 BPM ไว้ใน `app.js` ~บรรทัด 768 (`sec * 2`)
- [x] ตั้ง **BPM, time signature, offset** ต่อเซสชัน/ไฟล์ (เก็บใน `.asession`)
  - Edit > Tempo and Time Signature… · เซสชัน: `settings.tempo` ใน `.asession` · ไฟล์: `Doc.tempo` (Undo ได้, ติดไปกับคลิปตอนแทรกเข้ามัลติแทร็ก) — WAV ไม่มีช่องมาตรฐานสำหรับ tempo จึงไม่ได้เขียนลงไฟล์ WAV
- [x] ไม้บรรทัด Bars:Beats จริง + **snap to grid** (bar/beat/1/8/1/16) เพิ่มจาก snap เดิม
- [x] **Metronome** (คลิกด้วย oscillator, เลือกเสียง, ระดับเสียง, count-in 1–2 bar, เล่นเฉพาะตอนอัดได้)
  - `metronome.js` · ไม่รวมใน mixdown (เป็นเสียงมอนิเตอร์ เหมือน Audition)
- [x] ตรวจจับ BPM อัตโนมัติจากไฟล์ (onset + autocorrelation ใน `dsp.js`)
  - `dsp.detectTempo` คืน BPM + ตำแหน่งจังหวะ + ค่าทางเลือกครึ่ง/สองเท่า · เทสต์: `tests/tempo.test.js`, `tests/app/30-tempo.scenario.js`

### 1.4 Recording ระดับมืออาชีพ
- [x] **Punch-in / Punch-out** ตามช่วง selection (pre-roll / post-roll ตั้งได้)
  - เพิ่มการเลือกช่วงเวลาในมัลติแทร็ก (ลากบนพื้นที่ว่าง) · Transport > Punch In/Out · หยุดเองด้วย timer ของ audio clock
- [x] **Loop recording → Takes**: อัดซ้ำในช่วง loop เก็บเป็นหลายเทค ซ้อนในคลิปเดียว
  - เพิ่มการเล่นวนช่วงเวลาในมัลติแทร็ก (Loop + ช่วงที่เลือก)
- [x] **Comping**: เลือกส่วนที่ดีที่สุดจากแต่ละเทคมารวมกัน (swipe เลือกช่วง) พร้อม crossfade รอยต่อ
  - คลิกขวาที่คลิป > Comp Takes · crossfade equal-power 10 ms · comp ถูก render เป็นเสียงของคลิป (ทุกฟีเจอร์อื่นใช้ได้ตามปกติ) โดยเก็บ take ทั้งหมดไว้
- [x] ชดเชย latency การอัด (ตั้งค่า manual + ปุ่มวัดอัตโนมัติด้วย loopback click)
  - การอัดย้ายไปใช้ AudioWorklet recorder (`as-rec`) เพื่อให้รู้เวลาแซมเปิลที่แน่นอน — ScriptProcessor เดิมทำ block หาย (ตรวจพบระหว่างทำ 1.1)
- [x] Input monitoring ต่อแทร็ก (เปิด/ปิด) + แสดงเมื่อเกิดการ clip ระหว่างอัด
  - เทสต์: `tests/recording.test.js`, `tests/app/40-recording.scenario.js` (input สังเคราะห์ + DelayNode แทน latency ของอินเทอร์เฟซ) · ส่วนที่ต้องใช้ไมค์/สายจริงยังไม่ได้ทดสอบกับฮาร์ดแวร์จริง

### 1.5 Clip time-stretch ในมัลติแทร็ก
- [x] โหมด stretch: ลากขอบคลิปพร้อมกดปุ่มลัด (เช่น Alt) เพื่อยืด/หดเวลาโดยไม่เปลี่ยน pitch (ใช้ WSOLA ที่มีใน `dsp.js`, เรนเดอร์ล่วงหน้าเป็นแคชใน worker)
  - `clipstretch.js` + `dsp.clipStretch` + job `stretch` ใน `worker.js` · คลิปที่ยังเรนเดอร์ไม่เสร็จจะไม่ถูกเล่น (ไม่มีการเล่นผิดความเร็ว)
- [x] Clip Properties: Stretch %, Pitch shift, โหมด Monophonic/Polyphonic/Varispeed
- [x] "Match to session tempo" ถ้าไฟล์มี BPM
  - ถ้าคลิปยังไม่มี BPM จะตรวจด้วย `dsp.detectTempo` ให้ · เทสต์: `tests/stretch.test.js`, `tests/app/50-stretch.scenario.js`

### 1.6 Autosave และกู้คืนหลังแครช
ปัจจุบันมีแค่เตือนก่อนปิด (`beforeunload` ใน `app.js` ~บรรทัด 870)
- [x] Autosave ทุก N นาที (ตั้งได้) ลงโฟลเดอร์ userData: เซสชัน + ไฟล์ที่ยังไม่ได้บันทึก (เสียงเก็บเป็น WAV/FLAC ชั่วคราว)
  - `store.js` (IPC `store:*` ใน main.js → `<userData>/store`, เบราว์เซอร์ใช้ IndexedDB) + `autosave.js` · WAV 32-bit float
- [x] เปิดแอปหลังแครช → หน้าต่าง "Recover unsaved work" ให้เลือกกู้
  - เทสต์จริงด้วยการเปิดแอป 2 รอบบนโฟลเดอร์ข้อมูลเดียวกัน (`*.after-restart.scenario.js`) — เทสต์นี้เจอบั๊กเดิมของแผง Mixer และแก้แล้ว
- [x] ระบบ **Project versions/snapshots**: บันทึกเวอร์ชันชื่อเองได้ ย้อนกลับได้ (Audition ไม่มี)
  - เทสต์: `tests/autosave.test.js`, `tests/app/60-autosave*.scenario.js`

### 1.7 การจัดการคลิป/แทร็กที่ยังขาด
- [x] **Freeze track** (เรนเดอร์ rack ไว้ ลด CPU) และ **Bounce to New Track** (แทร็ก/ช่วง/คลิปที่เลือก)
  - render ผ่าน graph builder ตัวเดียวกัน (`renderRange` + tap) · เทสต์ในแอป: เสียงตอน freeze ต่างจากตอนประมวลผลสด < −60 dB
- [x] **Group clips**, **Lock in time**, **Ripple delete** (ลบแล้วเลื่อนคลิปถัดไปมาชิด), **Clip color** และ **Track color**
- [x] **Clip loop** (ลากขอบขวาให้คลิปวนซ้ำได้)
- [x] เลือกหลายคลิปด้วยกรอบลาก + ย้าย/ลบพร้อมกัน
  - Ctrl+ลาก (การลากเฉยๆ บนพื้นที่ว่างยังเป็นการเลือกช่วงเวลา) · เทสต์: `tests/clips.test.js`, `tests/app/70-clips.scenario.js`
- [x] **Video track** ในมัลติแทร็ก (thumbnail บนไทม์ไลน์ + พรีวิวซิงก์) ขยายจากพรีวิววิดีโอใน Waveform ที่มีอยู่ และ **Export audio back into video** (mux เสียงใหม่ลง MP4 ด้วย ffmpeg ที่ติดตั้งแยก หรือ muxer ที่เขียนเอง)
  - ใช้ ffmpeg ที่ติดตั้งแยก (`electron/video.js`) — ไม่มี ffmpeg จะแจ้งวิธีติดตั้งแทน · วิดีโอ 1 ไฟล์ต่อเซสชัน (เหมือน Audition) · เทสต์: `tests/video.test.js` (mux จริงด้วย ffmpeg), `tests/app/80-video.scenario.js` (ไฟล์วิดีโอทดสอบที่สร้างด้วย ffmpeg)

**สรุปเฟส 1**
- **ทำแล้ว (ครบทุกข้อ):** bus / output / sends 16 ช่อง (pre/post) / sidechain (compressor, dynamics, gate, Auto-Duck) + กันลูป + mixer · crossfade อัตโนมัติ + รูป X + นโยบายการทับ 3 แบบ · tempo / time signature / Bars:Beats / snap to grid / metronome + count-in / ตรวจ BPM · การอัดแบบแม่นยำระดับแซมเปิล (AudioWorklet) + ชดเชย latency (ตั้งเอง/วัดอัตโนมัติ) + punch in/out + loop recording → takes + comping + input monitoring + เตือน clip · clip time-stretch / pitch 3 โหมด (เรนเดอร์ใน worker) + match tempo · autosave + กู้คืนหลังแครช + project versions · freeze / bounce / group / lock / ripple delete / สีคลิป-แทร็ก / clip loop / เลือกหลายคลิป / video track + ส่งเสียงกลับเข้าวิดีโอ
- **เปลี่ยนพฤติกรรมเดิม (ตั้งใจ):** ลำดับสัญญาณต่อแทร็กเป็น rack → fader (แบบ Audition; เดิม fader → rack) · เซสชันเก่าที่เปิดจะปิด crossfade อัตโนมัติไว้เพื่อให้เสียงเหมือนเดิม · `.asession` เป็นเวอร์ชัน 3 (ไฟล์เก่าเปิดได้ผ่าน `migrate`)
- **บั๊กเดิมที่เจอและแก้ระหว่างทาง:** ScriptProcessor ที่ใช้อัดเสียงทำ block หายเมื่อ main thread ยุ่ง (เปลี่ยนเป็น AudioWorklet) · แอปเดสก์ท็อปปิดหน้าต่างไม่ได้เมื่อมีไฟล์ยังไม่บันทึก · แผง Mixer ที่เปิดค้างไว้ทำให้เกิด error ตอนเปิดแอปครั้งถัดไป · ตรวจจับท้ายเซสชัน/หยุดอัตโนมัติขึ้นกับ animation frame (หยุดทำงานเมื่อย่อหน้าต่าง)
- **ข้อจำกัด / ทำไม่ได้เต็มที่:** การอัดผ่านไมค์/อินเทอร์เฟซจริงและปุ่มวัด latency ทดสอบด้วยสัญญาณสังเคราะห์ + DelayNode แทนฮาร์ดแวร์ (ยังไม่ได้ทดสอบกับอินเทอร์เฟซจริง) · BPM ครึ่ง/สองเท่ากำกวมโดยธรรมชาติ จึงให้ผู้ใช้เลือกจากค่าทางเลือก · tempo ของไฟล์ไม่ถูกเขียนลง WAV (ไม่มีช่องมาตรฐาน) · freeze เก็บผลของ sidechain จากแทร็กอื่น ณ ตอน freeze · Export วิดีโอต้องใช้แอปเดสก์ท็อป + ffmpeg ที่ติดตั้งเอง; วิดีโอ 1 ไฟล์ต่อเซสชัน
- **ไลบรารี/เครื่องมือใหม่:** ไม่มีไลบรารีใหม่ในโค้ดโปรเจกต์ · **ffmpeg** (LGPL 2.1+/GPL ขึ้นกับ build) เป็นโปรแกรมภายนอกที่ผู้ใช้ติดตั้งเอง เรียกผ่าน child process เฉพาะตอน Export video — ไม่ได้รวมในตัวติดตั้ง · ทุกอย่างทำงานออฟไลน์ ไม่มีการส่งเสียงออกนอกเครื่อง

---

## เฟส 2 — Waveform / Spectral / Workflow ให้ครบเท่า Audition

### 2.1 Spectral editing
- [x] **Lasso** และ **Brush** selection ในมุมมอง Spectral (เพิ่มจาก Marquee) — แปลงเป็น mask เวลา×ความถี่ ใช้กับ Delete/Attenuate/Amplify/Spot Heal เดิมได้
  - selection เป็นข้อมูล `{kind: rect|lasso|brush|harm}` → `dsp.shapeMask` ต่อ bin ของ STFT (`spectralEditShape`) · เทสต์: `tests/spectral.test.js`, `tests/app/82-spectral.scenario.js`
- [x] **Spot Healing Brush** (ระบายแล้ว heal ทันที)
- [x] **Spectral Pitch Display** (เส้น pitch ซ้อนบน spectral; ใช้ YIN/pYIN ใน `dsp.js`)
  - YIN (`dsp.yin`) + ปรับละเอียดด้วย harmonic comb (DTFT) — เสียงอื่นที่ไม่ใช่ฮาร์มอนิกทำให้ YIN เพียวๆ คลาดได้ ~2 %
- [x] ปรับ FFT size / window / ช่วง dB / color map ของ spectral ได้
- [x] Auto-select harmonics (เลือกฮาร์มอนิกของเสียงที่คลิกให้อัตโนมัติ)

### 2.2 การเลือกและการเล่น
- [x] **Snap to zero-crossing** (ตัวเลือกใน Edit menu) และ "Adjust selection to zero crossings"
  - `dsp.zeroCross` · Inward / Outward + ปรับทีละด้าน 4 แบบ (คีย์ตาม Audition)
- [x] **Scrub** (ลาก playhead แล้วได้ยินเสียง) และ **Shuttle** (J/K/L)
  - ทั้ง Waveform และ Multitrack (มัลติแทร็กใช้มิกซ์ที่เรนเดอร์แคชไว้) · Loop playback ย้ายเป็น Ctrl+L (ตาม Audition) เพราะ L เป็น shuttle
- [x] **Skip Selection** playback + **Preview Edit** (ฟังผลการตัดก่อนตัดจริง)
- [x] Playlist ของ markers (เล่นช่วงตาม marker เรียงลำดับได้) และ export ช่วง marker เป็นไฟล์แยก (**Export ranges**)
  - range marker (M ตอนมี selection) · แผง Playlist (ลำดับ + loops) · Export Ranges เขียนลงโฟลเดอร์ที่เลือก (IPC `files:pickFolder` / `files:write` เขียนได้เฉพาะในโฟลเดอร์นั้น) · เทสต์: `tests/playx.test.js`, `tests/app/83-playback.scenario.js` (อัดเสียงที่เล่นจริงตรวจว่าข้าม selection / ความเร็ว 2× / ลำดับ playlist)

### 2.3 Favorites, Macros และคีย์ลัด
- [x] **Favorites**: บันทึกลำดับการกระทำ/เอฟเฟกต์พร้อมพารามิเตอร์เป็นปุ่มเดียว (เมนู Favorites + แผง Favorites) ใช้ใน Batch Process ได้
  - `app/js/favorites.js` · บันทึกได้: เอฟเฟกต์ offline ทุกตัว + Convert to Mono/Stereo + Trim Silence (การกระทำที่ขึ้นกับ selection เช่น Delete/Crop ไม่บันทึก เพราะ favorite ต้องใช้ซ้ำกับไฟล์อื่นได้)
- [x] **Keyboard Shortcuts editor**: แก้คีย์ลัดเอง ตรวจคีย์ชน มีพรีเซ็ต "Adobe Audition" ให้คีย์ตรงกับ Audition
  - `app/js/keys.js` · พรีเซ็ต Audition ครอบคลุมเฉพาะคำสั่งที่ AudioStage มี (คำสั่งอื่นใช้คีย์ของ AudioStage)
- [x] Batch Process รองรับ Favorites หลายขั้น + การตั้งชื่อไฟล์ส่งออกแบบ template
  - เทสต์: `tests/favorites.test.js`, `tests/app/84-favorites.scenario.js` (บันทึก favorite ผ่านหน้าต่างเอฟเฟกต์จริง, batch เขียนไฟล์จริง, ตั้งคีย์ใหม่แล้วกดคีย์นั้นได้ผล)

### 2.4 Metering และ Loudness
- [x] **True Peak (dBTP)** ด้วย oversampling 4× ใน LUFS meter, Amplitude Statistics, Match Loudness และ Limiter (โหมด True-Peak limiting)
  - `dsp.truePeak` / `tpEnvelope` / `limiterTP` · Loudness Normalize ใช้เพดาน dBTP จริงด้วย
- [x] Loudness ครบชุด: Integrated / Short-term / Momentary / LRA / PLR
  - `dsp.LoudnessMeter` (streaming) ใช้ทั้งแผง Loudness Meter สดและ Amplitude Statistics · เทสต์ด้วยสัญญาณแบบ EBU Tech 3341/3342 (−23 dBFS → −23 LUFS, LRA 10 LU) · แก้ K-weighting ให้ตรงมาตรฐาน (เดิมอ่านต่ำ ~0.25 dB)
- [x] Phase meter + Correlation meter + Vectorscope (goniometer)
- [x] **Diagnostics panel** แบบ Audition: สแกนหาคลิก/clipping/ช่วงเงียบ แล้วแสดงรายการให้กดแก้ทีละจุดหรือทั้งหมด (ใช้ DeClicker/DeClipper/Delete Silence ที่มีอยู่)
  - ตัวตรวจจับแยกออกจากเอฟเฟกต์เดิม (`detectClicks` / `detectClipping` / `detectSilence`) จึงได้ผลเหมือนเอฟเฟกต์ · เพิ่ม Mark Audio (สร้าง range marker) · เทสต์: `tests/metering.test.js`, `tests/app/85-metering.scenario.js`

### 2.5 อื่นๆ
- [x] **Multichannel**: แทร็กและ master แบบ 5.1 (6 ช่อง) + panner แบบ surround + ส่งออก WAV 5.1 (ถ้า Web Audio ทำได้ในเครื่องนั้น — ถ้าไม่ได้ให้เขียนเหตุผลไว้)
  - master 6 ช่องใน graph builder เดียวกัน (live = offline) · panner `dsp.surroundGains` + LFE send · WAV 6 ช่อง WAVE_FORMAT_EXTENSIBLE · อุปกรณ์ที่มีไม่ถึง 6 ช่อง: Web Audio พับลงสเตอริโอ (เครื่องทดสอบเป็นสเตอริโอ จึงทดสอบเสียง 6 ช่องจริงผ่านการเรนเดอร์ offline)
  - ข้อจำกัด: แทร็กเป็นสเตอริโอเสมอ (แทร็ก 6 ช่องไม่ได้ทำ — คลิป 6 ช่องจะถูกพับลงสเตอริโอที่ pan ของแทร็ก) · Master rack ถูกข้ามใน 5.1 · send ไป bus เป็นสเตอริโอ · ไม่มี automation ของตำแหน่ง surround
- [x] **CD Layout**: จัดลำดับเพลง, gap, ส่งออก **CUE + WAV** (การเขียนแผ่นจริงไม่ต้องทำ)
  - `app/js/cdlayout.js` · track เริ่มตรง CD frame, gap = INDEX 00
- [x] **Interchange**: ส่งออก/นำเข้า multitrack เป็น **Audition XML (.sesx)** และ/หรือ **FCP7 XML** เพื่อเปิดใน Premiere/DaVinci (ทำ subset ที่จำเป็น: แทร็ก, คลิป, ตำแหน่ง, gain, fade)
  - ทำ **FCP7 XML** (export + import, `app/js/interchange.js`) ซึ่ง Premiere, DaVinci Resolve และ Audition เองเปิดได้ · **ไม่ได้ทำ .sesx**: รูปแบบไม่มีเอกสารเปิด และไม่มี Audition ในเครื่องให้ตรวจว่าไฟล์ที่เขียนเปิดได้จริง — ไม่อยากส่งไฟล์ที่อาจเปิดไม่ได้ (Audition นำเข้า FCP XML ได้อยู่แล้ว) · ไม่ได้ทดสอบเปิดใน Premiere/Resolve จริง (ทดสอบ round-trip ในแอป + XML รูปแบบที่โปรแกรมอื่นเขียน เช่น transition แบบ center)
- [x] Media Browser: พรีวิวเสียงก่อนลากเข้าโปรเจกต์ (auto-play, loop)
  - + ลากไฟล์ลงเวฟฟอร์ม/เลนมัลติแทร็ก · เทสต์: `tests/surround.test.js`, `tests/app/86-surround-cd-xml-media.scenario.js`

**สรุปเฟส 2**
- **ทำแล้ว (ครบทุกข้อ ยกเว้น .sesx ที่เลือกทำ FCP7 XML แทน):** Spectral: Lasso / Brush / Spot Healing Brush / Auto-select Harmonics / Pitch Display (YIN + harmonic comb) / ตั้งค่า FFT-window-dB-colormap · Zero crossings (snap + adjust 6 แบบ), Scrub, Shuttle J/K/L, Skip Selection, Preview Edit, range markers + Playlist + Export Ranges · Favorites (บันทึก/แผง/เมนู/ใน Batch), Keyboard Shortcuts editor + พรีเซ็ต Audition, Batch Process หลายขั้น + template ชื่อไฟล์ · True Peak 4× (meter, stats, Match Loudness, Loudness Normalize, Hard Limiter โหมด TP), Loudness Meter สด (M/S/I/LRA/PLR), Phase Meter + correlation 3 ย่าน + Vectorscope, Diagnostics panel · 5.1 surround, CD Layout (CUE + WAV), FCP7 XML export/import, Media Browser preview + drag & drop
- **เปลี่ยนพฤติกรรมเดิม (ตั้งใจ):** Loop playback ย้ายจาก `L` เป็น `Ctrl+L` (ตาม Audition; L เป็น shuttle) · M ตอนมี selection สร้าง range marker (เดิมสร้างจุดที่ playhead) · ค่า LUFS อ่านสูงขึ้น ~0.25 dB เพราะแก้ K-weighting ให้ตรงมาตรฐาน · เพดานของ Loudness Normalize เป็น true peak (dBTP) จริง · การเพิ่ม/ลบ/เปลี่ยนชื่อ marker เป็น Undo ได้
- **บั๊กเดิมที่เจอและแก้ระหว่างทาง:** K-weighting ของการวัด LUFS (ทั้ง offline และ Loudness Meter ใน rack) อ่านต่ำ ~0.25 dB · DeClicker มองช่วง ~6 ms แรกของทุกไฟล์เป็นคลิก · เทสต์เฟส 0 ปิดหน้าต่าง About ด้วยการลบ element ทำให้แอปคิดว่ายังมี dialog เปิดอยู่ (คีย์ลัดใช้ไม่ได้ในเทสต์ถัดไป)
- **ข้อจำกัด:** ดูหมายเหตุใต้ 5.1 และ Interchange · Scrub/Shuttle ในมัลติแทร็กใช้มิกซ์ที่เรนเดอร์ไว้ (ครั้งแรกต้องรอเรนเดอร์) · Favorites บันทึกเฉพาะเอฟเฟกต์ offline + Convert Mono/Stereo + Trim Silence · พรีเซ็ตคีย์ Audition ครอบคลุมเฉพาะคำสั่งที่ AudioStage มี
- **ไลบรารี/โมเดลใหม่:** ไม่มี — ทุกอย่างเขียนเอง (YIN, true-peak filter, loudness meter, XML parser, CUE writer) ทำงานออฟไลน์ทั้งหมด

---

## เฟส 3 — ฟีเจอร์ที่ Audition ไม่มี (จุดขาย "ดีกว่า Audition")

ใช้โมเดลฟรีแบบออฟไลน์เท่านั้น แนะนำ runtime: **onnxruntime-node** (MIT) หรือ **onnxruntime-web/WebGPU** และ **whisper.cpp** (MIT) — ตรวจสัญญาอนุญาตของโมเดลทุกตัวก่อนใช้และเขียนไว้ใน README

### 3.1 Transcribe + Text-based editing ⭐
- [ ] ถอดเสียงเป็นข้อความด้วย **Whisper** (whisper.cpp หรือ transformers.js, โมเดลขนาด tiny/base/small/medium ให้ผู้ใช้เลือก; ต้องรองรับ **ภาษาไทย** และภาษาอังกฤษ) พร้อม timestamp ระดับคำ
- [ ] แผง **Transcript**: คลิกคำ = กระโดดไปที่เสียง, เลือกข้อความแล้วลบ = ตัดเสียงช่วงนั้น (มี crossfade สั้นๆ), Undo ได้
- [ ] **ลบคำเติม/ช่วงลังเลอัตโนมัติ** ("เอ่อ", "อ่า", "um", "uh") และช่วงเงียบยาวเกิน
- [ ] ส่งออกซับไตเติล **SRT / VTT** และ transcript เป็น TXT
- [ ] Speaker diarization แบบง่าย (แยกผู้พูด) ถ้ามีโมเดลฟรีที่เหมาะ

### 3.2 AI Stem Separation ⭐
- [ ] แยกเพลงเป็น **Vocals / Drums / Bass / Other** ด้วย **Demucs (htdemucs) แบบ ONNX** (MIT) หรือโมเดลฟรีเทียบเท่า
- [ ] ผลลัพธ์: เปิดเป็นไฟล์ใหม่ หรือวางลงมัลติแทร็กเป็น 4 แทร็กอัตโนมัติ
- [ ] รันใน worker/โพรเซสแยก มีแถบความคืบหน้าและยกเลิกได้ ใช้ GPU ถ้ามี

### 3.3 Enhance Speech (กดปุ่มเดียว) ⭐
- [ ] ลดเสียงรบกวน/ห้องก้องด้วยโมเดลฟรี เช่น **DeepFilterNet** (MIT/Apache) หรือ **RNNoise** (BSD)
- [ ] ตามด้วยเชน: High-pass → De-esser → Speech Volume Leveler → EQ เสียงพูด → Loudness ตามเป้า
- [ ] สไลเดอร์ "Strength" ตัวเดียว + เปรียบเทียบ before/after
- [ ] ใช้ได้ทั้งเป็นเอฟเฟกต์ offline และใน rack (ถ้าโมเดลเล็กพอสำหรับเรียลไทม์ผ่าน AudioWorklet)

### 3.4 Export ตามแพลตฟอร์ม
- [ ] พรีเซ็ตส่งออก: Spotify (−14 LUFS, −1 dBTP), Apple Music/Podcasts (−16), YouTube (−14), TikTok/Reels, Netflix/Broadcast EBU R128 (−23), ATSC A/85 (−24), Audiobook ACX (RMS −23 ถึง −18, peak −3 dB, noise floor −60 dB)
- [ ] ก่อนส่งออก: วัด → ปรับ loudness → true-peak limit → **รายงานผ่าน/ไม่ผ่าน** ตามมาตรฐานนั้น
- [ ] ACX check แบบเดียวกับ Audacity (บอกว่าข้อไหนไม่ผ่าน)

### 3.5 Non-destructive Waveform editing
- [ ] Waveform Editor เก็บการแก้ไขเป็นลำดับ (edit list) ย้อนไปแก้พารามิเตอร์ของขั้นใดก็ได้ แล้วระบบคำนวณขั้นถัดไปใหม่ (Audition เขียนทับตรงๆ)
- [ ] History panel แสดงทุกขั้น คลิกเพื่อดู/แก้/ปิดขั้นนั้นชั่วคราว

### 3.6 อื่นๆ ที่ช่วยให้เหนือกว่า
- [ ] **Match EQ** (เรียนรู้โทนเสียงจากไฟล์อ้างอิงแล้วปรับไฟล์อื่นให้ใกล้เคียง)
- [ ] **Auto-mix เสียงพูดหลายไมค์** (automixer แบบ gain-sharing สำหรับพอดแคสต์หลายคน ลดเสียงไมค์ที่ไม่ได้พูด)
- [ ] **Room tone fill** (ช่วงที่ตัดออกเติมด้วยเสียงห้องที่เรียนจากไฟล์ แทนความเงียบสนิท)
- [ ] **Podcast template**: สร้างเซสชันสำเร็จรูป (Host/Guest/Music/SFX + bus + ducking + loudness ส่งออก)
- [ ] Command palette (Ctrl+Shift+P) ค้นหาคำสั่ง/เอฟเฟกต์ทุกตัวจากที่เดียว

---

## เฟส 4 — ปลั๊กอินแบบเรียลไทม์ (งานใหญ่ ทำหลังสุด)

ปัจจุบัน VST3/AU ใช้ได้แบบ offline ผ่าน `tools/vst/vst_host.py` (pedalboard) เท่านั้น
- [ ] ศึกษาและเลือกแนวทางที่ **ฟรี** ก่อนลงมือ แล้วเขียนผลการตัดสินใจไว้ใต้ข้อนี้:
  - (ก) สตรีมบล็อกเสียงระหว่าง AudioWorklet ↔ โพรเซส host แยก ผ่าน SharedArrayBuffer/ring buffer + native addon เล็กๆ (N-API, C++) ที่โหลด VST3 ด้วย **VST3 SDK** (ปัจจุบัน Steinberg เปิดเป็น MIT) — ชดเชย latency ด้วย PDC
  - (ข) ใช้ pedalboard แบบประมวลผลเป็นบล็อกต่อเนื่อง (latency สูงกว่า แต่เร็วที่จะทำ) เหมาะกับการพรีวิว/ฟังระหว่างมิกซ์
  - ห้ามใช้ JUCE ถ้าจะทำให้โปรเจกต์ต้องเป็น AGPL/เสียเงิน เว้นแต่ติดตั้งแยกแบบเดียวกับ pedalboard
- [ ] เสียบ VST ในสล็อตของ rack ได้ (track/clip/master), เปิดหน้าต่าง GUI ของปลั๊กอิน, automation พารามิเตอร์ปลั๊กอิน
- [ ] ปลั๊กอิน instrument (VSTi) และแทร็ก MIDI แบบพื้นฐาน (ถ้าเวลาเหลือ)
- [ ] ปลั๊กอินแครชต้องไม่ทำให้แอปล่ม (แยกโพรเซสเหมือนเดิม)

---

## เกณฑ์ "เสร็จ" ของแต่ละเฟส

- `npm test` ผ่านทั้งหมด และมีเทสต์ใหม่ของฟีเจอร์นั้น
- `npm start` เปิดแอปได้ ไม่มี error ใน console
- เปิด `.asession` เก่าได้, มิกซ์ดาวน์เสียงตรงกับการเล่นสด
- README อัปเดตแล้ว, ข้อในไฟล์นี้ติ๊ก `[x]` แล้ว
- สรุปสั้นๆ ท้ายเฟส: ทำอะไรไปบ้าง, อะไรทำไม่ได้และเพราะอะไร, ไลบรารี/โมเดลใหม่ที่ใช้และสัญญาอนุญาตของแต่ละตัว
