// Trang Data Deletion — public, không cần login.
// FB yêu cầu URL này khi review app có Facebook Login.

export const metadata = { title: "Hướng dẫn xoá dữ liệu — cuongbg" }

export default function DataDeletionPage() {
  return (
    <div style={{ maxWidth: 800, margin: "40px auto", padding: "20px 24px", fontFamily: "-apple-system, sans-serif", lineHeight: 1.7, color: "#222" }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Hướng dẫn xoá dữ liệu</h1>
      <div style={{ color: "#666", fontSize: 13, marginBottom: 24 }}>Cập nhật: 08/05/2026</div>

      <p>FB Ads Manager tôn trọng quyền xoá dữ liệu của người dùng theo yêu cầu của Facebook Platform Policy. Có 2 cách yêu cầu xoá:</p>

      <h2 style={{ fontSize: 20, marginTop: 28, marginBottom: 8 }}>Cách 1: Tự xoá tài khoản trong ứng dụng</h2>
      <ol>
        <li>Đăng nhập vào ứng dụng tại <a href="https://linhdangbai-2odf.vercel.app" style={{ color: "#1877f2" }}>linhdangbai-2odf.vercel.app</a></li>
        <li>Vào <b>Đổi MK / Quản lý tài khoản</b> (góc phải topbar).</li>
        <li>Bấm <b>Yêu cầu xoá tài khoản</b>.</li>
        <li>Hệ thống sẽ xoá toàn bộ dữ liệu liên quan trong vòng 7 ngày: thông tin tài khoản, tokens FB/Shopee, video trên R2, dữ liệu commission, posts, campaigns, kho video.</li>
      </ol>

      <h2 style={{ fontSize: 20, marginTop: 28, marginBottom: 8 }}>Cách 2: Gửi email yêu cầu xoá</h2>
      <p>Nếu mày không thể đăng nhập, gửi email tới:</p>
      <p style={{ fontSize: 16, fontWeight: 600 }}>
        <a href="mailto:cuongbghvtc@gmail.com?subject=Yeu cau xoa du lieu FB Ads Manager" style={{ color: "#1877f2" }}>cuongbghvtc@gmail.com</a>
      </p>
      <p>Tiêu đề: <code>Yêu cầu xoá dữ liệu FB Ads Manager</code></p>
      <p>Nội dung email cần có:</p>
      <ul>
        <li>Email mày dùng đăng ký ứng dụng.</li>
        <li>Hoặc User ID Facebook (lấy được tại <a href="https://findmyfbid.com" target="_blank" rel="noreferrer" style={{ color: "#1877f2" }}>findmyfbid.com</a>).</li>
        <li>Lý do xoá (tuỳ chọn).</li>
      </ul>
      <p>Ứng dụng sẽ phản hồi trong vòng <b>3 ngày làm việc</b> và hoàn tất xoá trong vòng <b>7 ngày</b>.</p>

      <h2 style={{ fontSize: 20, marginTop: 28, marginBottom: 8 }}>Dữ liệu được xoá</h2>
      <ul>
        <li>Tài khoản người dùng (tên, email, mật khẩu hash).</li>
        <li>Tokens Facebook/Shopee đã lưu (đã mã hoá).</li>
        <li>Tất cả TKQC, fanpages, posts, campaigns, affiliate links, kho video đã sync.</li>
        <li>Video file trên Cloudflare R2.</li>
        <li>Dữ liệu commission, click, hoa hồng đã import.</li>
      </ul>

      <h2 style={{ fontSize: 20, marginTop: 28, marginBottom: 8 }}>Xác nhận xoá xong</h2>
      <p>Sau khi xoá, ứng dụng gửi email xác nhận kèm <b>mã yêu cầu</b> (confirmation code). Mày có thể dùng mã này để check lại trạng thái xoá nếu cần.</p>

      <h2 style={{ fontSize: 20, marginTop: 28, marginBottom: 8 }}>Thu hồi quyền Facebook</h2>
      <p>Nếu chỉ muốn ngừng cho ứng dụng truy cập tài khoản Facebook (không xoá toàn bộ dữ liệu), vào:</p>
      <p><a href="https://www.facebook.com/settings?tab=business_tools" target="_blank" rel="noreferrer" style={{ color: "#1877f2" }}>https://www.facebook.com/settings?tab=business_tools</a></p>
      <p>→ tìm <b>FB Ads Manager</b> → Remove.</p>

      <div style={{ marginTop: 40, paddingTop: 16, borderTop: "1px solid #eee", fontSize: 12, color: "#999" }}>
        © 2026 FB Ads Manager. <a href="/privacy" style={{ color: "#1877f2" }}>Chính sách bảo mật</a>.
      </div>
    </div>
  )
}
