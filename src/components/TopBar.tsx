'use client'

import { Menu, ScanBarcode } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function TopBar() {
  const pathname = usePathname();
  if (pathname === '/login') return null;

  return (
    <header className="sticky top-0 z-[80] bg-surface/90 backdrop-blur-md border-b border-border px-4 flex items-center justify-between shrink-0 h-[60px] md:h-[64px]">
      {/* LEFT: Menu Toggle (Mobile) */}
      <div className="flex-1 flex items-center">
        <button 
          onClick={() => window.dispatchEvent(new Event('toggle-mobile-menu'))}
          className="p-2 -ml-2 text-ink-primary hover:bg-row-alt rounded-full transition-colors md:hidden"
        >
          <Menu className="w-[22px] h-[22px]" />
        </button>
      </div>
      
      {/* CENTER: Typography Logo (Mobile Only, Desktop Sidebar already has it) */}
      <div className="flex-1 flex items-center justify-center">
        <span className="font-extrabold tracking-tighter text-[18px] text-ink-primary md:hidden">MELBON</span>
      </div>
      
      {/* RIGHT: Price & Stock Action */}
      <div className="flex-1 flex items-center justify-end">
        <Link 
          href="/lookup"
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/10 hover:bg-accent/20 text-accent font-bold text-[12px] md:text-[13px] rounded-full transition-colors border border-accent/20"
        >
          <ScanBarcode className="w-4 h-4" />
          <span>Lookup</span>
        </Link>
      </div>
    </header>
  );
}
