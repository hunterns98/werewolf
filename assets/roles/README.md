# assets/roles/

Đặt icon từng vai trò vào đây với ĐÚNG tên file (khớp với mã vai trò trong game, game tự nhận):

| Tên file               | Vai trò       | Emoji fallback (nếu chưa có ảnh) |
|--------------------------|---------------|------------------------------------|
| `werewolf.png`           | Ma Sói        | 🐺 |
| `seer.png`                | Tiên Tri      | 🔮 |
| `witch.png`               | Phù Thủy      | 🧪 |
| `guardian.png`            | Bảo Vệ        | 🛡️ |
| `cupid.png`               | Cupid         | 💘 |
| `villager.png`            | Dân Làng      | 👤 |
| `hunter.png`              | Thợ Săn       | 🏹 |
| `elder.png`               | Già Làng      | 👴 |
| `flute_player.png`        | Thổi Sáo      | 🎶 |
| `thief.png`               | Ăn Trộm       | 🃏 |
| `traitor.png`             | Phản Bội      | 🕵️ |
| `cursed_wolf.png`         | Sói Nguyền    | 🌀 |
| `wild_child.png`          | Con Hoang     | 👩 |

Kích thước gợi ý: 128×128, nền PNG trong suốt, icon đơn giản/rõ vì sẽ hiện rất nhỏ (~20-28px) cạnh tên vai trò, và hiện lớn (~88px) ở màn Reveal Role.

**Quy tắc icon "chỉ 1, không lặp":** mỗi vai trò chỉ hiện ĐÚNG 1 icon — ảnh nếu có, emoji fallback ở cột trên nếu chưa có ảnh. Không bao giờ hiện cả 2 cùng lúc. Bạn có thể thêm icon dần từng vai trò một, không cần đủ hết một lúc.

> Lưu ý: nếu sau này có vai trò mới với mã khác (ví dụ thêm role "sói_tiên_tri"), chỉ cần thêm icon đúng tên file mã đó vào đây (và 1 dòng emoji fallback tương ứng trong `game.js` nếu muốn).
