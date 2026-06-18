# 🐺 Ma Sói Web App — 11 Người Chơi

Game Ma Sói (Werewolf) realtime chạy trên Firebase Firestore, dành cho 1 quản trò (Admin) + 11 người chơi.

## 📁 Cấu trúc project

```
maso-game/
├── admin.html             # Giao diện quản trò
├── index.html             # Giao diện người chơi
├── styles.css             # CSS dùng chung
├── firebase.js            # Config & khởi tạo Firebase
├── game.js                # Logic thuần (core rules) — KHÔNG đụng UI
├── admin.js               # Controller cho admin.html
├── player.js               # Controller cho index.html
├── firestore.rules.txt    # Gợi ý Security Rules
└── assets/                # (tự thêm) file âm thanh start.mp3, night.mp3, day.mp3, death.mp3
```

## 🚀 Bước 1: Tạo Firebase Project

1. Vào https://console.firebase.google.com → **Add project** → đặt tên (ví dụ `maso-game`)
2. Vào **Build → Firestore Database** → **Create database** → chọn **Start in test mode** → chọn vùng (ví dụ `asia-southeast1`)
3. Vào **Project settings** (icon bánh răng) → tab **General** → cuộn xuống **Your apps** → bấm icon Web `</>` → đặt tên app → **Register app**
4. Copy đoạn `firebaseConfig` hiện ra (dạng `{ apiKey: "...", authDomain: "...", ... }`)

## 🔧 Bước 2: Dán config vào project

Mở file `firebase.js`, tìm đoạn:

```js
const FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  ...
};
```

→ Thay toàn bộ bằng config bạn vừa copy ở Bước 1.

## 🎵 Bước 3 (tùy chọn): Thêm âm thanh

Tạo thư mục `assets/` (đã có sẵn) và thêm 4 file:
- `assets/start.mp3` — âm thanh khi bắt đầu game
- `assets/night.mp3` — âm thanh chuyển sang đêm
- `assets/day.mp3` — âm thanh chuyển sang ngày
- `assets/death.mp3` — âm thanh khi có người chết / game kết thúc

Nếu không có file, app vẫn chạy bình thường (lỗi audio sẽ được bỏ qua âm thầm).

## 🌐 Bước 4: Chạy thử local

Vì dùng ES Modules (`type="module"`), bạn **không thể** mở file `.html` trực tiếp bằng double-click (lỗi CORS). Cần chạy qua local server, ví dụ:

```bash
# Cách 1: dùng Python (có sẵn trên hầu hết máy)
cd maso-game
python3 -m http.server 8080
# Mở http://localhost:8080/admin.html và http://localhost:8080/index.html

# Cách 2: dùng VS Code Live Server extension
# Cách 3: dùng npx serve
npx serve .
```

## ☁️ Bước 5: Deploy lên GitHub Pages

1. Tạo repo GitHub mới, push toàn bộ project lên
2. Vào **Settings → Pages** → chọn branch `main` / folder `root` → Save
3. Sau vài phút, app sẽ live tại `https://<username>.github.io/<repo>/admin.html`

## 🎮 Cách chơi

### Admin (quản trò)
1. Mở `admin.html` → bấm **"➕ Tạo phòng mới"** → có mã phòng (ví dụ `AB12`)
2. Đọc mã phòng cho 11 người chơi
3. Khi đủ 11 người vào phòng (xem ở danh sách), bấm **"▶️ START GAME"**
4. Lần lượt làm theo từng bước hành động đêm hiện ra (Cupid → Bảo Vệ → Sói → Tiên Tri → Phù Thủy), chọn người và bấm xác nhận
5. Sau khi xong hết các bước, hệ thống tự tính toán và chuyển sang Ngày
6. Ban ngày: người chơi tự vote trên điện thoại, admin xem kết quả realtime, bấm **"➡️ KẾT THÚC VOTE & CHUYỂN ĐÊM"** khi đã chốt
7. Game tự kết thúc khi có team thắng (Sói / Dân làng / Cặp đôi)

### Người chơi
1. Mở `index.html` trên điện thoại → nhập mã phòng + tên → **Vào phòng**
2. Chờ admin bắt đầu → xem vai trò của mình hiện ra
3. Ban đêm: ngồi im, nói nhỏ hành động của mình cho admin (UI hiện tại không cho người chơi tự bấm hành động đêm trên điện thoại — **mọi hành động đêm đều do Admin nhập hộ trên admin.html** theo lời người chơi nói, đúng kiểu chơi truyền thống có quản trò ngồi giữa)
4. Ban ngày: bấm chọn người để vote ngay trên điện thoại
5. Nếu chết: màn hình hiện "YOU ARE DEAD", vẫn xem được log công khai

## ⚠️ Lưu ý quan trọng về luật chơi đã implement

- **Cupid**: chỉ hoạt động đêm 1, ghép 2 người thành lovers. Nếu 1 người chết (bất kỳ nguyên nhân: sói/độc/vote) → người còn lại **chết theo ngay**.
- **Witch**: 1 lọ cứu + 1 lọ độc, mỗi loại dùng đúng 1 lần cho **cả game** (không phải mỗi đêm).
- **Guardian**: bảo vệ 1 người/đêm, nếu đúng người sói cắn → người đó sống.
- **Vote ngày hòa phiếu cao nhất** → không ai chết.
- **Điều kiện thắng**: Sói thắng khi số sói còn sống ≥ số dân còn sống; Dân thắng khi hết sói; Cặp đôi thắng khi chỉ còn 2 người sống và cả 2 là lovers.

## 🛠️ Kiến trúc 3-layer (để dễ maintain/mở rộng)

1. **`game.js`** — "bộ não": toàn bộ hàm tính toán thuần, không đụng DOM/Firebase. Dùng chung cho admin & player.
2. **`admin.js`** — "ra lệnh": đọc input từ UI admin → gọi hàm trong `game.js` → ghi kết quả vào Firestore. Không tự bịa logic riêng.
3. **`player.js`** — "chỉ đọc": lắng nghe Firestore qua `onSnapshot`, hiển thị state, chỉ gửi vote vào field riêng `dayVotes.{myId}` để tránh ghi đè dữ liệu người khác.

## 🔮 Hướng mở rộng (chưa làm trong bản này)

- Auto timer cho từng phase (đếm ngược ngày/đêm)
- Text-to-speech đọc lời dẫn truyện
- QR code để join phòng nhanh hơn
- Cho vai trò đặc biệt tự bấm hành động trên điện thoại riêng (hiện tại admin nhập hộ tất cả — đơn giản, dễ kiểm soát, nhưng cần admin lắng nghe người chơi nói)
