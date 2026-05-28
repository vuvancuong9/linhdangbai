// Constants SERVER-ONLY — KHÔNG import vào client component.
// Các giá trị này là business logic nhạy cảm (công thức tính lợi nhuận,
// rule auto-manage, threshold cron) — không nên lộ ra browser via F12.
//
// Nếu client cần dùng (vd render lợi nhuận đã tính sẵn) → server tính
// trước rồi trả về kết quả, không trả constants.

// Profit calculation (Lợi nhuận thực tế trên Dashboard)
//   = HH × COMMISSION_NET_FACTOR − Ads × ADS_COST_FACTOR − Thuế − Chi phí VP
// COMMISSION_NET_FACTOR: hoa hồng nhận thực tế (Shopee giữ 1% phí thanh toán → 0.99).
// ADS_COST_FACTOR: chi phí ads thực tế bao gồm phụ phí.
export const COMMISSION_NET_FACTOR = 0.99
export const ADS_COST_FACTOR = 1.01

// Auto-manage camp rules (cron 13h sáng VN daily):
// - Tat camp neu 3 ngay (D0, D1, D2) DEU lo va tong lo > AUTO_MANAGE_LOSS_THRESHOLD
// - Tang budget x AUTO_MANAGE_BUDGET_MULTIPLIER neu 3 ngay DEU lai va tong lai > AUTO_MANAGE_PROFIT_THRESHOLD
// - Cap newBudget tai AUTO_MANAGE_BUDGET_MAX (500k) — tranh budget vot qua cao
export const AUTO_MANAGE_DAYS_WINDOW = 3
export const AUTO_MANAGE_LOSS_THRESHOLD = 100_000    // VND
export const AUTO_MANAGE_PROFIT_THRESHOLD = 100_000  // VND
export const AUTO_MANAGE_BUDGET_MULTIPLIER = 1.30
export const AUTO_MANAGE_BUDGET_MAX = 500_000        // VND

// Auto-off camp KHONG can tien (chay cung cron auto-manage 13h):
// - Tat camp neu tong spend D0..D4 < AUTO_OFF_NO_SPEND_TOTAL
//   VA moi ngay D0..D4 spend < AUTO_OFF_NO_SPEND_DAILY
//   VA camp tao truoc D4
export const AUTO_OFF_NO_SPEND_TOTAL = 50_000        // VND
export const AUTO_OFF_NO_SPEND_DAILY = 15_000        // VND
export const AUTO_OFF_NO_SPEND_DAYS = 5

// Auto-create campaign cron retry policy (cron moi dau gio):
// - Posts moi (adError=null): tao camp ngay
// - Posts adError: retry sau AUTO_CAMP_RETRY_HOURS gio, max AUTO_CAMP_MAX_RETRY lan
//   Sau khi het retry, user phai manual click "Thu lai" trong /camp-loi
// Ly do retry: error 1487472 (post chua eligible for ads) thuong tu het sau vai gio.
export const AUTO_CAMP_RETRY_HOURS = 6
export const AUTO_CAMP_MAX_RETRY = 3

// Default camp config khi user tao camp moi (fanpage-posts).
// Truoc day hardcode trong client → lo qua F12. Gio server-side.
// User van co the override + save vao localStorage (chi may anh).
export const DEFAULT_CAMP_CONFIG = {
  objective: "OUTCOME_TRAFFIC",
  budget: 100000,
  bidStrategy: "LOWEST_COST_WITHOUT_CAP",
  bidAmount: 0,
  ageMin: 20,
  ageMax: 44,
  gender: "all" as "all" | "male" | "female",
  country: "VN",
  optimizationGoal: "LINK_CLICKS",
  billingEvent: "IMPRESSIONS",
}

// Default export config (xuat CSV file mau).
export const DEFAULT_EXPORT_CONFIG = {
  objective: "Traffic",
  buyType: "AUCTION",
  status: "ACTIVE",
  bidStrategy: "Cost per result goal",
  budget: 100000,
  optimizationGoal: "LINK_CLICKS",
  billingEvent: "IMPRESSIONS",
  bid: 450,
  ageMin: 20,
  ageMax: 44,
  country: "VN",
  startDate: "",
  pageId: "",
}
