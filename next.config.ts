import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // esbuild 包含原生二进制文件（.node）和 .md 文件，Turbopack/Webpack 无法打包
  // 设为服务端外部包，让 Next.js 直接通过 require() 加载，跳过打包
  serverExternalPackages: ['esbuild'],

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'require-corp',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
