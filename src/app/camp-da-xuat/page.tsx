"use client"
import { useState, useEffect } from "react"
import AppLayout from "@/components/layout/AppLayout"

export default function CampDaXuatPage() {
  const [posts, setPosts] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const PER_PAGE = 20

  useEffect(() => { fetchPosts(1) }, [])

  async function fetchPosts(page = 1) {
    setLoading(true)
    const res = await fetch(`/api/posts/exported?page=${page}&limit=${PER_PAGE}`, { credentials: "include" })
    if (res.ok) {
      const data = await res.json()
      setPosts(data.posts || [])
      setTotal(data.total || 0)
    }
    setLoading(false)
  }

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))
  const SH2 = { height: 28, fontSize: 11, background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 5, color: "var(--text)", padding: "0 8px", outline: "none" }

  return (
    <AppLayout>
      <div style={{ fontSize: 16, fontWeight: 600 }}>Camp đã xuất</div>
      <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
        <div className="tbl-wrap">
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, tableLayout: "fixed" as const, minWidth: 720 }}>
          <colgroup>
            <col style={{ width: 44 }}/><col /><col style={{ width: "18%" }}/><col style={{ width: "20%" }}/><col style={{ width: 130 }}/>
          </colgroup>
          <thead>
            <tr style={{ background: "var(--bg3)" }}>
              {["STT","BAI DANG","FANPAGE","TEN CAMPAIGN","THOI GIAN XUAT"].map(h => (
                <th key={h} style={{ padding: "8px 12px", textAlign: "left" as const, fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" as const, letterSpacing: ".5px", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" as const }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} style={{ padding: 32, textAlign: "center", color: "var(--muted)" }}>Dang tai...</td></tr>
            ) : posts.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: 32, textAlign: "center", color: "var(--muted)" }}>Chua co bai nao da xuat</td></tr>
            ) : posts.map((p, i) => (
              <tr key={p.id} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "10px 12px", color: "var(--muted)", textAlign: "center" as const }}>{(currentPage-1)*PER_PAGE+i+1}</td>
                <td style={{ padding: "10px 12px" }}>
                  <div style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}>{p.name||"Bai dang"}</div>
                  <div style={{ fontSize: 9.5, color: "var(--muted)", fontFamily: "monospace", marginTop: 1 }}>{p.fbId||"—"}</div>
                </td>
                <td style={{ padding: "10px 12px", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{p.page?.name||p.pageId||"—"}</td>
                <td style={{ padding: "10px 12px", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{p.campaign?.name||"—"}</td>
                <td style={{ padding: "10px 12px", color: "var(--muted)", fontSize: 11, whiteSpace: "nowrap" as const }}>{p.exportedAt ? new Date(p.exportedAt).toLocaleDateString("vi-VN") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <div style={{ padding: "8px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid var(--border)", fontSize: 11, color: "var(--muted)" }}>
          <span>Hien thi {total>0?(currentPage-1)*PER_PAGE+1:0}-{Math.min(currentPage*PER_PAGE,total)} / {total} bai</span>
          <div style={{ display: "flex", gap: 3 }}>
            <button onClick={()=>{const p=Math.max(1,currentPage-1);setCurrentPage(p);fetchPosts(p)}} disabled={currentPage===1} style={{ width:24,height:24,borderRadius:4,display:"flex",alignItems:"center",justifyContent:"center",border:"1px solid var(--border)",background:"transparent",color:currentPage===1?"var(--muted)":"var(--text)",fontSize:11,cursor:currentPage===1?"default":"pointer" }}>‹</button>
            {Array.from({length:Math.min(totalPages,5)},(_,i)=>{
              let pg=i+1; if(totalPages>5&&currentPage>3) pg=currentPage-2+i; if(pg>totalPages) return null
              return <button key={pg} onClick={()=>{setCurrentPage(pg);fetchPosts(pg)}} style={{ width:24,height:24,borderRadius:4,display:"flex",alignItems:"center",justifyContent:"center",border:`1px solid ${pg===currentPage?"var(--accent)":"var(--border)"}`,background:pg===currentPage?"var(--accent)":"transparent",color:pg===currentPage?"#fff":"var(--muted)",fontSize:11,cursor:"pointer" }}>{pg}</button>
            })}
            <button onClick={()=>{const p=Math.min(totalPages,currentPage+1);setCurrentPage(p);fetchPosts(p)}} disabled={currentPage===totalPages} style={{ width:24,height:24,borderRadius:4,display:"flex",alignItems:"center",justifyContent:"center",border:"1px solid var(--border)",background:"transparent",color:currentPage===totalPages?"var(--muted)":"var(--text)",fontSize:11,cursor:currentPage===totalPages?"default":"pointer" }}>›</button>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}