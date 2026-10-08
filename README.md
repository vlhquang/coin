# BTC Monitor

Bước 3: giá BTC/USDT thật từ Binance và quy tắc giao dịch tự động mô phỏng trên thiết bị.

Google đăng nhập và lưu dữ liệu tài khoản: làm theo `FIREBASE-SETUP.md`, sau đó mở qua GitHub Pages hoặc localhost. Mở file trực tiếp không hỗ trợ Google đăng nhập. Khi chưa cấu hình Firebase, dữ liệu tài khoản bị khóa.

- Giá BTC nhận qua luồng aggTrade Binance và biểu đồ nhận nến WebSocket (1m/15m/1h/4h), gộp vẽ tối đa 4 lần/giây. Không cần API key.
- Tự nối lại WebSocket sau 3 giây khi ngắt; nếu không nhận giá trực tiếp mới, REST dự phòng cập nhật giá và lịch sử mỗi 5 giây. Header phân biệt real-time và dự phòng.
- Luồng trực tiếp chỉ cập nhật biểu đồ ở khoảng hiện tại, không thay đổi lịch sử cũ đang xem.
- Biểu đồ lấy lịch sử nến Binance: 1 giờ (nến 1 phút), 24 giờ (15 phút), 7 ngày (1 giờ), 30 ngày (4 giờ).
- Trục giá tính bằng USDT, thời gian hiển thị theo múi giờ thiết bị. Rê chuột, chạm hoặc dùng phím mũi tên trên biểu đồ để xem giá mở/cao/thấp/đóng tại từng mốc.
- Nút Trước tải khoảng lịch sử trước đó; Về hiện tại trở lại các nến mới nhất. Lịch sử hiện tại tự cập nhật mỗi phút, độc lập với giá đặt lệnh cập nhật mỗi 5 giây.
- Bảng Chi tiết lịch sử giá hiển thị mọi nến trong khoảng đang xem. Dấu * ở giá đóng chỉ nến chưa đóng.
- Khi lỗi kết nối, thử lại sau 10 giây và khóa đặt lệnh. Giá quá 15 giây cũng khóa đặt lệnh.
- Ví bước 2 dùng khóa lưu trữ riêng để không trộn giao dịch theo giá ngẫu nhiên ở bước 1.
- Ví bắt đầu với 10.000 USDT; phí mua và bán là 0,1%.
- Ví và lịch sử lưu trong localStorage của trình duyệt.
- Lãi/lỗ tính theo tổng USDT và giá trị BTC hiện tại, đã phản ánh phí.
- Chưa kết nối sàn hoặc thực hiện lệnh thật; tự động giao dịch chưa triển khai.

## Quy tắc tự động

Phần Bot dùng hai trạng thái: khi tắt hiển thị select chiến lược, mô tả và cấu hình; khi chạy ẩn phần chỉnh sửa và hiển thị cấu hình đã áp dụng cùng điều kiện theo dõi. Dừng khôi phục giao diện chọn/cấu hình. Vốn, phần trăm tiến độ và các mức giá trong điều kiện được làm nổi bật.

Bố cục theo dõi: biểu đồ bên trái, trạng thái/điều kiện chiến lược bên phải trên màn hình rộng; màn hình nhỏ xếp phần bot ngay dưới biểu đồ. Nút Dừng chiến lược dừng mọi lệnh tự động và giữ BTC; nút Chạy lại tiếp tục chiến lược đã áp dụng. Hai nút phản ánh trạng thái đang chạy/dừng, không phụ thuộc chiến lược đang xem bên dưới.

Theo dõi tín hiệu hiển thị điều kiện đã đạt/chưa đạt, tỷ lệ số điều kiện mua đạt (không phải xác suất thắng), vốn/khối lượng mua dự kiến, mức mua cho nến tiếp theo và mức chốt lời/cắt lỗ. Mức mua dự kiến được tính từ các nến đã đóng; không phải lệnh chờ. Khi có vị thế, mức bán tính từ giá mua thực tế. Phần theo dõi luôn dựa trên chiến lược đã áp dụng, không phải mục đang xem.

Danh sách bốn chiến lược cho phép bấm xem mô tả, điều kiện vào/thoát và hạn chế. Chọn chiến lược, chỉnh vốn/chốt lời/cắt lỗ, rồi bấm **Áp dụng và chạy** để lưu và bật bot. Công tắc bật/tắt điều khiển chiến lược đã áp dụng; xem chiến lược khác không đổi bot đang chạy. Lịch sử có cột chiến lược, lấy từ bản ghi từng giao dịch; lệnh cũ không có thông tin được ghi rõ chưa ghi nhận. Không đổi chiến lược khi đang giữ vị thế tự động.

Chiến lược mới: SMA 10/30 giao cắt lên, đóng nến vượt đỉnh 20 nến trước, hoặc hồi tăng sau khi nến trước thấp hơn SMA20 ít nhất 1,5%. Dữ liệu tín hiệu là nến 15 phút đã đóng, tải riêng mỗi 30 giây, độc lập biểu đồ. Mỗi nến chỉ xét mua một lần. Đây là quy tắc thử nghiệm, chưa được backtest hoặc xác nhận lợi nhuận.

Chọn chiến lược, vốn mỗi lệnh, chốt lời và cắt lỗ, lưu rồi bật. Giá mới mỗi 5 giây quyết định thoát vị thế. Các tỷ lệ chốt lời/cắt lỗ tính từ giá mua, chưa khấu trừ phí. Tắt dừng mọi lệnh tự động và giữ vị thế; bật lại tiếp tục quản lý. Không đổi cấu hình khi còn vị thế tự động. Không có tiến trình nền: đóng trang sẽ dừng bot.

Nhập ngưỡng mua, ngưỡng bán (lớn hơn ngưỡng mua) và giá trị mua USDT. Lưu quy tắc, sau đó bật tự động. Bot đánh giá quy tắc ở lần nhận giá mới tiếp theo.

- Mỗi chu kỳ mua một lần khi giá <= ngưỡng mua, rồi bán lượng BTC đã mua khi giá >= ngưỡng bán.
- Không mua lặp khi đang giữ vị thế tự động; không bán BTC thủ công ngoài vị thế này.
- Nếu bán thủ công làm giảm số BTC còn lại, vị thế tự động giảm tương ứng.
- Thiếu số dư sẽ dừng tự động; mất kết nối hoặc giá cũ sẽ tạm chờ.
- Quy tắc và vị thế được giữ qua tải lại trang; tự động luôn tắt sau khi tải lại.
- Chỉ hoạt động khi trang đang mở. Trình duyệt có thể giảm tần suất cập nhật khi chạy nền.
- Lịch sử ghi rõ nguồn lệnh thủ công hoặc tự động.

Phần nguồn dữ liệu hiển thị sàn, cặp giao dịch, loại giá và đường dẫn API công khai. Chưa có lệnh thật.

Nguồn: https://developers.binance.com/docs/binance-spot-api-docs/faqs/market_data_only
