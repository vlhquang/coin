# Chạy bot trong trình duyệt

Trang không kết nối Render. Google đăng nhập và Firestore vẫn lưu ví, lịch sử giao dịch, chiến lược và tổng thời gian chạy.

1. Trong Firebase Console, vào Firestore Database > Rules, thay nội dung bằng file `firestore.rules` trong dự án rồi nhấn Publish. Quy tắc mới cho phép chính chủ chuyển dữ liệu từ server về trình duyệt, không cho người khác đọc dữ liệu.
2. Cập nhật code lên GitHub Pages và tải lại trang.
3. Khi đăng nhập lần đầu sau chuyển đổi, dữ liệu cũ được giữ, bot server bị gỡ quyền quản lý tài khoản và chiến lược được tắt. Nhấn Chạy lại để bắt đầu bot trong trình duyệt.
4. Trên Render, đặt `BTC_BOT_ENABLED=false` và deploy lại service karaoke để worker cũ ngừng chạy và không tiếp tục truy vấn Firestore. Không cần xóa service karaoke hoặc khóa Firebase.

Giữ trang mở, mạng ổn định và máy không ngủ. Tab nền có thể bị trình duyệt hạn chế hoặc đình chỉ; không bảo đảm chạy 24/7. Đóng trang ngừng xử lý; khi mở lại, trạng thái đã lưu được khôi phục. Không chạy bot đồng thời trên nhiều tab hoặc thiết bị vì có thể ghi đè dữ liệu.

Đây vẫn là giao dịch mô phỏng, không gửi lệnh mua/bán thật lên sàn.
