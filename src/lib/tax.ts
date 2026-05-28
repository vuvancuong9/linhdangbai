// Hàm tính thuế chi tiết theo Luật VN (cập nhật cho năm 2026).
// 3 loại: TNCN cá nhân cư trú, Hộ kinh doanh, Doanh nghiệp.

// ============================== TNCN cá nhân cư trú ==============================
// Mức giảm trừ Luật 2026:
//   - Bản thân: 15.500.000đ/tháng = 186.000.000đ/năm
//   - Phụ thuộc: 6.200.000đ/người/tháng = 74.400.000đ/người/năm
// Bậc thang thuế suất theo thu nhập tính thuế NĂM (sau giảm trừ):
const TNCN_BASE_DEDUCTION_YEAR = 186_000_000
const TNCN_DEPENDENT_DEDUCTION_YEAR = 74_400_000
const TNCN_BRACKETS = [
  { upTo: 120_000_000, rate: 0.05 },
  { upTo: 360_000_000, rate: 0.10 },
  { upTo: 720_000_000, rate: 0.20 },
  { upTo: 1_200_000_000, rate: 0.30 },
  { upTo: Infinity, rate: 0.35 },
]

export interface TNCNInputs {
  grossYear: number       // Tổng thu nhập năm
  insurance: number       // Bảo hiểm bắt buộc cả năm (BHXH+BHYT+BHTN)
  dependents: number      // Số người phụ thuộc
  otherDeduction: number  // Khoản giảm trừ khác
}
export interface TNCNOutputs {
  totalDeduction: number
  taxableIncome: number
  taxAmount: number
  netIncome: number
  brackets: { range: string; amount: number; tax: number }[]
}

export function calcTNCN(inp: TNCNInputs): TNCNOutputs {
  const gross = Math.max(0, Number(inp.grossYear) || 0)
  const insurance = Math.max(0, Number(inp.insurance) || 0)
  const dependents = Math.max(0, Math.floor(Number(inp.dependents) || 0))
  const other = Math.max(0, Number(inp.otherDeduction) || 0)
  const totalDeduction = TNCN_BASE_DEDUCTION_YEAR + dependents * TNCN_DEPENDENT_DEDUCTION_YEAR + insurance + other
  const taxableIncome = Math.max(0, gross - totalDeduction)

  const brackets: { range: string; amount: number; tax: number }[] = []
  let remaining = taxableIncome
  let prevCap = 0
  let totalTax = 0
  for (const b of TNCN_BRACKETS) {
    if (remaining <= 0) break
    const slice = Math.min(remaining, b.upTo - prevCap)
    const tax = slice * b.rate
    brackets.push({
      range: b.upTo === Infinity ? `>${(prevCap / 1e6).toFixed(0)}tr × ${(b.rate * 100).toFixed(0)}%` : `${(prevCap / 1e6).toFixed(0)}-${(b.upTo / 1e6).toFixed(0)}tr × ${(b.rate * 100).toFixed(0)}%`,
      amount: Math.round(slice),
      tax: Math.round(tax),
    })
    totalTax += tax
    remaining -= slice
    prevCap = b.upTo
  }
  const taxAmount = Math.round(totalTax)
  return {
    totalDeduction,
    taxableIncome: Math.round(taxableIncome),
    taxAmount,
    netIncome: Math.round(gross - taxAmount),
    brackets,
  }
}

// ============================== Hộ kinh doanh (NĐ 68/2026) ==============================
// 4 nhóm ngành chính:
//   - distribution: phân phối hàng hóa — GTGT 1%, TNCN 0.5% = 1.5%
//   - service: dịch vụ (bao gồm tiếp thị liên kết) — GTGT 5%, TNCN 5% = 10%
//   - transport_food: giao thông, ăn uống... — GTGT 3%, TNCN 1.5% = 4.5%
//   - other: hoạt động khác — GTGT 2%, TNCN 1% = 3%
// PP "trực tiếp": (Doanh thu - DT miễn thuế) × tỷ lệ.
// Default ngành: "service" (cho affiliate marketing).

export const HKD_INDUSTRIES = [
  { value: "distribution", label: "Phân phối hàng hoá", vat: 0.01, tncn: 0.005 },
  { value: "service", label: "Cung cấp sản phẩm/nội dung số (affiliate, marketing)", vat: 0.05, tncn: 0.05 },
  { value: "transport_food", label: "Vận tải, ăn uống", vat: 0.03, tncn: 0.015 },
  { value: "other", label: "Hoạt động khác", vat: 0.02, tncn: 0.01 },
] as const

// Phân nhóm DT theo NĐ 68/2026 → DT miễn TNCN tương ứng:
//   Nhóm 1 (< 1 tỷ): miễn hoàn toàn (GTGT + TNCN = 0)
//   Nhóm 2 (1 - 3 tỷ): DT miễn TNCN mặc định = 1 tỷ
//   Nhóm 3 (3 - 50 tỷ): tính bình thường, không miễn
//   Nhóm 4 (> 50 tỷ): áp tỷ lệ DN, không miễn
export function suggestHKDExempt(revenue: number): number {
  if (revenue < 1_000_000_000) return revenue // miễn hoàn toàn
  if (revenue < 3_000_000_000) return 1_000_000_000
  return 0
}
export function getHKDGroupLabel(revenue: number): string {
  if (revenue < 1_000_000_000) return "Nhóm 1: <1 tỷ (miễn thuế hoàn toàn)"
  if (revenue < 3_000_000_000) return "Nhóm 2: 1 − 3 tỷ"
  if (revenue < 50_000_000_000) return "Nhóm 3: 3 − 50 tỷ"
  return "Nhóm 4: >50 tỷ"
}

export interface HKDInputs {
  industry: string  // value từ HKD_INDUSTRIES
  revenue: number   // Doanh thu năm
  expense: number   // Chi phí được trừ (cho PP thu nhập)
  exempt: number    // DT miễn thuế TNCN (default theo nhóm DT)
  method: "direct" | "income"  // direct = (DT-miễn) × tỷ lệ ; income = TNT × 15%
}
export interface HKDOutputs {
  vatBase: number
  tncnBase: number
  vatRate: number
  tncnRate: number
  vatTax: number
  tncnTax: number
  totalTax: number
  netIncome: number
  industryLabel: string
  groupLabel: string
  methodLabel: string
}

const HKD_INCOME_TNCN_RATE = 0.15  // PP thu nhập: TNT × 15%

export function calcHKD(inp: HKDInputs): HKDOutputs {
  const ind = HKD_INDUSTRIES.find((x) => x.value === inp.industry) || HKD_INDUSTRIES[1]
  const rev = Math.max(0, Number(inp.revenue) || 0)
  const exempt = Math.max(0, Number(inp.exempt) || 0)
  const expense = Math.max(0, Number(inp.expense) || 0)
  const method = inp.method === "income" ? "income" : "direct"

  // Nhóm 1 (<1 tỷ): miễn hoàn toàn
  if (rev < 1_000_000_000) {
    return {
      vatBase: 0, tncnBase: 0,
      vatRate: ind.vat * 100, tncnRate: ind.tncn * 100,
      vatTax: 0, tncnTax: 0, totalTax: 0,
      netIncome: rev,
      industryLabel: ind.label,
      groupLabel: getHKDGroupLabel(rev),
      methodLabel: "Miễn thuế hoàn toàn (DT < 1 tỷ)",
    }
  }

  // GTGT luôn tính trên TỔNG doanh thu (không trừ miễn)
  const vatBase = rev
  const vatTax = Math.round(vatBase * ind.vat)

  // TNCN tuỳ phương pháp
  let tncnBase: number
  let tncnRate: number
  let methodLabel: string
  if (method === "income") {
    // PP thu nhập: TNT × 15%
    tncnBase = Math.max(0, rev - expense)
    tncnRate = HKD_INCOME_TNCN_RATE * 100
    methodLabel = "PP thu nhập: TNT × 15%"
  } else {
    // PP trực tiếp: (DT - miễn) × tỷ lệ TNCN ngành
    tncnBase = Math.max(0, rev - exempt)
    tncnRate = ind.tncn * 100
    methodLabel = `PP trực tiếp: (DT − ${(exempt / 1e6).toFixed(0)}tr) × ${(ind.tncn * 100).toFixed(1)}%`
  }
  const tncnTax = Math.round(tncnBase * (tncnRate / 100))
  const totalTax = vatTax + tncnTax

  return {
    vatBase: Math.round(vatBase),
    tncnBase: Math.round(tncnBase),
    vatRate: ind.vat * 100,
    tncnRate,
    vatTax,
    tncnTax,
    totalTax,
    netIncome: Math.round(rev - totalTax),
    industryLabel: ind.label,
    groupLabel: getHKDGroupLabel(rev),
    methodLabel,
  }
}

// ============================== Doanh nghiệp (TNDN) ==============================
// Thuế suất theo Luật 2026:
//   - DN nhỏ (DT ≤ 3 tỷ): 15%
//   - DN vừa (DT 3-50 tỷ): 17%
//   - DN thông thường: 20%

export const TNDN_TYPES = [
  { value: "small", label: "DN nhỏ (DT ≤ 3 tỷ)", rate: 0.15 },
  { value: "medium", label: "DN vừa (DT 3-50 tỷ)", rate: 0.17 },
  { value: "large", label: "DN thông thường (>50 tỷ)", rate: 0.20 },
] as const

export interface TNDNInputs {
  companyType: string   // small | medium | large
  revenue: number       // Tổng doanh thu năm
  expense: number       // Tổng chi phí được trừ
  exemptIncome: number  // Thu nhập miễn thuế / Lỗ kết chuyển
}
export interface TNDNOutputs {
  taxableIncome: number
  taxRate: number
  taxAmount: number
  netIncome: number
  typeLabel: string
}

export function calcTNDN(inp: TNDNInputs): TNDNOutputs {
  const t = TNDN_TYPES.find((x) => x.value === inp.companyType) || TNDN_TYPES[2]
  const rev = Math.max(0, Number(inp.revenue) || 0)
  const exp = Math.max(0, Number(inp.expense) || 0)
  const ex = Math.max(0, Number(inp.exemptIncome) || 0)
  const taxableIncome = Math.max(0, rev - exp - ex)
  const taxAmount = Math.round(taxableIncome * t.rate)
  return {
    taxableIncome: Math.round(taxableIncome),
    taxRate: t.rate * 100,
    taxAmount,
    netIncome: Math.round(rev - exp - taxAmount),
    typeLabel: t.label,
  }
}

// ============================== Quick calc cho dashboard chip ==============================
// Dùng cho card group tóm tắt: tính nhanh thuế dựa trên loại + commission + spend.
// Kết quả khớp nhanh với 3 hàm chi tiết ở trên (giả định không có thông tin bổ sung).
export interface TaxQuickResult {
  taxType: "personal" | "household" | "company"
  label: string
  taxBase: number
  taxRate: number
  tax: number
}

export function calcTax(taxType: string | null | undefined, commission: number, spend: number): TaxQuickResult | null {
  const c = Math.max(0, Math.round(commission || 0))
  const s = Math.max(0, Math.round(spend || 0))
  switch (taxType) {
    case "personal": {
      // Quick: chỉ tính trên commission (không trừ giảm trừ vì không có info)
      const r = calcTNCN({ grossYear: c, insurance: 0, dependents: 0, otherDeduction: 0 })
      return { taxType: "personal", label: "Cá nhân (TNCN bậc thang)", taxBase: r.taxableIncome, taxRate: c > 0 ? Math.round((r.taxAmount / c) * 10000) / 100 : 0, tax: r.taxAmount }
    }
    case "household": {
      const r = calcHKD({ industry: "service", revenue: c, expense: 0, exempt: 0, method: "direct" })
      return { taxType: "household", label: "HKD (GTGT 5% + TNCN 5%)", taxBase: r.vatBase, taxRate: r.vatRate + r.tncnRate, tax: r.totalTax }
    }
    case "company": {
      const r = calcTNDN({ companyType: "large", revenue: c, expense: s, exemptIncome: 0 })
      return { taxType: "company", label: "Công ty (TNDN 20% lợi nhuận)", taxBase: r.taxableIncome, taxRate: r.taxRate, tax: r.taxAmount }
    }
    default:
      return null
  }
}
