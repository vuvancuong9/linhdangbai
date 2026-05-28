'use client'
import { useState } from 'react'
import { useAuthStore } from '@/store/auth'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
    const { setUser } = useAuthStore()
  const [error, setError] = useState('')

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.message || 'Dang nhap that bai'); setLoading(false); return }
            setUser(json.data.user)
      // Redirect:
      // - Mobile (viewport <700px) → /dashboard luôn (mặc định mobile)
      // - ADMIN/SUPER_ADMIN → /admin
      // - USER có permissions (mới) → trang đầu tiên trong list quyền
      // - USER có userType (legacy) → map theo userType cũ
      // - USER không có gì (legacy full) → /keo-ads
      const u = json.data.user
      const PATH_MAP: Record<string, string> = {
        'keo-ads': '/keo-ads', 'fanpage-posts': '/fanpage-posts', 'dashboard': '/dashboard',
        'quan-ly-campaign': '/quan-ly-campaign', 'nhom-tai-khoan': '/nhom-tai-khoan',
        'billing': '/billing',
        'chi-phi-van-phong': '/chi-phi-van-phong',
      }
      // Mobile: vào thẳng /dashboard (tối giản UI mobile).
      const isMobileScreen = typeof window !== 'undefined' && window.innerWidth < 700
      if (isMobileScreen) {
        window.location.href = '/dashboard'
        return
      }
      if (u.role === 'SUPER_ADMIN') {
        window.location.href = '/admin'
      } else if (u.role === 'ADMIN') {
        // ADMIN luôn vào /admin (quản lý user con) — middleware sẽ cho qua nếu admin có permissions hoặc legacy.
        window.location.href = '/admin'
      } else if (u.permissions) {
        try {
          const perms = JSON.parse(u.permissions)
          if (Array.isArray(perms) && perms.length > 0) {
            window.location.href = PATH_MAP[perms[0]] || '/lich-su-dang-nhap'
          } else {
            window.location.href = '/lich-su-dang-nhap'
          }
        } catch {
          window.location.href = '/lich-su-dang-nhap'
        }
      } else if (u.userType === 'accountant') {
        window.location.href = '/chi-phi-van-phong'
      } else {
        // userType 'product_finder' (legacy kho-video da xoa 14/5/2026) -> fallback /keo-ads
        window.location.href = '/keo-ads'
      }
    } catch {
      setError('Loi ket noi server')
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'var(--bg)',padding:16 }}>
      <div style={{ background:'var(--bg2)',border:'1px solid var(--border2)',borderRadius:14,padding:'36px 32px',width:380,maxWidth:'100%',display:'flex',flexDirection:'column',gap:22 }}>
        <div style={{ display:'flex',alignItems:'center',gap:10,justifyContent:'center' }}>
          <div style={{ width:36,height:36,background:'#4f7ef8',borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center' }}>
            <svg width="18" height="18" viewBox="0 0 16 16" fill="white"><path d="M8 1L14 4V12L8 15L2 12V4Z"/></svg>
          </div>
          <div>
            <div style={{ fontSize:20,fontWeight:700,color:'var(--text)' }}>FB <span style={{ color:'var(--accent)' }}>Ads Manager</span></div>
            <div style={{ fontSize:10,color:'var(--muted)' }}>He thong quan ly quang cao</div>
          </div>
        </div>
        <div style={{ height:1,background:'var(--border)' }}/>
        <form onSubmit={handleLogin} style={{ display:'flex',flexDirection:'column',gap:14 }}>
          <div style={{ display:'flex',flexDirection:'column',gap:5 }}>
            <label style={{ fontSize:10,fontWeight:600,color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.5px' }}>Email</label>
            <input type="email" required value={email} onChange={e=>setEmail(e.target.value)} style={{ height:42,padding:'0 12px',fontSize:14,background:'var(--bg3)',border:'1px solid var(--border2)',borderRadius:6,color:'var(--text)',outline:'none',fontFamily:'inherit' }}/>
          </div>
          <div style={{ display:'flex',flexDirection:'column',gap:5 }}>
            <label style={{ fontSize:10,fontWeight:600,color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.5px' }}>Mat khau</label>
            <input type="password" required value={password} onChange={e=>setPassword(e.target.value)} style={{ height:42,padding:'0 12px',fontSize:14,background:'var(--bg3)',border:'1px solid var(--border2)',borderRadius:6,color:'var(--text)',outline:'none',fontFamily:'inherit' }}/>
          </div>
          {error && <div style={{ background:'rgba(232,77,45,.08)',border:'1px solid rgba(232,77,45,.2)',borderRadius:6,padding:'8px 12px',fontSize:11,color:'var(--danger)' }}>{error}</div>}
          <button type="submit" disabled={loading} style={{ height:44,background:'var(--accent)',color:'#fff',border:'none',borderRadius:6,fontSize:13,fontWeight:600,cursor:'pointer',opacity:loading?0.7:1,fontFamily:'inherit' }}>
            {loading?'Dang dang nhap...':'Dang nhap'}
          </button>
        </form>
      </div>
    </div>
  )
}
