import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import TopBar from "@/components/TopBar";
import Sidebar from "@/components/Sidebar";
import { Toaster } from "react-hot-toast";

export const metadata: Metadata = {
  title: "SLYD POS",
  description: "High-density Point of Sale Interface",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${GeistSans.variable} ${GeistMono.variable} font-sans bg-canvas text-ink-primary h-[100dvh] flex flex-col md:flex-row overflow-hidden`}>
        <Sidebar />
        
        {/* Main Content Area Wrapper */}
        <div className="flex-1 flex flex-col min-w-0 h-[100dvh]">
          <TopBar />
          
          <main className="flex-1 overflow-y-auto overflow-x-hidden relative flex flex-col min-h-0">
            {children}
            
            <Toaster 
              position="top-center" 
              toastOptions={{
                className: '!bg-surface !text-ink-primary !shadow-modal !rounded-xl !border !border-border !font-medium !text-[14px]',
                success: { iconTheme: { primary: '#2563EB', secondary: '#ffffff' } },
                error: { iconTheme: { primary: '#DC2626', secondary: '#ffffff' } },
              }}
            />
          </main>
        </div>
      </body>
    </html>
  );
}
