# AudioStage — งานที่ยังขาด (เติมให้ครบก่อนแจกจ่าย)

> **วิธีใช้:** เปิด Claude Code ในโฟลเดอร์ `AudioStage` แล้วพิมพ์
> `อ่าน ROADMAP-MISSING.md ให้ครบ แล้วทำทุกข้อตามลำดับ ทำเสร็จแต่ละข้อให้รัน npm test และติ๊ก [x] ในไฟล์นี้ สุดท้ายรัน npm run dist`
>
> **ไม่ต้องทำ:** เฟส 3 และเฟส 4 ใน `ROADMAP-AUDITION-PLUS.md` · การแปล UI เป็นภาษาไทย (UI คงเป็นภาษาอังกฤษแบบ Audition) · การซื้อใบรับรองเซ็นโค้ด
>
> **Linux:** แยกไว้ใน `ROADMAP-LINUX.md` (แผนเสริม ทำหลังไฟล์นี้เสร็จ — ไฟล์นี้ทำเฉพาะ Windows)

---

## กฎ (เหมือน ROADMAP-AUDITION-PLUS.md)

1. **ฟรี 100% และออฟไลน์ได้** — ใช้เฉพาะของโอเพนซอร์สที่ใช้ฟรี (MIT/Apache-2.0/BSD/MPL/ISC/Zlib/PSF) ห้ามใช้บริการเสียเงินหรือ API key ห้ามส่งเสียงผู้ใช้ออกนอกเครื่อง ของที่เป็น GPL (pedalboard, ffmpeg บางบิลด์) ให้ **ดาวน์โหลด/ติดตั้งแยกบนเครื่องผู้ใช้** ไม่รวมในโค้ดโปรเจกต์ และเขียนหมายเหตุสัญญาอนุญาตใน README
2. รักษาสถาปัตยกรรมเดิม: vanilla JS, namespace `AS.*`, IIFE, ไม่มี bundler/framework ใหม่, งานหนักผ่าน `jobs.js`/`worker.js`
3. ทุกฟีเจอร์ต้องมีเทสต์ใน `tests/` (และ scenario ใน `tests/app/` ถ้าเป็น UI) และ `npm test` ต้องผ่านทั้งหมด
4. ต้องทำงานได้ทั้ง `npm start` (โหมดพัฒนา) **และในแอปที่ติดตั้งจาก `.exe`** (โค้ดอยู่ใน `app.asar` — ระวัง path)
5. ฟีเจอร์ที่ใช้ได้เฉพาะแอปเดสก์ท็อป ให้ซ่อน/ปิดอย่างสุภาพในโหมดเบราว์เซอร์ (`npm run web`) ห้ามมีปุ่มหลอก
6. อัปเดต `README.md` (ภาษาไทย) ทุกข้อ และติ๊ก `[x]` ในไฟล์นี้ ถ้าข้อไหนทำไม่ได้จริงให้เขียนเหตุผลไว้ใต้ข้อนั้น

---

## 1. แก้ VST ให้ใช้ได้ในแอปที่ติดตั้งแล้ว ⭐ (สำคัญที่สุด)

ปัญหาตอนนี้: `electron/vst-host.js` หา Python จาก `tools/vst/.venv` หรือ `py`/`python` ในเครื่อง และบอกให้ผู้ใช้รัน `npm run setup:vst` — คนที่ติดตั้งจาก `.exe` ไม่มี npm และส่วนใหญ่ไม่มี Python จึงใช้ VST ไม่ได้เลย

- [x] **ปุ่ม "Install VST Support…" ในแอป** (เมนู Effects > VST3 / AU Plugin และในหน้าต่างที่แจ้งว่ายังไม่พร้อม) ทำทุกอย่างให้อัตโนมัติ ไม่ต้องใช้ npm หรือติดตั้ง Python เอง:
  - ดาวน์โหลด **Python embeddable package (Windows x64, จาก python.org — PSF license)** เวอร์ชันที่ pedalboard มี wheel รองรับ ตรวจ SHA-256
  - แตกไฟล์ลง `userData/vst-runtime/python/` เปิดใช้ `site-packages` (แก้ไฟล์ `python3XX._pth`), ติดตั้ง pip แล้ว `pip install -r requirements.txt` (pedalboard + numpy) ลงในโฟลเดอร์นั้น
  - แสดงแถบความคืบหน้า + ยกเลิกได้ + ข้อความ error ที่อ่านเข้าใจ (เช่น ไม่มีอินเทอร์เน็ต) ทำงานใน main process ไม่ให้ UI ค้าง
  - ปุ่ม **Repair / Reinstall** และ **Remove VST Support** (ลบโฟลเดอร์ runtime)
- [x] **ลำดับการหา Python ใน `detectPython()`**: `AUDIOSTAGE_PYTHON` → `userData/vst-runtime` → `tools/vst/.venv` (โหมดพัฒนา) → Python ในระบบ ที่ import pedalboard ได้ · เมื่อติดตั้งเสร็จให้ล้างแคช `pythonInfo` ใช้ได้ทันทีโดย **ไม่ต้องรีสตาร์ทแอป**
- [x] ข้อความแนะนำ (`hint`) ต้องไม่บอกให้รัน npm อีกในแอปที่ติดตั้งแล้ว ให้ชี้ไปที่ปุ่ม Install VST Support แทน (`npm run setup:vst` ยังเก็บไว้สำหรับนักพัฒนา)
- [x] ตรวจว่า `vst_host.py` ถูกแตกออกมาที่ `app.asar.unpacked/tools/vst/` จริงในตัวติดตั้ง (ตรวจ `dist/win-unpacked/resources/`) และรันได้
- [x] **หน้าจัดการปลั๊กอิน (Plugin Manager)**: สแกนโฟลเดอร์ VST3 มาตรฐาน + เพิ่มโฟลเดอร์เองได้ (จำไว้), แสดงรายชื่อปลั๊กอินที่พบ/โหลดไม่ได้ (พร้อมเหตุผล), ปุ่ม Rescan · ปลั๊กอินที่ทำให้ host แครชให้ทำเครื่องหมายและข้ามในการสแกนครั้งต่อไป (แอปต้องไม่ล่ม)
- [x] จำปลั๊กอินและค่าพารามิเตอร์ล่าสุดที่ใช้ บันทึกเป็นพรีเซ็ตได้ และใช้ใน **Favorites / Batch Process** ได้
- [x] เทสต์: จำลอง runtime ใน userData (โฟลเดอร์ชั่วคราว) ทดสอบลำดับการหา Python, ข้อความ hint, การยกเลิกดาวน์โหลด (mock เครือข่าย) · ทดสอบจริงด้วยปลั๊กอินฟรี 1 ตัวถ้ามี `VST3_TEST_PLUGIN`
  - หมายเหตุ: เทสต์อยู่ใน `tests/runtimes.test.js` (เซิร์ฟเวอร์จำลองในเครื่อง + userData ชั่วคราว) และ `tests/app/87-runtimes.scenario.js` (ติดตั้งจากเซิร์ฟเวอร์ช้าแล้วกด Cancel ในแอปจริง) · เทสต์ปลั๊กอินจริงรันเมื่อตั้ง `VST3_TEST_PLUGIN` — ในรอบนี้ไม่ได้รัน เพราะเครื่องทดสอบไม่มีปลั๊กอิน VST3 ติดตั้งอยู่ (การโหลดไฟล์ปลั๊กอินที่ดาวน์โหลดจากภายนอกถูกระบบความปลอดภัยของเซสชันปฏิเสธ) · ตรวจแล้วว่า `dist/win-unpacked/resources/app.asar.unpacked/tools/vst/vst_host.py` รันด้วย Python ที่ Install VST Support ติดตั้งได้ (ping → pedalboard 0.9.26 / Python 3.13.17)
- [x] **ffmpeg แบบเดียวกัน**: ปุ่ม "Install ffmpeg…" สำหรับ Export Video with Mixdown — ดาวน์โหลดบิลด์ Windows ที่แจกฟรี (เลือกบิลด์ **LGPL** ถ้ามี) ลง `userData/ffmpeg/` ตรวจ checksum, `findFfmpeg()` หาในโฟลเดอร์นี้ก่อน PATH, มีปุ่ม Remove

## 2. Recent Files

- [x] File > **Open Recent** (ไฟล์เสียง) และ **Open Recent Session** (`.asession`) อย่างละ 10 รายการ + Clear Recent · เก็บใน userData (เดสก์ท็อป) / localStorage แบบ try/catch (เบราว์เซอร์)
- [x] ไฟล์ที่หายไปแล้ว: แจ้งเตือนและเอาออกจากรายการ
- [x] เพิ่มลง **Windows Jump List** (คลิกขวาไอคอนที่ taskbar) ด้วย `app.addRecentDocument`
- [x] แสดงรายการ recent ใน **หน้าต้อนรับ** (ข้อ 5)

## 3. หน้า Preferences รวม (Edit > Preferences…, Ctrl+K แบบ Audition)

- [x] หน้าต่างเดียวแบ่งแท็บ: **General** (ธีม, หน้าต้อนรับตอนเปิด, ถามก่อนปิด) · **Audio Hardware** (ย้ายจาก Audio Hardware Setup) · **Recording** (latency, pre/post-roll, โฟลเดอร์เก็บไฟล์อัด) · **Autosave** (ช่วงเวลา, เปิด/ปิด) · **Files** (โฟลเดอร์เปิด/บันทึกเริ่มต้น, ฟอร์แมตส่งออกเริ่มต้น, sample rate/bit depth ของไฟล์ใหม่และเซสชันใหม่) · **Multitrack** (crossfade อัตโนมัติ, snap, ค่าเริ่มต้นของแทร็กใหม่) · **Display** (หน่วยเวลาเริ่มต้น, ค่า spectral เริ่มต้น) · **VST / ffmpeg** (สถานะ + ปุ่มจากข้อ 1)
  - หมายเหตุ: แท็บ General มีธีม / ถามก่อนปิด / zero-crossing / pre-post-roll; ตัวเลือก "หน้าต้อนรับตอนเปิด" เพิ่มพร้อมข้อ 5 และ "ตรวจอัปเดตตอนเปิด" เพิ่มพร้อมข้อ 10 (ลงทะเบียนเมื่อฟีเจอร์นั้นมีจริง จะได้ไม่มีตัวเลือกปลอม) · Ctrl+K ใช้ในพรีเซ็ตคีย์ลัด AudioStage; พรีเซ็ต Adobe Audition ใช้ Ctrl+K เป็น Split อยู่แล้วจึงไม่ผูกคีย์ให้ Preferences
- [x] เมนูเดิมยังอยู่ได้ แต่ต้องอ่าน/เขียนค่าชุดเดียวกัน (แหล่งเดียว) · ปุ่ม **Reset all preferences**
- [x] ค่าทั้งหมดถูกนำไปใช้จริง (มีเทสต์ว่าค่าเริ่มต้นใหม่ถูกใช้ตอนสร้างไฟล์/เซสชัน)

## 4. เปิดไฟล์ด้วยการดับเบิลคลิก (File associations)

- [x] เพิ่ม `build.fileAssociations` ใน `package.json`: `.asession` (ไอคอนของ AudioStage, role Editor) และเลือกได้สำหรับ `.wav .mp3 .flac .ogg .opus .m4a .aac .aif .aiff` (ไม่บังคับเป็นโปรแกรมหลัก — ให้ขึ้นใน "Open with")
  - หมายเหตุ: ไฟล์เสียงลงทะเบียนผ่าน build/installer.nsh (OpenWithProgids) แทน fileAssociations เพราะ fileAssociations ของ electron-builder จะตั้ง AudioStage เป็นโปรแกรมหลักของนามสกุลนั้น ซึ่งข้อนี้บอกว่าไม่บังคับ — ทดสอบการติดตั้งจริงในข้อ 12
- [x] สร้างไฟล์ไอคอน `.ico` สำหรับไฟล์ `.asession` จาก `build/icon.png` (โลโก้เดิม) ใส่ใน `build/`
- [x] ทดสอบว่า `main.js` เปิดไฟล์ได้ทั้งตอนแอปยังไม่เปิด (argv) และตอนเปิดอยู่แล้ว (`second-instance`) — `.asession` เปิดเป็นมัลติแทร็ก, ไฟล์เสียงเปิดใน Waveform

## 5. Help, คู่มือ และหน้าต้อนรับ

- [x] **หน้าต้อนรับ (Start screen)** ตอนเปิดแอปโดยไม่มีไฟล์: New Audio File / New Multitrack Session / Open / Recent / ลิงก์คู่มือ · ปิดได้ใน Preferences
- [x] **คู่มือในตัวโปรแกรม** (Help > AudioStage Help, F1 — ย้ายคีย์ลัด Keyboard Shortcuts ไปที่อื่นถ้าชน) เป็นหน้า HTML ออฟไลน์ใน `app/help/` แปลงเนื้อหาจาก README เป็นหัวข้อ มีช่องค้นหา (เนื้อหาคู่มือเขียนภาษาไทยได้ ตาม README)
- [x] Help > **Show Log Files / Report a Problem** (เปิดโฟลเดอร์ log ใน userData) และ **Check VST / ffmpeg status**
- [x] **Tooltip** อธิบายบนปุ่ม/ช่องตั้งค่าที่ยังไม่มี โดยเฉพาะในหน้าต่างเอฟเฟกต์ (บอกว่าพารามิเตอร์ทำอะไร)

## 6. Workspaces

- [x] Window > Workspace: **Save as New Workspace…**, สลับ, ลบ, เปลี่ยนชื่อ, Reset (ใช้ระบบ layout ใน `panels.js`)
- [x] Workspace สำเร็จรูป: **Default, Editing, Mixing, Spectral Repair, Podcast / Radio**
- [x] คีย์ลัด Alt+Shift+1…5 สลับ workspace

## 7. DeReverb

- [x] เอฟเฟกต์ **DeReverb** (Noise Reduction / Restoration) แบบ offline: ลดเสียงก้องห้องด้วยวิธี DSP ล้วน (เช่น spectral subtraction ของ late reverberation ตาม T60 ที่ประมาณจากไฟล์) พารามิเตอร์ Amount, Processing Focus, Gain Compensation + preview
- [x] ถ้าทำแบบเรียลไทม์ใน rack ได้ให้ใส่ด้วย · เทสต์ DSP ใน `tests/dsp.test.js` (เสียงแห้ง + convolution reverb สังเคราะห์ → ผลต้องใกล้เสียงแห้งกว่าเดิม)

## 8. Generate Speech (Text to Speech)

- [x] Effects > Generate > **Speech…**: พิมพ์ข้อความ เลือกเสียง/ภาษา (รวม **ภาษาไทย** ถ้าเครื่องมี), ความเร็ว, pitch แล้ววางเป็นเสียงที่ตำแหน่ง playhead / ทับ selection
- [x] ใช้เสียงที่มีในเครื่องแบบออฟไลน์ (Windows SAPI / เสียงระบบ ผ่าน main process เช่น PowerShell `System.Speech` เขียนเป็น WAV) ไม่ใช้บริการคลาวด์ · ถ้าเครื่องไม่มีเสียงภาษานั้นให้บอกวิธีติดตั้ง language pack ของ Windows
- [x] Undo ได้ · เทสต์ด้วย mock
  - หมายเหตุ: ในแอปนี้ Generate เป็นเมนูหลักของตัวเอง (ข้าง Effects) จึงอยู่ที่ **Generate > Speech…** · เสียงไทยของ Windows (Microsoft Pattara) เป็นเสียง OneCore ซึ่ง System.Speech มองไม่เห็น จึงใช้ WinRT `Windows.Media.SpeechSynthesis` เป็นหลักและ System.Speech เป็นตัวสำรอง · ทดสอบเสียงจริงภาษาไทยบนเครื่องนี้แล้ว (`tests/tts.test.js`)

## 9. Metadata / ID3 สำหรับไฟล์บีบอัด

- [x] หน้าต่าง **File > File Info / Metadata…** (Title, Artist, Album, Year, Genre, Track, Comment, ภาพปก) ใช้ร่วมกับ BWF/CART ของ WAV ที่มีอยู่
- [x] เขียนแท็กตอนส่งออก: **ID3v2.4 (MP3)**, **Vorbis comments (FLAC, Opus)**, **MP4 atoms (M4A)** — เขียนเองในโปรเจกต์ (ไม่ต้องพึ่ง GPL) รองรับ UTF-8 (ภาษาไทยต้องไม่เพี้ยน)
- [x] อ่านแท็กตอนเปิดไฟล์และเก็บไว้ ส่งออกซ้ำแล้วแท็กไม่หาย · ใช้ template ชื่อไฟล์ใน Batch Process ได้ (`{title}`, `{artist}`)
- [x] เทสต์: เขียน → อ่านกลับ ตรงกันทุกฟิลด์ รวมข้อความภาษาไทยและภาพปก

## 10. อัปเดตอัตโนมัติ (ฟรี)

- [x] ใช้ `electron-updater` (MIT) กับ **GitHub Releases** (ฟรี) — ตั้ง `build.publish` ไว้แต่ถ้ายังไม่ได้ตั้ง repo ให้ฟีเจอร์ปิดตัวเองเงียบๆ ไม่ error
- [x] Help > **Check for Updates…** + ตรวจอัตโนมัติตอนเปิดแอป (ปิดได้ใน Preferences) ถามก่อนดาวน์โหลด/ติดตั้งเสมอ
- [x] เขียนวิธีออกเวอร์ชันใหม่ใน README (เพิ่มเลข `version`, `npm run dist`, อัปโหลดไฟล์ `.exe` + `latest.yml` + `.blockmap` ขึ้น Release)
  - หมายเหตุ: `build.publish` ตั้งเป็น GitHub (repo `AudioStage`) แต่ยังไม่มี `owner` — electron-builder จึงไม่สร้าง `app-update.yml` และแอปปิดการอัปเดตเงียบๆ จนกว่าจะใส่ owner (วิธีอยู่ใน README) · `npm run dist` เปลี่ยนเป็น `--publish never` · ทดสอบด้วย electron-updater จำลองและเซิร์ฟเวอร์อัปเดตจำลองในแอปจริง; ยังไม่ได้ทดสอบกับ GitHub Release จริง เพราะยังไม่มี repo

## 11. สลับเลเยอร์ในมัลติแทร็ก (แบบ Adobe Audition)

ตอนนี้ลากคลิปย้ายข้ามแทร็กได้แล้ว แต่ **สลับลำดับแทร็กไม่ได้** และ **เลือกว่าคลิปไหนอยู่บนเมื่อซ้อนกันไม่ได้**

### 11.1 ย้ายลำดับแทร็ก (Track reorder)
- [x] **ลากหัวแทร็ก** (แถบชื่อแทร็กด้านซ้าย) ขึ้น/ลงเพื่อสลับลำดับ มีเส้นบอกตำแหน่งที่จะวางระหว่างลาก ใช้ได้กับแทร็กเสียง, Bus และ Video track · ลากเลื่อนจอขึ้นลงอัตโนมัติเมื่อลากไปถึงขอบ
- [x] เมนู Multitrack > **Move Track Up / Move Track Down / Move Track to Top / Move Track to Bottom** + เมนูคลิกขวาที่หัวแทร็ก + คีย์ลัด (ลงทะเบียนใน `keys.js` แก้ได้ใน Keyboard Shortcuts editor, พรีเซ็ต Audition ให้ตรงกับ Audition ถ้ามี)
- [x] เลือกหลายแทร็ก (Ctrl/Shift+คลิกหัวแทร็ก) แล้วย้ายพร้อมกันได้
- [x] **Mixer panel** (`panels-ui.js`) เรียงช่องตามลำดับแทร็กใหม่ทันที และลาก strip ใน Mixer เพื่อสลับลำดับได้เหมือนกัน
- [x] การย้ายต้องไม่ทำให้ routing / sends / sidechain / automation / สี / freeze / ค่าอื่นของแทร็กเสีย (อ้างอิงด้วย `t.id` ไม่ใช่ index) · ลำดับใหม่บันทึกลง `.asession`, Autosave, Versions และส่งออก FCP XML ตามลำดับใหม่
- [x] **Undo/Redo** ได้ทุกครั้ง (หนึ่งการลาก = หนึ่งขั้น)
- [x] เสียงที่เล่นสดและมิกซ์ดาวน์ต้องเหมือนเดิมทุกประการหลังสลับลำดับ

### 11.2 ลำดับคลิปที่ซ้อนกัน (Clip stacking)
- [x] คลิกขวาคลิป / เมนู Clip: **Bring Clip to Front** และ **Send Clip to Back** (เหมือน Audition) — คลิปที่อยู่ด้านหน้าคือเสียงที่ได้ยินในช่วงที่ทับกัน
- [x] ทำงานร่วมกับนโยบาย Overlapping Clips ที่มีอยู่: โหมด **Overlap (crossfade)** — สลับว่าคลิปไหนอยู่บน แล้วคำนวณ crossfade ใหม่ · โหมด **Overwrite** — ส่วนที่ถูกบังไม่ถูกลบทิ้งถาวร (เก็บไว้ ดึงกลับได้เมื่อย้ายคลิปที่บังออกหรือ Send to Back)
- [x] วาดคลิปด้านหน้าทับคลิปด้านหลังบนไทม์ไลน์ให้เห็นชัด (คลิปด้านหลังแสดงจางในส่วนที่ถูกบัง)
- [x] ลำดับเก็บใน `.asession` (ฟิลด์ใหม่พร้อม migrate เซสชันเก่า) · Undo ได้ · live = offline
- [x] เทสต์: `tests/clips.test.js` (ย้ายแทร็กแล้ว routing/sends ยังถูก, มิกซ์ดาวน์ก่อน-หลังสลับเท่ากัน, Bring to Front เปลี่ยนเสียงในช่วงทับ, Undo กลับได้, เปิดเซสชันเก่าได้) และ scenario ใน `tests/app/` สำหรับการลากหัวแทร็ก

> หมายเหตุ (ข้อ 11): คีย์ลัดเริ่มต้น Alt+Shift+↑/↓/Home/End — Adobe Audition ไม่มีคีย์ลัดเริ่มต้นของคำสั่งย้ายแทร็ก พรีเซ็ต Audition จึงใช้ค่าเดียวกัน · โหมด Overlap: ช่วงที่เป็น crossfade อัตโนมัติยังผสมสองคลิป ลำดับคลิปมีผลกับส่วนที่บังกันจริง (คลิปซ้อนกลางคลิป หรือเมื่อปิด crossfade) · Overwrite ไม่ตัดคลิปแล้ว แต่ punch-in recording ยังตัดของเดิมจริง (ตั้งใจให้แทนที่) · เซสชันเก่าเปิดมาโดยปิดการบัง (เสียงเหมือนเดิม) จนกว่าจะใช้ Bring/Send หรือ Overwrite · scenario อยู่ที่ tests/app/71-layers.scenario.js

## 12. สร้างตัวติดตั้งใหม่และตรวจสุดท้าย

> ทำแล้ว 3 พ.ย. 2026 พร้อมข้อ A6 ของ `PROMPT_FIX_AUDIT_2026-11-02.md` (เวอร์ชัน 2.1.0 แทน 1.1.0 ที่วางแผนไว้เดิม)

- [x] อัปเดต `version` ใน `package.json` เป็น `2.1.0` และหน้า About (อ่านจาก `app.getVersion()`)
- [x] `npm test` ผ่านทั้งหมด (0 failed) → `npm run dist` → `dist/AudioStage Setup 2.1.0.exe`
- [x] ตรวจใน `dist/win-unpacked/AudioStage.exe` (เปิดได้ ไม่มี error ใน log; ฟีเจอร์ตรวจด้วยเทสต์ในแอปจริงก่อน build — ปุ่ม Install VST Support ในตัวที่แพ็กแล้วยังไม่ได้กดจริงเพราะจะดาวน์โหลด Python) (หรือรัน selftest กับตัวที่แพ็กแล้ว): เปิดแอปได้ไม่มี error, ฟีเจอร์ล่าสุดทุกอย่าง (Spectral, Favorites, Metering, Surround, CD Layout, XML และข้อ 1–11) อยู่ครบ, ปุ่ม Install VST Support ทำงานในตัวที่แพ็กแล้ว
- [x] สรุปท้ายไฟล์นี้: ทำอะไรไปบ้าง, อะไรทำไม่ได้และเพราะอะไร, ไลบรารีใหม่และสัญญาอนุญาตของแต่ละตัว

---

## สรุปข้อ 12 (3 พ.ย. 2026)

- เวอร์ชัน 2.1.0: About / คู่มือ / ตัวติดตั้งใช้เลขจาก `package.json` · ตัวติดตั้งเก่า (1.0.0, 2.0.0) ย้ายไป `dist/old/`
- ไม่มีไลบรารีใหม่ — ZIP ของ `.asession` รูปแบบ 4, การเขียนไฟล์แบบ atomic และ backup ระหว่างอัดเขียนเองในโปรเจกต์ · `lamejs` (LGPL-3.0) ย้ายเป็น devDependency เพราะแอปใช้ไฟล์ `app/vendor/lame.min.js` (ใส่ `app/vendor/lame.LICENSE.txt`) · electron-updater (MIT) ยังอยู่ แต่ปิดเพราะไม่มี `build.publish` (อัปเดตผ่าน BYS All Stages Launcher)
- license ของโปรเจกต์: `UNLICENSED` (Copyright (c) BYS & RB. All rights reserved by BYS & RB)
- รายละเอียดการแก้ทั้งหมดอยู่ท้าย `PROMPT_FIX_AUDIT_2026-11-02.md`
