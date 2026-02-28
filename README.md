# SPADA UPNYK Mobile App 🚀

Aplikasi *mobile unofficial* berbasis WebView pintar untuk mengakses SPADA UPN "Veteran" Yogyakarta secara jauh lebih cepat, modern, dan responsif. Aplikasi ini dibangun dengan framework **Capacitor**, **Vite**, dan murni **HTML/CSS/Vanilla JS**.

## ✨ Fitur Utama
*   **Dashboard & Statistik Terpusat**: Lihat ringkasan SKS, jumlah mata kuliah, dan tugas aktif langsung dari satu layar.
*   **Auto-Login & Sesi Cepat**: Login sekali, akses berkali-kali tanpa perlu terus-menerus memasukkan kredensial Moodle.
*   **Manajemen Tugas (Smart Assigment)**: 
    *   Tugas diurutkan otomatis dari tenggat waktu (deadline) terdekat hingga terlama.
    *   Pengumpulan tugas *in-app* (langsung dari aplikasi, mendukung kirim file maupun teks).
*   **Sistem Absensi Sekali Klik**:
    *   Buka mata kuliah untuk melihat semua jadwal absensi selama satu semester penuh.
    *   Klik **"✅ Hadir"** untuk absen langsung dari dalam aplikasi tanpa perlu login browser.
    *   Otomatis *sorting* berdasarkan ID perkuliahan dan urutan tanggal sesi (kronologis waktu).
*   **Push Notifications (Pengingat Deadline)**: 
    *   Aplikasi memeriksa Moodle di latar belakang dan memunculkan notifikasi ponsel ketika ada tenggat waktu tugas yang kurang dari 24 jam.
*   **Latar Belakang Kosmik Modern**: Desain antarmuka (UI) gelap moderen ala astronomi/aurora beralih dari bawaan Moodle standar.

---

## 🛠️ Teknologi yang Digunakan
1.  **[Capacitor](https://capacitorjs.com/)**: Mengubah kode Web menjadi aplikasi Android asli (APK) yang berinteraksi dengan API ponsel (seperti Push Notification local).
2.  **[Vite](https://vitejs.dev/)**: *Bundler* front-end super cepat untuk lingkungan *development* dan pemrosesan *production build*.
3.  **HTML5 & CSS3 Vanilla**: Tanpa framework UI yang berat, menggunakan variabel CSS kustom untuk merender UI yang sangat responsif.
4.  **JavaScript (ES6+)**: Logika bisnis dan perantara (*crawler/scraper* HTML) antara aplikasi ponsel dan sistem lama SPADA Moodle UPNYK.

---

## 🚀 Cara Menjalankan Secara Lokal (Development)

Pastikan kamu memiliki **Node.js** dan **Android Studio** ter-install di komputermu.

### 1. Klon Repo Ini
```bash
git clone https://github.com/Dhani2612/spadaupn-app.git
cd spadaupn-app
```

### 2. Konfigurasi Variabel Lingkungan (.env)
Aplikasi ini membutuhkan akses login kampusmu untuk mengambil data (scrapping).
*   Ganti nama file `.env.example` di luar (root directory) menjadi `.env`
*   Isi kredensial spesifikmu:
```env
SPADA_BASE_URL=https://spada.upnyk.ac.id
SPADA_USERNAME=nim_kamu_di_sini
SPADA_PASSWORD=password_spada_kamu
```

### 3. Install Dependensi 
```bash
npm install
```

### 4. Jalankan Server Development Terlokal (Browser Run)
```bash
npm run dev
```

### 5. Bangun (Build) ke Aplikasi Android Asli (APK)
Gunakan *command* Capacitor untuk mensinkronkan basis *web-code* ke dalam native SDK Android Studio.
```bash
npx vite build
npx cap sync android
npx cap open android
```
Dari dalam Android Studio, kamu bebas untuk mengklik **Run (Shift+F10)** ke emulator atau colokkan HP aslimu dengan Mode Debug USB (*Developer Options*) menyala, dan Build APK nya ("Build -> Build Bundle/APK -> Build APKs").

---

## ⚠️ Diskusi / Peringatan
Proyek ini **bukan aplikasi resmi** dari kampus UPN "Veteran" Yogyakarta atau admin terkait, melainkan sekadar bentuk penuangan karya *front-end* mahasiswa untuk membangun kapabilitas portfolio pemrograman web-to-mobile wrapper. Gunakan aplikasi ini secara bijaksana dan bertanggung jawab. Data mahasiswa diamankan semata-mata di perangkat (*device storage/local config*) pemakai.
