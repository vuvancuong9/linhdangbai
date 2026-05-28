// Trang Privacy Policy — public, không cần login.
// FB App Review yêu cầu URL này tồn tại + accessible khi review.

export const metadata = { title: "Chính sách bảo mật — FB Ads Manager" }

export default function PrivacyPage() {
  return (
    <div style={{ maxWidth: 800, margin: "40px auto", padding: "20px 24px", fontFamily: "-apple-system, sans-serif", lineHeight: 1.7, color: "#222" }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Chính sách bảo mật</h1>
      <div style={{ color: "#666", fontSize: 13, marginBottom: 24 }}>Cập nhật: 08/05/2026</div>

      <p>FB Ads Manager (sau đây gọi là "ứng dụng") là công cụ quản lý nội bộ giúp người dùng quản lý quảng cáo Facebook và affiliate Shopee. Tài liệu này mô tả cách ứng dụng thu thập và sử dụng dữ liệu.</p>

      <h2 style={{ fontSize: 20, marginTop: 28, marginBottom: 8 }}>1. Dữ liệu thu thập</h2>
      <ul>
        <li><b>Tài khoản người dùng:</b> tên, email (do người dùng tự đăng ký).</li>
        <li><b>Dữ liệu Facebook:</b> danh sách Trang, tài khoản quảng cáo, bài đăng, số liệu insights, video — chỉ với những Trang/tài khoản người dùng cấp quyền truy cập qua Facebook Login.</li>
        <li><b>Dữ liệu Shopee Affiliate:</b> conversion report, hoa hồng, click — qua Shopee Open API với API key người dùng cấu hình.</li>
        <li><b>Video do người dùng cung cấp:</b> URL reel + URL Shopee dán vào ứng dụng để tải về máy chủ phục vụ đăng Trang.</li>
      </ul>

      <h2 style={{ fontSize: 20, marginTop: 28, marginBottom: 8 }}>2. Cách sử dụng dữ liệu</h2>
      <ul>
        <li>Hiển thị dashboard quảng cáo, hoa hồng, lợi nhuận cho người dùng đăng nhập.</li>
        <li>Tự động tạo affiliate link Shopee + caption + đăng video lên Trang Facebook do người dùng quản lý.</li>
        <li>KHÔNG chia sẻ dữ liệu với bên thứ ba ngoài Facebook và Shopee (theo lệnh của người dùng).</li>
        <li>KHÔNG bán dữ liệu, KHÔNG dùng cho mục đích quảng cáo bên thứ ba.</li>
      </ul>

      <h2 style={{ fontSize: 20, marginTop: 28, marginBottom: 8 }}>3. Lưu trữ dữ liệu</h2>
      <ul>
        <li>Dữ liệu được lưu tại máy chủ Supabase (PostgreSQL, AWS Singapore) và Cloudflare R2 (video).</li>
        <li>Tokens được mã hoá AES-256 trước khi lưu vào cơ sở dữ liệu.</li>
        <li>Dữ liệu chỉ lưu khi người dùng còn sử dụng dịch vụ.</li>
      </ul>

      <h2 style={{ fontSize: 20, marginTop: 28, marginBottom: 8 }}>4. Quyền của người dùng</h2>
      <ul>
        <li>Yêu cầu xem dữ liệu cá nhân lưu trong ứng dụng.</li>
        <li>Yêu cầu xoá toàn bộ dữ liệu — xem hướng dẫn tại <a href="/data-deletion" style={{ color: "#1877f2" }}>/data-deletion</a>.</li>
        <li>Thu hồi quyền truy cập Facebook bất cứ lúc nào tại <a href="https://www.facebook.com/settings?tab=business_tools" target="_blank" rel="noreferrer" style={{ color: "#1877f2" }}>Cài đặt Business Tools</a> của Facebook.</li>
      </ul>

      <h2 style={{ fontSize: 20, marginTop: 28, marginBottom: 8 }}>5. Bảo mật</h2>
      <p>Ứng dụng dùng HTTPS bắt buộc, mã hoá tokens, JWT cookie httpOnly + SameSite strict cho phiên đăng nhập, rate-limit chống brute-force. Nếu phát hiện sự cố bảo mật, ứng dụng sẽ thông báo người dùng trong vòng 72 giờ.</p>

      <h2 style={{ fontSize: 20, marginTop: 28, marginBottom: 8 }}>6. Liên hệ</h2>
      <p>Email: <a href="mailto:trongquy4499@gmail.com" style={{ color: "#1877f2" }}>trongquy4499@gmail.com</a></p>

      <div style={{ marginTop: 40, paddingTop: 16, borderTop: "1px solid #eee", fontSize: 12, color: "#999" }}>
        © 2026 FB Ads Manager. <a href="/data-deletion" style={{ color: "#1877f2" }}>Yêu cầu xoá dữ liệu</a>.
      </div>
    </div>
  )
}
