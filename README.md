# Pasut Collection

เว็บไซต์ static ล้วน (ไม่มี backend) — เปิดได้จาก `index.html` ตรง ๆ หรือโฮสต์ฟรีผ่าน GitHub Pages

## ไฟล์ในโฟลเดอร์นี้

```
index.html        หน้าแรก
personal.html      ข้อมูลส่วนตัว
teaching.html       ข้อมูลการสอน
pa.html            ผลการปฏิบัติงานตามข้อตกลง (PA) — หน้ารวม
daan1.html         ด้านที่ ๑ การจัดการเรียนรู้
daan2.html         ด้านที่ ๒ การส่งเสริมและสนับสนุนการจัดการเรียนรู้
daan3.html         ด้านที่ ๓ การพัฒนาตนเองและวิชาชีพ
gallery.html       ประมวลภาพการทำกิจกรรม
media.html         สื่อนวัตกรรม
orders.html        คำสั่งมอบหมายงาน
style.css          สไตล์ชีตเดียว ใช้ร่วมกันทุกหน้า
images/            รูปภาพทั้งหมด
```

## วิธีแก้ไขเนื้อหา

ไฟล์เป็น HTML ธรรมดา แก้ไขข้อความ/ลิงก์ได้ตรง ๆ ในไฟล์ .html แต่ละไฟล์ด้วยโปรแกรมแก้ไขข้อความ (หรือแก้ผ่านหน้าเว็บ GitHub เองก็ได้ — เข้าไฟล์ในเว็บ GitHub แล้วกดไอคอนดินสอ "Edit this file")

เพิ่มรูปใหม่: อัปโหลดไฟล์รูปเข้าโฟลเดอร์ `images/` แล้วอ้างอิงด้วย `<img src="images/ชื่อไฟล์.jpg">`

หน้า **gallery.html**, **media.html**, **orders.html** ใช้โครงสร้างการ์ดซ้ำ ๆ (คลาส `.gcard`) คัดลอกบล็อกเดิมวางต่อแล้วแก้รูป/ข้อความได้เลย เช่น

```html
<div class="gcard">
  <div class="photo"><img src="images/ชื่อไฟล์.jpg" alt="คำอธิบายภาพ"></div>
  <div class="body"><div class="sub">คำบรรยายภาพ</div></div>
</div>
```

## วิธีเผยแพร่ผ่าน GitHub Pages

1. สร้าง repository ใหม่บน GitHub (หรือใช้ repo เดิม)
2. อัปโหลดไฟล์ทั้งหมดในโฟลเดอร์นี้ขึ้น repo (ทั้ง .html, style.css, และโฟลเดอร์ images/) — หรือใช้คำสั่ง:
   ```bash
   git init
   git add .
   git commit -m "Pasut Collection website"
   git branch -M main
   git remote add origin https://github.com/<username>/<repo>.git
   git push -u origin main
   ```
3. ไปที่ repo บน GitHub → Settings → Pages → เลือก Source เป็น branch `main` โฟลเดอร์ `/ (root)` → Save
4. รอสักครู่ เว็บจะขึ้นที่ `https://<username>.github.io/<repo>/`

## หมายเหตุ

เว็บไซต์เวอร์ชันนี้เป็น static — แก้ไขต้องแก้ไฟล์แล้ว push ใหม่ (ไม่มีปุ่มแก้ไขในเว็บแบบเวอร์ชัน Claude Artifact) เหมาะสำหรับแชร์ต่อสาธารณะเพราะไม่ต้องล็อกอิน ไม่มีข้อจำกัดเรื่ององค์กร
