import type { Metadata } from "next";
import "./globals.css";

const isGitHubPages = process.env.GITHUB_PAGES === "true";
const siteUrl = isGitHubPages
  ? "https://renrenlu.github.io/yingyu8nian/"
  : "https://grade8-english-u1-u8.renren49.chatgpt.site/";
const assetBase = isGitHubPages ? "/yingyu8nian" : "";
const title = "八上英语 U1–U8 互动学习系统";
const description = "沪教牛津版八年级上册 U1–U8 重点词汇、词组和句型学习，支持英音、美音、慢速跟读与单词自测。";

export const dynamic = "force-static";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  openGraph: {
    title,
    description,
    type: "website",
    url: siteUrl,
    images: [{ url: `${assetBase}/og.jpg`, width: 1200, height: 630, alt: title }],
  },
  twitter: { card: "summary_large_image", title, description, images: [`${assetBase}/og.jpg`] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
