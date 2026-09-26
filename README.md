# Pasut Collection

เว็บไซต์ static + แก้ไขเองได้จริง 3 หน้า (ประมวลภาพ / สื่อนวัตกรรม / คำสั่งมอบหมายงาน) ผ่าน Google Apps Script — หน้าอื่น ๆ ยังเป็น static ล้วน โหลดเร็วเหมือนเดิม ไม่ง้อ backend

## ไฟล์ในโฟลเดอร์นี้

```
index.html          หน้าแรก
personal.html        ข้อมูลส่วนตัว
teaching.html         ข้อมูลการสอน
pa.html              ผลการปฏิบัติงานตามข้อตกลง (PA) — หน้ารวม
daan1.html           ด้านที่ ๑ การจัดการเรียนรู้
daan2.html           ด้านที่ ๒ การส่งเสริมและสนับสนุนการจัดการเรียนรู้
daan3.html           ด้านที่ ๓ การพัฒนาตนเองและวิชาชีพ
gallery.html         ประมวลภาพการทำกิจกรรม — แก้ไขเองได้
media.html           สื่อนวัตกรรม — แก้ไขเองได้
orders.html          คำสั่งมอบหมายงาน — แก้ไขเองได้
style.css            สไตล์ชีตเดียว ใช้ร่วมกันทุกหน้า
config.js            ที่เก็บลิงก์ Apps Script (ต้องตั้งค่าเอง ดูด้านล่าง)
edit.js              สคริปต์ฝั่งหน้าเว็บ ทำหน้าที่แสดง/แก้ไขรายการใน 3 หน้าข้างต้น
images/              รูปภาพที่ใช้ตอนสร้างเว็บครั้งแรก
data/                ฐานข้อมูลจริงของ 3 หน้าที่แก้ไขได้ (ไฟล์ .json ธรรมดา)
apps-script/Code.gs  โค้ด backend ที่ต้องเอาไป deploy บน script.google.com
```

## ทำไมถึงเร็ว

หน้า gallery/media/orders **ไม่ได้** ไปดึงข้อมูลจาก Apps Script ทุกครั้งที่มีคนเข้าดู — ดึงจากไฟล์ `data/*.json` ซึ่งเป็นไฟล์ static ธรรมดาอยู่ข้าง ๆ กัน โหลดเร็วเท่าไฟล์ HTML ปกติ Apps Script จะถูกเรียกก็ต่อเมื่อ**คุณ**กดบันทึกตอนแก้ไขเท่านั้น (ช้าหน่อยตอนกดบันทึกไม่เป็นไร เพราะเป็นแค่คุณคนเดียว)

## ตั้งค่าระบบแก้ไข (ทำครั้งเดียว)

### 1. สร้าง GitHub Token ให้ Apps Script ใช้เขียนไฟล์แทนคุณ
ใช้ **fine-grained token** แบบจำกัดสิทธิ์เฉพาะ repo นี้ (ปลอดภัยกว่า classic token แบบ scope `repo` ซึ่งจะให้สิทธิ์เขียน/ลบได้ทุก repo ในบัญชี — ไม่ควรใช้ เพราะลิงก์ Apps Script ด้านล่างเป็นลิงก์สาธารณะ ถ้า PIN หลุดจะกระทบแค่ repo นี้ ไม่ลามไป repo อื่น):

1. ไปที่ https://github.com/settings/personal-access-tokens/new
2. **Repository access** → เลือก **Only select repositories** → เลือก `Pasut-Collection` เท่านั้น
3. **Permissions → Repository permissions → Contents** → เปลี่ยนเป็น **Read and write** (permission อื่นปล่อย No access ทั้งหมด)
4. Generate token → copy เก็บไว้ (ต่างจาก token ที่ใช้ตอน push โค้ดจากเครื่อง สร้างแยกกัน)

### 2. Deploy Apps Script
1. เปิด https://script.google.com → New project
2. ลบโค้ดเปล่าเดิมออก แล้ววางเนื้อหาทั้งหมดจากไฟล์ `apps-script/Code.gs` ในโฟลเดอร์นี้ลงไปแทน
3. กดไอคอนเฟือง **Project Settings** → เลื่อนลงหา **Script Properties** → Add script property 2 อัน:
   - `GITHUB_TOKEN` = token จากข้อ 1
   - `EDIT_PIN` = รหัสที่คุณจะใช้ตอนกดแก้ไขเว็บ — ตั้งให้ยาวหน่อย (8 ตัวขึ้นไป ผสมตัวอักษร/ตัวเลข) เพราะลิงก์ Apps Script เป็นลิงก์สาธารณะ ใครก็เห็นได้จากซอร์สโค้ด `config.js`
4. กลับไปแท็บ Editor → มุมขวาบน **Deploy → New deployment**
5. กดไอคอนเฟืองข้าง "Select type" → เลือก **Web app**
6. Execute as: **Me** / Who has access: **Anyone** → **Deploy**
7. อนุญาต permission ตามที่ Google ถาม (อันนี้ปกติ เพราะสคริปต์ต้องขอสิทธิ์เข้าถึง Drive กับยิง request ออกไปหา GitHub)
8. คัดลอกลิงก์ที่ได้ (ลงท้ายด้วย `/exec`)

### 3. ตั้งค่าในเว็บ
เปิดไฟล์ `config.js` แก้บรรทัด:
```js
const APPS_SCRIPT_URL = "PASTE_YOUR_APPS_SCRIPT_URL_HERE";
```
เป็นลิงก์ที่ copy มาจากข้อ 2.8 แล้ว commit + push ขึ้น GitHub อีกที

หลังจากนี้เปิดเว็บ (gallery/media/orders หน้าไหนก็ได้) จะเห็นปุ่ม **"แก้ไขหน้านี้"** มุมล่างขวา กดแล้วใส่ PIN ที่ตั้งไว้ตอน 2.3 ครั้งแรกครั้งเดียว เครื่อง/เบราว์เซอร์นั้นจะจำให้

## วิธีแก้ไขเนื้อหาหน้าอื่น (ที่ยัง static)

`index.html`, `personal.html`, `teaching.html`, `pa.html`, `daan1-3.html` ยังเป็น static ธรรมดา แก้ไขข้อความ/ลิงก์ได้ตรง ๆ ในไฟล์ .html ด้วยโปรแกรมแก้ไขข้อความ หรือแก้ผ่านหน้าเว็บ GitHub เอง (ไอคอนดินสอ "Edit this file")

## วิธีเผยแพร่ผ่าน GitHub Pages

1. push ไฟล์ทั้งหมดในโฟลเดอร์นี้ขึ้น repo บน GitHub (ทำไปแล้วถ้าเห็น README นี้บน GitHub)
2. ไปที่ repo → Settings → Pages → Source เลือก branch `main` โฟลเดอร์ `/ (root)` → Save
3. รอสักครู่ เว็บจะขึ้นที่ `https://<username>.github.io/<repo>/`
