import type { NextConfig } from "next";

// GitHub Pages 프로젝트 사이트는 /<저장소명>/ 하위 경로에서 서비스된다.
// 하위 경로는 빌드 시점에 확정되므로 환경변수로 받는다. assetPrefix는 쓰지 않는다.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
