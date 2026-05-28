/** @type {import("next").NextConfig} */
const nextConfig = {
  experimental: {
    instrumentationHook: true,
    // ffmpeg-static export path string mà webpack rewrite sai → mark external để dùng nguyên path gốc node_modules
    serverComponentsExternalPackages: ["ffmpeg-static", "@anthropic-ai/sdk"],
  },
  // Bundle binary ffmpeg vào output deploy (nếu không Railway sẽ thiếu file)
  outputFileTracingIncludes: {
    "/api/affiliate-link/analyze-fb-reel": [
      "./node_modules/ffmpeg-static/**",
    ],
  },
}

module.exports = nextConfig
