import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import { Toaster } from "react-hot-toast";

export const metadata: Metadata = {
  title: "SLYD POS",
  description: "High-density Point of Sale Interface",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${GeistSans.variable} ${GeistMono.variable} font-sans bg-canvas text-ink-primary min-h-[100dvh]`}>
        <div className="flex min-h-[100dvh]">
          <Sidebar />
          <main className="flex-1 overflow-x-hidden">
            {children}
            <Toaster position="bottom-right" />
          </main>
        </div>
      </body>
    </html>
  );
}
