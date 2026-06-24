# assets/audio/

Đặt file âm thanh vào đây với ĐÚNG tên file (game tự nhận, không cần sửa code):

| Tên file        | Phát khi nào                                              |
|-------------------|-------------------------------------------------------------|
| `night.mp3`       | Vừa chuyển sang phase ĐÊM                                   |
| `day.mp3`         | Vừa chuyển sang phase NGÀY                                  |
| `vote.mp3`        | Vote ban ngày vừa kết thúc (Admin bấm "Kết thúc vote") |
| `death.mp3`       | Có người vừa chết (đêm, vote, hoặc Thợ Săn kéo theo)         |
| `victory.mp3`     | Game kết thúc, có phe thắng                                  |

Quy tắc đã áp dụng (không cần chỉnh):
- **Không autoplay khi vừa load trang** — chỉ phát khi có sự kiện game thật (chuyển phase, vote xong, có người chết, kết thúc game).
- **Không lỗi nếu thiếu file** — `audio.play()` được bọc `try/catch` + `.catch()`, thiếu file hoặc bị điện thoại chặn autoplay thì tự bỏ qua êm, không hiện lỗi gì cả.
- Phát trên CẢ Admin và Player (`admin.js` và `player.js` mỗi bên có hệ thống audio riêng, dùng chung tên file/đường dẫn).

Định dạng: `.mp3` (nhẹ, hầu hết trình duyệt hỗ trợ). Nên để mỗi file dưới 5 giây, âm lượng vừa phải — code đã tự đặt volume ở mức 60% nhưng bạn nên export file gốc không quá to để tránh giật âm khi nhiều người mở cùng lúc trong 1 phòng.
