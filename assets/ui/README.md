# assets/ui/

Đặt các icon UI nhỏ (phase, thắng/thua, avatar) vào đây với ĐÚNG tên file:

| Tên file                  | Dùng ở đâu                                  | Kích thước gợi ý |
|------------------------------|-----------------------------------------------|-------------------|
| `icon-night.png`             | Cạnh chữ "ĐÊM x" trên Phase Banner             | 64×64, nền trong suốt |
| `icon-day.png`               | Cạnh chữ "NGÀY x" trên Phase Banner            | 64×64, nền trong suốt |
| `icon-lobby.png`             | Cạnh chữ "Phòng chờ"                          | 64×64, nền trong suốt |
| `icon-ended.png`             | Cạnh chữ "KẾT THÚC"                           | 64×64, nền trong suốt |
| `victory-werewolf.png`       | Màn thắng — phe Sói thắng                     | 256×256, nền trong suốt |
| `victory-village.png`        | Màn thắng — phe Dân thắng                     | 256×256, nền trong suốt |
| `victory-lovers.png`         | Màn thắng — Cặp Đôi thắng                      | 256×256, nền trong suốt |
| `victory-flute.png`          | Màn thắng — Thổi Sáo thắng                     | 256×256, nền trong suốt |
| `default-avatar.png`         | Avatar mặc định cho mọi người chơi (nếu muốn dùng ảnh thay chữ cái đầu tên) | 128×128, vuông |

**Quan trọng — quy tắc icon "chỉ 1, không lặp" (đã sửa bug ở UI Phase 2):**
Mỗi icon (phase/role/thắng-thua) giờ chỉ có **1 nguồn hiển thị duy nhất**:
- Nếu file ảnh tồn tại đúng tên → hiện ảnh.
- Nếu CHƯA có ảnh → tự hiện emoji tương ứng thay thế (🌙/☀️/🐺/🏠/...).
- KHÔNG BAO GIỜ hiện cả ảnh và emoji cùng lúc.

→ Bạn có thể thêm ảnh dần, từng file một, không cần đủ hết một lúc. Thiếu file nào thì chỗ đó vẫn đẹp với emoji, không vỡ layout, không lỗi.
