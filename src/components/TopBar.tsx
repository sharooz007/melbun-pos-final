'use client'

import { Menu, ScanBarcode, Sun, Moon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from '@/components/theme/ThemeProvider';

export default function TopBar() {
  const pathname = usePathname();
  const { resolvedTheme, toggleTheme } = useTheme();

  if (pathname === '/login') return null;

  return (
    <header className="sticky top-0 z-[80] bg-surface/90 backdrop-blur-md border-b border-border px-4 flex items-center justify-between shrink-0 h-[60px] md:h-[64px] transition-colors duration-200">
      {/* LEFT: Menu Toggle (Mobile) */}
      <div className="flex-1 flex items-center">
        <button 
          onClick={() => window.dispatchEvent(new Event('toggle-mobile-menu'))}
          className="p-2 -ml-2 text-ink-primary hover:bg-row-alt rounded-full transition-colors md:hidden cursor-pointer"
          aria-label="Open mobile menu"
        >
          <Menu className="w-[22px] h-[22px]" />
        </button>
      </div>
      
      {/* CENTER: Typography Logo (Mobile Only, Desktop Sidebar already has it) */}
      <div className="flex-1 flex items-center justify-center">
        <span className="font-extrabold tracking-tighter text-[18px] text-ink-primary md:hidden">MELBUN</span>
      </div>
      
      {/* RIGHT: Quick Theme Toggle + Price & Stock Action */}
      <div className="flex-1 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={toggleTheme}
          title={resolvedTheme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          aria-label="Toggle theme"
          className="p-1.5 rounded-full bg-row-alt hover:bg-border text-ink-muted hover:text-ink-primary transition border border-border cursor-pointer md:hidden"
        >
          {resolvedTheme === 'dark' ? (
            <Sun className="w-4 h-4 text-amber-400" />
          ) : (
            <Moon className="w-4 h-4 text-slate-600" />
          )}
        </button>

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
