# พรอมต์สำหรับ Claude Code — AudioStage: แก้บั๊ก + เติมของที่ขาด (ตรวจเมื่อ 2 พ.ย. 2026)

> วางพรอมต์นี้ใน Claude Code ที่เปิดโฟลเดอร์ `D:\BYS All Stages Projects\AudioStage`
> ทำงานเฉพาะในโฟลเดอร์นี้เท่านั้น ห้ามแก้โปรแกรมอื่น

## วิธีทำงาน
1. อ่าน `README.md`, `ROADMAP-MISSING.md`, `ROADMAP-AUDITION-PLUS.md`, `ROADMAP-LINUX.md` ก่อน
2. ทำตามลำดับหัวข้อ A → B → C → D (A สำคัญที่สุด)
3. แก้แต่ละข้อแล้วรัน `npm test` ต้องผ่านทั้งหมด (ตอนนี้ตัวที่ fail เพราะโค้ดจริงคือ `help.test.js` และ `video.test.js` ดูข้อ A2, A4)
4. ห้ามทำของเดิมพัง ถ้าข้อไหนทำไม่ได้ให้เขียนเหตุผลไว้ท้ายไฟล์นี้
5. จบแต่ละข้อให้ติ๊ก ☑ ในไฟล์นี้

---

## A. บั๊กที่ต้องแก้

### ☐ A1 — หน้า About ยังเขียนว่า "AudioStage 1.0" ทั้งที่เวอร์ชันจริงคือ 2.0.0
- ที่: `app/js/app.js` ฟังก์ชัน `showAbout()` (ประมาณบรรทัด 1736–1738) เขียนตายตัวว่า `<b>AudioStage 1.0</b>`
- แก้: อ่านเวอร์ชันจริงจาก main process (`app.getVersion()` — มี `log:info` คืน `info.version` อยู่แล้ว หรือเพิ่ม IPC `app:version`) แล้วแสดงแทน
- เพิ่มบรรทัดลิขสิทธิ์ในหน้า About ให้เหมือนโปรแกรมอื่นในชุด: `Copyright (c) BYS & RB. All rights reserved by BYS & RB` (ตอนนี้ About ของ AudioStage ไม่มีบรรทัดนี้เลย)
- เกณฑ์ผ่าน: เปลี่ยน `version` ใน `package.json` แล้ว About เปลี่ยนตามเอง

### ☐ A2 — คู่มือในแอป (Help) เก่ากว่า README
- ที่: `app/help/index.html` ยังเป็น "AudioStage 1.0.0 — คู่มือ" แต่ README/package เป็น 2.0.0 → `tests/help.test.js` fail
- แก้: รัน `node tools/make-help.js` ใหม่ และเพิ่มขั้นนี้ลงใน script `dist` (เช่น `"predist": "node tools/make-help.js"`) เพื่อไม่ให้ลืมอีก

### ☐ A3 — ระบบอัปเดตอัตโนมัติใช้ไม่ได้จริง
- ที่: `package.json` → `build.publish` เป็น GitHub `repo: "AudioStage"` แต่ **ไม่มี `owner`** และ `"homepage": "https://github.com/"` เป็นค่าว่างๆ
- ผล: electron-builder ไม่สร้าง `app-update.yml` → เมนู Check for Updates ใช้ไม่ได้ในตัวที่ติดตั้ง
- โฟลเดอร์ AudioStage **ยังไม่มี git repo** เลย (ไม่มี `.git`) ดังนั้น `.github/workflows/build.yml` ก็ยังไม่เคยรันได้
- แก้ (เลือกอย่างใดอย่างหนึ่ง แล้วถามเจ้าของก่อนถ้าไม่แน่ใจ):
  - (แนะนำ) ให้ AudioStage อัปเดตผ่าน **BYS All Stages Launcher** แทน GitHub: ซ่อนเมนู Check for Updates เมื่อไม่มี publish config
  - หรือใส่ `owner` จริง + `git init` + สร้าง repo
- แก้ `homepage` ให้เป็น URL จริง (ตอนนี้เป็น `https://github.com/` เปล่าๆ) — ถามเจ้าของว่าจะใช้ URL ไหน

### ☐ A4 — ส่งเสียงกลับเข้าวิดีโอ (Video track → mux) ได้ไฟล์ยาวเกินวิดีโอเดิม
- ที่: `electron/video.js` บรรทัด ~23 ใช้ `-af apad -shortest` คู่กับ `-c:v copy`
- ผล: ffmpeg หยุดช้ากว่าความยาววิดีโอ (ทดสอบได้ 2.18 วินาทีจากวิดีโอ 2 วินาที) → `tests/video.test.js` fail และไฟล์ที่ได้มีเสียงเกินท้ายวิดีโอ
- แก้: probe ความยาววิดีโอก่อน (มี `probe()` อยู่แล้ว) แล้วใช้ `-t <duration>` แทน `-shortest` (หรือใช้ทั้งคู่) ให้ความยาวผลลัพธ์ต่างจากวิดีโอเดิมไม่เกิน 1 เฟรม

### ☐ A5 — license ขัดกันเอง
- `package.json` เขียน `"license": "MIT"` แต่ `build.copyright` เขียน "All rights reserved by BYS & RB" และโปรแกรมอื่นในชุดเป็น `"UNLICENSED"`
- MIT แปลว่าใครก็เอาโค้ดไปใช้/ขายต่อได้ → ถ้าเจ้าของไม่ได้ตั้งใจ ให้เปลี่ยนเป็น `"UNLICENSED"` ให้ตรงกับโปรแกรมอื่น (ถามเจ้าของก่อน)
- `author` ให้ตรงกับชุด (EditorStage ใช้ `"BYS & RB"`)

### ☐ A6 — ตัวติดตั้งที่มีอยู่เก่ากว่าโค้ด
- `dist/AudioStage Setup 2.0.0.exe` สร้างวันที่ 28 ต.ค. แต่ `package.json` ถูกแก้อีกครั้งวันที่ 1 พ.ย. (ข้อความลิขสิทธิ์) → ตัวติดตั้งที่แจกตอนนี้ยังไม่มีการแก้นี้
- หลังแก้ข้อ A1–A5 แล้ว build ใหม่ (`npm test` → `npm run dist`) และลบ/ย้าย `AudioStage Setup 1.0.0.exe` เก่าออกจาก `dist/` เพื่อไม่ให้อัปโหลดผิดตัว

---

## B. ความปลอดภัย / ความเรียบร้อย

### ☐ B1 — หน้าต่างหลักไม่มีตัวกันการเปิดหน้าใหม่ / เปลี่ยนหน้า
- ที่: `main.js` `createWindow()` (~บรรทัด 280) มี `setWindowOpenHandler` เฉพาะหน้าต่าง Help
- แก้: ใส่ `win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))` (ลิงก์ http/https ให้ `shell.openExternal`) และ `win.webContents.on('will-navigate', e => e.preventDefault())` ยกเว้นหน้า `app/index.html` เอง
- กันกรณีลากไฟล์ .html / ลิงก์ในข้อความ metadata แล้วหน้าต่างหลักถูกเปลี่ยนเป็นหน้าอื่นที่ยังเข้าถึง preload API ได้

### ☐ B2 — F12 เปิด DevTools ได้ในตัวที่ติดตั้งแล้ว
- ที่: `main.js` ~บรรทัด 287
- แก้: เปิดได้เฉพาะ `!app.isPackaged` หรือเมื่อเปิดโหมดนักพัฒนาใน Preferences

### ☐ B3 — dependency ที่ไม่ได้ใช้
- `lamejs` อยู่ใน `dependencies` แต่โค้ดใช้ไฟล์ `app/vendor/lame.min.js` ตลอด (ไม่มี `require('lamejs')`) → electron-builder จะแพ็ก node_modules/lamejs เข้าไปเปล่าๆ
- แก้: ย้ายไป `devDependencies` หรือเอาออก (เก็บ LICENSE ของ lamejs ไว้ในไฟล์ notices)

---

## C. เอกสารที่ไม่ตรงกับของจริง
- ☐ `ROADMAP-LINUX.md` ติ๊ก `[ ]` เกือบทั้งหมด แต่ใน `package.json` มี `build.linux`, `dist:linux`, `.deb`, MIME `.asession` แล้ว → ไล่ตรวจของจริงแล้วติ๊กให้ตรง ข้อที่ยังไม่ได้ทำจริงให้ทำต่อ (Media Browser บน Linux, PipeWire/JACK, espeak-ng, ทดสอบ AppImage/.deb บน Ubuntu จริง)
- ☐ `ROADMAP-MISSING.md` หัวข้อ 12 (version, npm test → dist, ตรวจตัวแพ็ก, สรุปท้ายไฟล์) ยังไม่ได้ทำ — ทำพร้อมข้อ A6

---

## D. ฟีเจอร์ที่ยังขาด (จาก `ROADMAP-AUDITION-PLUS.md` ที่ยังเป็น `[ ]` — 26 ข้อ)
ทำหลัง A–C เสร็จ เรียงจากคุ้มที่สุด:
1. ☐ **Loudness presets + ตรวจผ่าน/ไม่ผ่าน** ก่อนส่งออก (Spotify −14, Apple −16, YouTube −14, EBU R128 −23, ATSC −24) + **ACX check**
2. ☐ **Command palette** (Ctrl+Shift+P) ค้นหาคำสั่ง/เอฟเฟกต์
3. ☐ **Podcast template** (Host/Guest/Music/SFX + bus + ducking + loudness)
4. ☐ **ถอดเสียงเป็นข้อความ (Whisper ออฟไลน์)** + แผง Transcript + ลบคำเติม + ส่งออก SRT/VTT/TXT (ดูวิธีของ EditorStage `src/Services/ai/stt.js` ได้ ห้ามแก้ไฟล์ของ EditorStage)
5. ☐ **AI ลดเสียงรบกวน** (DeepFilterNet / RNNoise) + สไลเดอร์ Strength
6. ☐ **แยก stem** Vocals/Drums/Bass/Other (Demucs ONNX) ใน worker ยกเลิกได้
7. ☐ Match EQ, Auto-mix หลายไมค์, Room tone fill
8. ☐ Edit list แบบไม่ทำลาย (non-destructive) + History panel แก้ขั้นเก่าได้
9. ☐ VST แบบ **เรียลไทม์ใน rack** + หน้าต่าง GUI ของปลั๊กอิน + automation (ตอนนี้ VST เป็น offline อย่างเดียว) และปลั๊กอินแครชต้องไม่ทำให้แอปล่ม
10. ☐ VSTi + แทร็ก MIDI พื้นฐาน (ถ้าเวลาเหลือ)

## เกณฑ์ "เสร็จ"
- `npm test` ผ่านทุกไฟล์ (0 failed)
- About แสดงเวอร์ชันจริง + ลิขสิทธิ์ BYS & RB
- build ตัวติดตั้งใหม่แล้ว เปิด `dist/win-unpacked/AudioStage.exe` ได้ไม่มี error
- สรุปท้ายไฟล์นี้ว่าแก้อะไรไป อะไรยังไม่ได้ทำและเพราะอะไร

---

# รอบ 2 — ตรวจละเอียด (3 พ.ย. 2026)

**วิธีตรวจ:** อ่านโค้ด `main.js`, `electron/*`, `app/js/{app,engine,autosave,sessionio,recording}.js`, รัน `npm test` และตรวจไฟล์ใน `build/`, `dist/`

**ผลชุดทดสอบ (`npm test`):** 29 ไฟล์ · ผ่าน 451 · **ไม่ผ่าน 3** — `assoc.test.js`, `help.test.js`, `linux.test.js` (รายละเอียดข้อ G1, A2) — `video.test.js` ผ่านแล้วบนเครื่องนี้ (ffmpeg 8.0.1) แต่โค้ดยังใช้ `-af apad -shortest` แบบเดิม ดูข้อ A4

**สถานะข้อรอบแรก (ตรวจ 3 พ.ย.):**
- A1 ยังไม่แก้ (About ยังเขียน "AudioStage 1.0", ไม่มีบรรทัดลิขสิทธิ์)
- A2 ยังไม่แก้ (`app/help/index.html` ยังเป็น 1.0.0, ไม่มี `predist`)
- A3 ยังไม่แก้ (`homepage` = `https://github.com/`, `publish` ไม่มี owner, ไม่มี git)
- A4 ◐ test ผ่านบนเครื่องนี้ แต่ยังไม่ได้ใช้ `-t <ความยาววิดีโอ>` — ffmpeg รุ่นอื่นยังได้ไฟล์ยาวเกิน; ทำตามข้อเดิม
- A5 ยังไม่แก้ (`license: MIT`, `author: BYS All Stages`)
- A6 ยังไม่แก้ (`dist/` มีทั้ง Setup 1.0.0 และ 2.0.0 ของวันที่ 28 ต.ค.)
- B1, B2, B3 ยังไม่แก้ (ไม่มี window-open/navigate guard ในหน้าต่างหลัก, F12 เปิด DevTools ได้เสมอ, `lamejs` ยังอยู่ใน `dependencies`)

สัญลักษณ์: 🔴 = ข้อมูลผู้ใช้หาย/เสียได้ · ✅ยืนยัน = รันจริงแล้วเห็นผล · 🔎 = อ่านโค้ดแล้วเห็นชัด (ยังไม่ได้รันในแอป) · 🧮 = คำนวณจากข้อจำกัดของ engine

## G. บั๊กที่พบเพิ่ม (ทำก่อนหมวด D)

### ☐ G1 — ✅ยืนยัน ไอคอนโปรแกรม/ไฟล์ `.asession` เป็นโลโก้เก่า → `npm test` ไม่ผ่าน 2 ไฟล์
- `build/icon.png` (โลโก้ใหม่ 28 ต.ค.) ใหม่กว่า `build/icons/*.png` (27 ต.ค.) และ `build/asession.ico` มีแค่ขนาด 16 px (567 ไบต์)
- `tests/assoc.test.js`: asession.ico ต้องมี 16/24/32/48/64/128/256 px แต่มีแค่ 16; `tests/linux.test.js`: `16x16.png is up to date with the logo` ไม่ผ่าน
- แก้: `npm run icons` แล้วรัน test ใหม่ (และ build ตัวติดตั้งใหม่ในข้อ A6 — ตัวติดตั้ง 2.0.0 ที่มีอยู่ใช้ไอคอนเก่า)

### ☐ G2 — 🔴 🔎 Save As แล้วกด Cancel ในหน้าต่างเลือกที่บันทึก = ไฟล์ถูกนับว่า "บันทึกแล้ว"
- ที่: `app/js/app.js` `exportDoc()` บรรทัด 1031: `await encodeDownload(...)` แล้ว `d.dirty = false` ทันที — แต่ `download()` แค่สั่ง `<a download>.click()` (Electron เปิดหน้าต่าง Save ของ download) ไม่รู้ว่าผู้ใช้กด Save หรือ Cancel หรือเขียนไม่สำเร็จ
- ผล: แก้ไฟล์ → Ctrl+S → กด Cancel → จุด "ยังไม่บันทึก" หาย → ปิดไฟล์/ปิดโปรแกรมไม่ถาม → งานหาย
- แก้: ทำ IPC `files:saveAs` ใน main (dialog.showSaveDialog + เขียนไฟล์ + คืน path หรือ null) แล้วตั้ง `dirty=false` เฉพาะเมื่อเขียนสำเร็จ; จำ path ไว้ให้ Ctrl+S ครั้งถัดไปบันทึกทับไฟล์เดิมได้ (ตอนนี้ Ctrl+S = Save As ทุกครั้ง) — ใช้กับ Export Mixdown, Save Session, Batch ด้วย

### ☐ G3 — 🔴 🔎 Multitrack ไม่มีสถานะ "ยังไม่บันทึก" เลย → ปิดโปรแกรม / เปิด session อื่น ทับงานโดยไม่ถาม
- ที่: `app.js` บรรทัด 1970 `beforeunload` ตรวจแค่ `app.docs.some(d => d.dirty)` (ไฟล์ Waveform); `useSession()` / `loadSession()` (บรรทัด 1094–1098) แทนที่ `app.session` ทันที; `Session` ไม่มี `dirty`
- ผล: ทำ multitrack หลายชั่วโมง → ปิดหน้าต่าง → ปิดเลยไม่ถาม (และ `pagehide` ลบ crash marker ทิ้ง → เปิดใหม่ไม่เสนอกู้คืนด้วย ทั้งที่ autosave.json ยังอยู่); File > Open Multitrack Session… ทับ session ที่ยังไม่บันทึกทันที
- แก้: `session.dirty` (ตั้งเมื่อ `session.push()` / undo / redo, ล้างเมื่อ Save Session สำเร็จ — ข้อ G2) + ใช้ใน `beforeunload`, `loadSession`, New Session, และหน้า Welcome; แสดง "*" ที่ชื่อ session

### ☐ G4 — 🔴 🧮 Session ที่มีเสียงรวมเกิน ~17 นาที (stereo 48 kHz) บันทึกเป็น `.asession` ไม่ได้
- ที่: `app/js/sessionio.js` `serialize()` เก็บเสียงทุก source เป็น base64 ของ Float32 ใน JSON ก้อนเดียว → `JSON.stringify` ใน `saveSession()` (`app.js` บรรทัด 1092)
- คำนวณ: ความยาว string สูงสุดของ V8 ≈ 536 ล้านตัวอักษร = Float32 ~402 MB ≈ 17.5 นาที stereo 48 kHz (รวมทุกคลิป/take/frozen track) → เกินแล้ว `RangeError: Invalid string length` = กด Save Session แล้วไม่ได้ไฟล์ (พอดแคสต์ 1 ชั่วโมงบันทึกไม่ได้เลย); ต่ำกว่านั้นก็ใช้หน่วยความจำ ~3 เท่าของเสียงระหว่างบันทึก และ `file.text()` ตอนเปิดก็ติดเพดานเดียวกัน — **ยังไม่ได้รันกับไฟล์จริง** (เครื่องตรวจหน่วยความจำไม่พอ) ให้ทดสอบด้วย session 20 นาทีก่อนแก้
- แก้: รูปแบบ `.asession` v4 = zip (หรือโฟลเดอร์ `<name> Files/`) ที่มี `session.json` + ไฟล์เสียงแยก (WAV/FLAC 32f) เขียนแบบ stream ผ่าน main process; ยังเปิดไฟล์ v1–v3 ได้ (`migrate`)
- เกณฑ์ผ่าน: session 2 ชั่วโมง stereo บันทึก/เปิดได้ + test round-trip

### ☐ G5 — 🔴 🔎 Undo ของไฟล์ Waveform ไม่จำกัดหน่วยความจำ
- ที่: `app/js/engine.js` `Doc.set()` เก็บ 40 step โดยแต่ละ step ถือ array เสียงทั้งไฟล์ (effect ทั้งไฟล์ = สำเนาใหม่ทั้งก้อน)
- ผล: ไฟล์ 1 ชั่วโมง stereo 48 kHz = ~1.4 GB ต่อสำเนา → ใส่ effect ไม่กี่ครั้งหน่วยความจำเต็ม renderer แครช (และงานที่ยังไม่บันทึกหาย)
- แก้: งบ undo เป็นไบต์ (เช่น ¼ ของ RAM, สูงสุด 1.5 GB) ทิ้ง step เก่าสุดก่อน + แจ้งผู้ใช้ครั้งเดียว; step ที่แก้แค่ช่วงเลือกเก็บเฉพาะช่วงนั้น (diff) แทนทั้งไฟล์ — ตัวอย่างงบไบต์: `PDFStage/src/Core/history.js`

### ☐ G6 — 🔎 Save back to EditorStage เขียนทับไฟล์ตรงๆ
- ที่: `main.js` `extedit:save` (บรรทัด 273–277) `fs.writeFileSync(p, …)`; `files:write` (บรรทัด 203–211) ก็เขียนทับตรงๆ และเขียนทับไฟล์ชื่อซ้ำในโฟลเดอร์ปลายทางโดยไม่ถาม
- ผล: แครช/ดิสก์เต็มระหว่างเขียน = ไฟล์ WAV ที่ EditorStage ใช้บน timeline เสีย; Export Ranges / CD Layout ทับไฟล์เดิมที่ชื่อซ้ำเงียบๆ
- แก้: เขียน `.tmp` → fsync → rename แบบเดียวกับ `store:put` ที่มีอยู่แล้ว (บรรทัด 222) และถามก่อนทับไฟล์ที่มีอยู่ (หรือเติม " (2)")

### ☐ G7 — 🔎 File > Open หลายไฟล์ใหญ่พร้อมกัน = อ่านทั้งหมดเข้าหน่วยความจำในครั้งเดียว
- ที่: `main.js` `files:open` (บรรทัด 193–199) อ่านทุกไฟล์ที่เลือก (ไฟล์ละไม่เกิน 1.5 GB) เป็น `Uint8Array` แล้วส่งผ่าน IPC ก้อนเดียว
- ผล: เลือกไฟล์ใหญ่ 5–10 ไฟล์ = ใช้หลาย GB พร้อมกัน → แครช
- แก้: คืนแค่ path + ขนาด แล้วให้ renderer อ่านทีละไฟล์ (ผ่าน `open:read` แบบเดียวกับไฟล์จาก Explorer) พร้อมแถบ progress / ยกเลิกได้

### ☐ G8 — 🔎 ปิดโปรแกรมแบบปกติแล้วไม่มี crash recovery ของ multitrack
- เกี่ยวกับ G3: crash marker ถูกลบใน `pagehide` เสมอ แม้ผู้ใช้กด "Close Without Saving" ด้วยความเผลอ → หลังแก้ G3 แล้ว ให้เก็บ autosave ล่าสุดไว้อีกระยะ (เช่น เมนู File > Recover Last Session…) แทนการลบทิ้งทันที

### ☐ G9 — 🔎 การบันทึกเสียง (Record) อยู่ในหน่วยความจำจนกด Stop
- `recording.js` ประกอบ take จาก capture ทั้งก้อนหลังหยุดบันทึก → ถ้าแอปแครช/ไฟดับระหว่างอัดยาว take ทั้งหมดหาย
- แก้ (ควรตรวจในแอปก่อน): เขียน capture ลงดิสก์ระหว่างอัด (`store:put` เป็นช่วงๆ หรือ stream WAV ผ่าน main) แล้วกู้คืนได้ตอนเปิดใหม่

### ☐ G10 — 🔎 หน้า About / Help / version ไม่ตรงกันหลายจุด (ต่อจาก A1–A2)
- `package.json` `author` = "BYS All Stages" แต่ `build.copyright` = "BYS & RB" และ EditorStage ใช้ "BYS & RB" — เลือกให้ตรงกันทั้งชุดพร้อมข้อ A5
- `ROADMAP-*.md` ยังอ้างเวอร์ชัน 1.x หลายจุด — ตรวจพร้อมข้อ C

## H. สิ่งที่ควรเพิ่ม (นอกเหนือจาก D)
1. ☐ Save (Ctrl+S) บันทึกทับไฟล์เดิม / Save As เลือกที่ใหม่ (ตอนนี้ทุกการบันทึกเป็น download ใหม่ — ชื่อ session เป็น `Session.asession` ทุกครั้ง)
2. ☐ ชื่อ session + "*" ใน title bar, รายการ Recent Sessions จำ path จริงหลัง Save
3. ☐ เปิด `.asession` ที่ใหญ่: แถบ progress + ยกเลิกได้ (ตอนนี้ `UI.busy` ค้างทั้งหน้าจอ)
4. ☐ test อัตโนมัติ: G2 (cancel ไม่ล้าง dirty), G3 (beforeunload เมื่อ session ถูกแก้), G4 (round-trip session ยาว), G5 (งบ undo)

## ลำดับแนะนำ
G1 → A2 → (npm test ผ่าน 0 failed) → G2 → G3 → G4 → G5 → G6 → A1 → A4 → A5 → B1 → B2 → B3 → G7 → G8 → G9 → G10 → A3 → A6 (build ใหม่) → C → H → D
