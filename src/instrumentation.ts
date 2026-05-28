export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // SKIP cron khi chay local (dev mode) hoac khi DISABLE_CRON=true.
    // Ly do: production Railway van chay cron 24/7 → neu local cung chay se duplicate
    // FB API calls (gap doi rate limit + ton I/O Supabase).
    if (process.env.NODE_ENV === "development" || process.env.DISABLE_CRON === "true") {
      console.log("[CRON] Skipped (dev mode hoac DISABLE_CRON=true). Production Railway dang chay cron.")
      return
    }
    const { startCronJobs } = await import("./lib/cron")
    startCronJobs()
  }
}
