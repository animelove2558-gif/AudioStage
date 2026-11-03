# AudioStage — รองรับ Linux (แผนเสริม แยกจากงานหลัก)

> **วิธีใช้:** ทำ **หลังจาก** `ROADMAP-MISSING.md` เสร็จแล้วเท่านั้น เปิด Claude Code ในโฟลเดอร์ `AudioStage` แล้วพิมพ์
> `อ่าน ROADMAP-LINUX.md ให้ครบ แล้วทำทุกข้อตามลำดับ ทำเสร็จแต่ละข้อให้รัน npm test และติ๊ก [x] ในไฟล์นี้`
>
> **ห้ามทำให้ฝั่ง Windows เสีย** — ทุกการเปลี่ยนแปลงต้องแยกตาม `process.platform` และ `npm run dist` (Windows) ต้องได้ผลเหมือนเดิม

---

## กฎ

1. ใช้กฎเดียวกับ `ROADMAP-AUDITION-PLUS.md` / `ROADMAP-MISSING.md` (ฟรี 100%, ออฟไลน์ได้, vanilla JS, มีเทสต์, Undo ได้, README ภาษาไทย)
2. เป้าหมายหลัก: **Ubuntu 22.04 / 24.04 LTS x64** (และ Debian/Linux Mint ที่ใช้ `.deb` ได้) · รองรับดิสโทรอื่นผ่าน **AppImage**
3. ของที่เป็น GPL บน Linux (เช่น `espeak-ng`, ffmpeg, pedalboard) ให้ใช้ของที่ผู้ใช้ติดตั้งจากตัวจัดการแพ็กเกจของระบบ หรือดาวน์โหลดแยกลง userData — ไม่รวมในโค้ดโปรเจกต์
4. ถ้าข้อไหนทำบน Linux ไม่ได้จริง ให้ซ่อนเมนูนั้นบน Linux และเขียนเหตุผลไว้ใต้ข้อ ห้ามมีปุ่มหลอก

---

## 1. สร้างตัวติดตั้ง Linux

- [ ] เพิ่ม `build.linux` ใน `package.json`: target **AppImage** และ **deb** (x64), `category: "AudioVideo;Audio;AudioVideoEditing"`, ไอคอนจาก `build/icon.png` (เตรียมขนาด 16–512 px ใน `build/icons/` ถ้าจำเป็น), `maintainer`, `synopsis`, `description`
- [ ] สคริปต์ใหม่ `"dist:linux": "electron-builder --linux"` (คง `"dist"` ของ Windows ไว้เหมือนเดิม) และ `"dist:all"` ถ้าสร้างข้ามแพลตฟอร์มได้ — ถ้าสร้าง Linux จาก Windows ไม่ได้ ให้เขียนวิธีสร้างผ่าน **WSL2 (Ubuntu)** หรือ **GitHub Actions** (ฟรี) ไว้ใน README และเพิ่ม workflow `.github/workflows/build.yml` ที่สร้างทั้ง Windows และ Linux
- [ ] ไฟล์ `.desktop` ถูกต้อง (ชื่อ, ไอคอน, `MimeType` ของไฟล์เสียงและ `application/x-audiostage-session`) ให้แอปขึ้นในเมนูแอปพลิเคชันและ "Open With"
- [ ] ลงทะเบียน MIME type ของ `.asession` (ไฟล์ XML ของ shared-mime-info ใน `.deb`) และไอคอนไฟล์

## 2. ตรวจโค้ดส่วนที่ผูกกับ Windows

- [ ] ไล่ `main.js`, `electron/*.js`, `tools/vst/*` และไฟล์ที่เพิ่มจาก ROADMAP-MISSING หาโค้ดที่ใช้ได้แค่ Windows (path แบบ `C:\`, `.exe`, PowerShell, `windowsHide`, รายการไดรฟ์ A–Z) แล้วทำทางเลือกสำหรับ Linux
- [ ] **Media Browser** บน Linux: แสดง Home, Music, Desktop, Downloads, `/media/$USER` และ `/mnt` (ไดรฟ์ USB/ดิสก์เสริม) แทนรายการไดรฟ์ตัวอักษร
- [ ] โฟลเดอร์ userData / autosave / log อยู่ใต้ `~/.config/AudioStage` ตามมาตรฐาน XDG (Electron ทำให้อยู่แล้ว — ตรวจให้แน่ใจ)
- [ ] ชื่อไฟล์/พาธภาษาไทยและช่องว่างใช้ได้บน Linux (UTF-8)

## 3. เสียงบน Linux

- [ ] ตรวจการเล่น/อัดเสียงผ่าน **PipeWire และ PulseAudio** (Electron/Chromium ใช้ผ่าน PulseAudio API) — เลือกอุปกรณ์เข้า/ออกใน Audio Hardware ได้, ตรวจ latency และ 5.1 surround
- [ ] หน้า Audio Hardware บน Linux: แทนข้อความ ASIO ด้วยคำแนะนำ Linux (PipeWire / JACK ผ่าน `pipewire-jack`) · ไม่ต้องรองรับ JACK โดยตรง
- [ ] ปุ่มวัด latency ทำงานบน Linux

## 4. VST บน Linux

- [ ] `detectPython()` และ `setup.js` บน Linux ใช้ `python3` ของระบบ: ปุ่ม **Install VST Support** บน Linux ให้สร้าง venv ใน `~/.config/AudioStage/vst-runtime/` ด้วย `python3 -m venv` แล้ว `pip install` pedalboard + numpy (ไม่ใช้ Python embeddable ของ Windows)
- [ ] ถ้าเครื่องไม่มี `python3` หรือ `python3-venv` ให้แสดงคำสั่งติดตั้งที่ถูกต้อง เช่น `sudo apt install python3 python3-venv` (มีปุ่มคัดลอกคำสั่ง)
- [ ] สแกนปลั๊กอิน VST3 จาก `~/.vst3`, `/usr/lib/vst3`, `/usr/local/lib/vst3` (มีอยู่แล้ว ตรวจให้ทำงานจริง) · ทดสอบกับปลั๊กอินฟรีที่มีเวอร์ชัน Linux เช่น Dragonfly Reverb, LSP Plugins (`VST3_TEST_PLUGIN`)

## 5. ฟีเจอร์จาก ROADMAP-MISSING ที่ต้องมีเวอร์ชัน Linux

- [ ] **Install ffmpeg**: บน Linux ใช้ ffmpeg ของระบบก่อน ถ้าไม่มีให้แสดง `sudo apt install ffmpeg` (หรือดาวน์โหลด static build ลง userData เป็นทางเลือก)
- [ ] **Generate Speech**: บน Linux ใช้ **`espeak-ng`** (มีเสียงภาษาไทย) หรือ **Piper** (MIT, ออฟไลน์, เสียงดีกว่า — ดาวน์โหลดโมเดลตอนกดใช้ครั้งแรก) เลือกได้ใน Preferences · ถ้าไม่มีให้บอกวิธีติดตั้ง
- [ ] **Recent Files**: บน Linux ไม่มี Jump List — ใช้ `app.addRecentDocument` เท่าที่ระบบรองรับ และรายการในแอป/หน้าต้อนรับ
- [ ] **ดับเบิลคลิกเปิดไฟล์**: ทำงานผ่าน `.desktop` + MIME (ข้อ 1) ทั้งตอนแอปปิดอยู่และเปิดอยู่ (`second-instance`)
- [ ] **อัปเดตอัตโนมัติ**: `electron-updater` รองรับ **AppImage** (ใช้ `latest-linux.yml`) · สำหรับ `.deb` ให้แจ้งว่ามีเวอร์ชันใหม่และเปิดหน้าดาวน์โหลดแทน (ไม่ติดตั้งเอง)
- [ ] **Help > Show Log Files** เปิดโฟลเดอร์ด้วยตัวจัดการไฟล์ของระบบ (`shell.openPath`)

## 6. ทดสอบ

- [ ] `npm test` ผ่านบน Linux (รันใน WSL2 Ubuntu หรือ GitHub Actions `ubuntu-latest`) — scenario ที่ต้องมีหน้าจอให้ใช้ `xvfb-run`
- [ ] เปิด AppImage และติดตั้ง `.deb` บน Ubuntu จริงหรือ VM (VirtualBox ฟรี): เปิดแอป, เปิด/บันทึกไฟล์, อัด/เล่นเสียง, มัลติแทร็ก + สลับเลเยอร์, ส่งออกทุกฟอร์แมต, VST, ffmpeg, Generate Speech, ดับเบิลคลิก `.asession`
- [ ] อัปเดต README (ภาษาไทย): หัวข้อ "ติดตั้งบน Linux" (AppImage: `chmod +x` แล้วรัน · `.deb`: `sudo apt install ./AudioStage_*.deb`), แพ็กเกจเสริมที่แนะนำ (`ffmpeg`, `python3-venv`, `espeak-ng`), ข้อจำกัดที่ต่างจาก Windows
- [ ] สรุปท้ายไฟล์นี้: ทำอะไรไปบ้าง, อะไรยังไม่เหมือน Windows และเพราะอะไร
