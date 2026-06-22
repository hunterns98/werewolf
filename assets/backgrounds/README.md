# assets/backgrounds/

Đặt ảnh nền vào đây với ĐÚNG tên file sau (game tự nhận, không cần sửa code):

| Tên file                | Dùng khi nào                          | Kích thước gợi ý      |
|--------------------------|----------------------------------------|------------------------|
| `night.jpg`              | Phase ĐÊM (body có class `.night`)     | 1080×1920 (dọc, full màn hình điện thoại) |
| `day.jpg`                | Phase NGÀY / Lobby / Kết thúc (body có class `.day`) | 1080×1920 |

Gợi ý nội dung ảnh:
- `night.jpg`: làng cổ tích dưới ánh trăng, tối, có thể có sương mù — vì có lớp phủ tối (overlay) đè lên nên ảnh không cần quá tối từ đầu.
- `day.jpg`: làng vào sáng sớm/hoàng hôn ấm áp, tránh ảnh quá sáng/trắng vì chữ trắng sẽ khó đọc (đã có overlay hỗ trợ nhưng đừng chọn ảnh quá chói).

Nếu CHƯA có ảnh: game vẫn chạy bình thường, tự hiển thị gradient nền thay thế (không bị lỗi, không hiện icon ảnh vỡ).

Định dạng: `.jpg` hoặc `.png` đều được, nhưng nên dùng `.jpg` để file nhẹ hơn (ảnh nền load trên điện thoại, mạng có thể chậm khi tụ tập đông người dùng chung wifi).
