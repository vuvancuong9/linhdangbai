import type { Metadata } from "next"
import "./globals.css"
import Providers from "@/components/Providers"

export const metadata: Metadata = {
  title: "cuongbg",
  description: "He thong quan ly quang cao Facebook",
}

// Auto theme theo giờ VN (UTC+7, không DST):
//   - 06:00 → 18:59 = light
//   - 19:00 → 05:59 = dark
// Tính từ getUTCHours để không phụ thuộc timezone máy user (có thể sai).
// Script chạy inline trong <head> trước render để tránh flash sai theme.
const themeInitScript = `(function(){try{var d=new Date();var h=(d.getUTCHours()+7)%24;var t=(h>=6&&h<19)?'light':'dark';document.documentElement.setAttribute('data-theme',t);var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute('content',t==='light'?'#eef0f5':'#0f1117');}catch(e){}})();`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
        {/* PWA — cài app vào màn hình + standalone display */}
        <link rel="manifest" href="/manifest.json" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="cuongbg" />
        <meta name="application-name" content="cuongbg" />
        <meta name="theme-color" content="#eef0f5" />
        {/* Icons */}
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png" />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body style={{ margin: 0, padding: 0, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
