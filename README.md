# 🐺 Ma Sói Web App — 8-20 Người Chơi

Game Ma Sói (Werewolf) realtime chạy trên Firebase Firestore, dành cho 1 quản trò (Admin) + 8-20 người chơi.

## 📁 Cấu trúc project

```
maso-game/
├── admin.html             # Giao diện quản trò
├── index.html             # Giao diện người chơi
├── styles.css              # CSS dùng chung
├── firebase.js             # Config & khởi tạo Firebase
├── game.js                 # Logic thuần (core rules) — KHÔNG đụng UI
├── admin.js                # Controller cho admin.html
├── player.js                # Controller cho index.html
├── firestore_rules.txt    # Gợi ý Security Rules
└── assets/                 # (tự thêm) file âm thanh start.mp3, night.mp3, day.mp3, death.mp3
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
2. Đọc mã phòng cho người chơi (8-20 người)
3. Vào **"⚙️ Cài đặt Game"**: chọn **Chế độ hành động đêm** (Admin điều khiển / Người chơi tự bấm) và **Cách chia vai trò** (Tự động cân bằng / Tự chọn vai trò), tick các vai trò tùy chọn muốn dùng
4. Khi đủ người vào phòng (xem ở danh sách), bấm **"▶️ START GAME"**
5. Lần lượt làm theo từng bước hành động đêm hiện ra. Nếu bật **Người chơi tự bấm**, Admin chỉ cần bấm 1 nút **"✅ Xác nhận"** mỗi bước (có thể bấm **"🛠️ Admin thao tác thay"** nếu ai đó bị kẹt)
6. Sau khi xong hết các bước, hệ thống tự tính toán và chuyển sang Ngày
7. Ban ngày: người chơi tự vote trên điện thoại, admin xem kết quả realtime, bấm **"➡️ KẾT THÚC VOTE & CHUYỂN ĐÊM"** khi đã chốt
8. Game tự kết thúc khi có team thắng (Sói / Dân làng / Cặp đôi / Thổi Sáo)
9. Admin có thể theo dõi **"🕵️ Lịch sử bí mật"** (panel riêng) để biết toàn bộ hành động đêm + ngày, kể cả những gì player không thấy

### Người chơi
1. Mở `index.html` trên điện thoại → nhập mã phòng + tên → **Vào phòng**
2. Chờ admin bắt đầu → xem vai trò của mình hiện ra
3. Ban đêm:
   - Chế độ **Admin điều khiển**: ngồi im, nói nhỏ hành động của mình cho admin nhập hộ (kiểu truyền thống)
   - Chế độ **Người chơi tự bấm**: tự bấm chọn hành động ngay trên điện thoại (Sói thấy lựa chọn của đồng đội realtime), Admin chỉ xác nhận để chuyển bước
4. Ban ngày: bấm chọn người để vote ngay trên điện thoại
5. Nếu chết: màn hình hiện "YOU ARE DEAD" — chỉ thấy **"💀 Tên đã chết"**, không biết nguyên nhân; vẫn xem được log công khai
6. Khi game kết thúc: tự động mở khóa **"🎉 Kết quả game"** (vai trò ban đầu/hiện tại/phe của mọi người) và **"📜 Toàn bộ lịch sử trận đấu"** (mọi hành động bí mật từng đêm/ngày)

## ⚠️ Lưu ý quan trọng về luật chơi đã implement

- **Cupid**: chỉ hoạt động đêm 1, ghép 2 người thành lovers. Nếu 1 người chết (bất kỳ nguyên nhân: sói/độc/vote) → người còn lại **chết theo ngay**. Liên kết Cupid là trạng thái riêng (`isLover`/`loverPartnerId`), **không** gắn với role — nên nếu 1 trong 2 bị Sói Nguyền hóa Sói, cặp đôi vẫn được giữ nguyên, vẫn có Couple Chat, vẫn chết theo nhau, và vẫn thắng riêng nếu là 2 người sống sót cuối cùng (bất kể phe).
- **Witch**: 1 lọ cứu + 1 lọ độc, mỗi loại dùng đúng 1 lần cho **cả game** (không phải mỗi đêm).
- **Guardian**: bảo vệ 1 người/đêm, nếu đúng người sói cắn → người đó sống. **Không được bảo vệ cùng 1 người 2 đêm liên tiếp** (đêm trước vừa bảo vệ ai thì đêm này không chọn lại được người đó).
- **Già Làng**: có 2 mạng. Sói cắn lần 1 sống, lần 2 chết. Sói cắn + Phù Thủy độc cùng đêm → chết. Bị vote treo cổ → chết ngay (không có 2 mạng khi vote).
- **Sói Nguyền**: từ đêm thứ 2 trở đi (mọi đêm, không chỉ đêm chẵn), có thể biến 1 người thành Sói — không bị Bảo Vệ/Phù Thủy/Già Làng chặn. Người bị biến mất toàn bộ chức năng vai trò cũ.
- **Con Hoang**: ban đầu phe Dân. Đêm đầu chọn 1 "mẹ nuôi". Mẹ nuôi còn sống → vẫn là Dân. Mẹ nuôi chết (bất kỳ lý do) → hóa Sói ngay, vào Sói Chat, vote cùng Sói, thắng theo phe Sói.
- **Vote ngày hòa phiếu cao nhất** → không ai chết.
- **Điều kiện thắng**: Sói thắng khi số sói còn sống ≥ số dân còn sống; Dân thắng khi hết sói; Cặp đôi thắng khi chỉ còn 2 người sống và cả 2 là lovers (bất kể role hiện tại); Thổi Sáo thắng khi mọi người sống đều bị mê hoặc.
- **Số người chơi**: tối thiểu 8, tối đa 20.

## 🛠️ Kiến trúc 3-layer (để dễ maintain/mở rộng)

1. **`game.js`** — "bộ não": toàn bộ hàm tính toán thuần, không đụng DOM/Firebase. Dùng chung cho admin & player.
2. **`admin.js`** — "ra lệnh": đọc input từ UI admin → gọi hàm trong `game.js` → ghi kết quả vào Firestore. Không tự bịa logic riêng.
3. **`player.js`** — giao diện người chơi: lắng nghe Firestore qua `onSnapshot`, hiển thị state, gửi vote vào `dayVotes.{myId}`. Từ v3.0, khi **Player Action Mode** được bật, player.js cũng ghi trực tiếp các field hành động đêm của riêng vai trò mình vào `nightState.*` (vd: `nightState.werewolf.votes.{myId}`, `nightState.seer.target`...) — admin.js vẫn là nơi DUY NHẤT thực sự "chốt" và tính toán kết quả (gọi lại đúng các hàm trong `game.js`), nên không có 2 luồng logic song song.

## 🆕 Có gì mới ở v3.0

- **Cupid hiển thị đầy đủ**: 2 người yêu biết tên + role hiện tại của nhau (cả khi role đã biến đổi), có Couple Chat, có điều kiện thắng riêng.
- **Ẩn nguyên nhân chết với Player**: chỉ thấy "💀 Tên đã chết", Admin vẫn xem đầy đủ nguyên nhân.
- **Admin Secret History**: panel riêng hiển thị toàn bộ hành động bí mật theo thời gian thực (Round/Phase/Event/Actor/Target/Result).
- **Chat**: chặn người đã chết gửi chat với phe còn sống.
- **Player Action Mode**: người chơi tự bấm hành động đêm (Sói/Tiên Tri/Bảo Vệ/Cupid/Phù Thủy/Ăn Trộm/Thổi Sáo/Sói Nguyền/Con Hoang/Thợ Săn) — Admin chỉ xác nhận để chuyển bước, hoặc có thể "thao tác thay" nếu cần.
- **Sói Player View**: các Sói thấy lựa chọn của nhau realtime trước khi Admin chốt mục tiêu.
- **Con Hoang (Wild Child)**: vai trò mới, hóa Sói khi mẹ nuôi chết.
- **Sói Nguyền**: sửa lại đúng luật — áp dụng từ đêm 2 trở đi (mọi đêm, không chỉ đêm chẵn).
- **Bảo Vệ**: không được bảo vệ trùng người 2 đêm liên tiếp.
- **Role Balance**: chọn giữa Tự động cân bằng hoặc Tự chọn số lượng từng vai trò (Manual).
- **End Game Role Reveal**: hiện vai trò ban đầu / hiện tại / phe của tất cả người chơi.
- **End Game Full Timeline Reveal**: mở khóa toàn bộ lịch sử bí mật trận đấu cho người chơi xem khi game kết thúc.

## 🔮 Hướng mở rộng (chưa làm trong bản này)

- Auto timer cho phase đêm (hiện chỉ có timer cho phase ngày)
- Text-to-speech đọc lời dẫn truyện
- QR code để join phòng nhanh hơn
- Điều kiện thắng riêng cho Phản Bội (Traitor) — hiện vai trò này tồn tại nhưng chưa có win condition riêng
