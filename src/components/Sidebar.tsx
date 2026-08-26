'use client'

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  LayoutDashboard, 
  ShoppingCart, 
  Package, 
  Users,
  TrendingDown, 
  BarChart3, 
  Printer, 
  Settings, 
  ScanBarcode, 
  Receipt,
  FileText,
  Menu,
  X
} from 'lucide-react';

const navItems = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'POS', href: '/pos', icon: ShoppingCart },
  { name: 'Invoices', href: '/invoices', icon: FileText },
  { name: 'Inventory', href: '/inventory/products', icon: Package },
  { name: 'Customers', href: '/customers', icon: Users },
  { name: 'Expenses', href: '/expenses', icon: Receipt },
  { name: 'Returns', href: '/returns', icon: TrendingDown },
  { name: 'Labels', href: '/labels', icon: Printer },
  { name: 'Reports', href: '/reports', icon: BarChart3 },
  { name: 'Price & Stock', href: '/lookup', icon: ScanBarcode },
];

// Top 4 items for the mobile bottom nav
const mobileNavItems = navItems.slice(0, 4);

export default function Sidebar() {
  const pathname = usePathname();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  useEffect(() => {
    const handler = () => setIsMobileMenuOpen(prev => !prev);
    window.addEventListener('toggle-mobile-menu', handler);
    return () => window.removeEventListener('toggle-mobile-menu', handler);
  }, []);


  if (pathname === '/login') return null;

  return (
    <>
      <aside className="fixed bottom-0 left-0 right-0 z-[100] bg-ink-primary border-t border-white/10 md:relative md:w-[240px] md:flex md:flex-col md:h-[100dvh] md:border-r md:border-t-0 shrink-0 pb-safe">
        <div className="hidden md:flex p-6 items-center gap-3">
          <div className="w-8 h-8 bg-accent rounded-[8px] flex items-center justify-center font-bold text-white shadow-sm">S</div>
          <span className="text-white font-bold tracking-tight text-[18px]">SLYD POS</span>
        </div>
        
        {/* DESKTOP: Full Navigation List */}
        <nav className="hidden md:flex flex-col flex-1 px-4 py-2 space-y-1 overflow-y-auto hide-scrollbar">
          {navItems.map((item) => {
            const isActive = pathname === item.href || 
              (item.href === '/inventory/products' && pathname.startsWith('/inventory')) || 
              (item.href !== '/' && item.href !== '/inventory/products' && pathname.startsWith(item.href));
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-[8px] text-[14px] font-medium transition-colors shrink-0 ${
                  isActive 
                    ? 'bg-accent/20 text-accent font-bold' 
                    : 'text-white/60 hover:bg-white/5 hover:text-white'
                }`}
              >
                <item.icon className={`w-[18px] h-[18px] ${isActive ? 'text-accent' : ''}`} />
                <span className="whitespace-nowrap">{item.name}</span>
              </Link>
            );
          })}
        </nav>

        {/* MOBILE: 4-Item Bottom Navigation */}
        <nav className="flex md:hidden flex-row justify-around items-center px-1 py-1.5">
          {mobileNavItems.map((item) => {
            const isActive = pathname === item.href || 
              (item.href === '/inventory/products' && pathname.startsWith('/inventory')) || 
              (item.href !== '/' && item.href !== '/inventory/products' && pathname.startsWith(item.href));
            return (
              <Link
                key={item.name}
                href={item.href}
                onClick={() => setIsMobileMenuOpen(false)}
                className={`flex flex-col items-center gap-1 p-2 rounded-[8px] text-[10px] font-medium transition-colors flex-1 ${
                  isActive && !isMobileMenuOpen
                    ? 'text-accent font-bold' 
                    : 'text-white/60 hover:bg-white/5 hover:text-white'
                }`}
              >
                <item.icon className={`w-[22px] h-[22px] ${isActive && !isMobileMenuOpen ? 'text-accent' : ''}`} />
                <span className="whitespace-nowrap">{item.name}</span>
              </Link>
            );
          })}
        </nav>
        
        <div className="hidden md:block p-4 border-t border-white/10">
          <Link 
            href="/settings" 
            className={`flex items-center gap-3 px-4 py-2 rounded-[8px] cursor-pointer transition-colors group ${
              pathname.startsWith('/settings')
                ? 'bg-accent/20 text-accent font-bold'
                : 'text-white/60 hover:bg-white/5 hover:text-white'
            }`}
          >
            <Settings className={`w-[18px] h-[18px] ${pathname.startsWith('/settings') ? 'text-accent' : 'text-white/60 group-hover:text-white'}`} />
            <span className={`text-[14px] font-medium ${pathname.startsWith('/settings') ? 'text-accent' : 'text-white/60 group-hover:text-white'}`}>Settings</span>
          </Link>
        </div>
      </aside>

      {/* MOBILE: Full Screen Menu Drawer */}
      {isMobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-[90] bg-ink-primary flex flex-col animate-in fade-in zoom-in-95 duration-200 pb-[80px]">
          <div className="p-6 flex items-center justify-between border-b border-white/10">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-accent rounded-[8px] flex items-center justify-center font-bold text-white shadow-sm">S</div>
              <span className="text-white font-bold tracking-tight text-[18px]">SLYD POS</span>
            </div>
            <button onClick={() => setIsMobileMenuOpen(false)} className="p-2 text-white/60 hover:text-white bg-white/5 rounded-full">
              <X className="w-6 h-6" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {navItems.map((item) => {
              const isActive = pathname === item.href || 
                (item.href === '/inventory/products' && pathname.startsWith('/inventory')) || 
                (item.href !== '/' && item.href !== '/inventory/products' && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={`flex items-center gap-4 px-4 py-4 rounded-[12px] text-[16px] font-medium transition-colors ${
                    isActive 
                      ? 'bg-accent/20 text-accent font-bold' 
                      : 'text-white/80 bg-white/5 hover:bg-white/10'
                  }`}
                >
                  <item.icon className={`w-6 h-6 ${isActive ? 'text-accent' : 'text-white/60'}`} />
                  {item.name}
                </Link>
              );
            })}
            <Link 
              href="/settings"
              onClick={() => setIsMobileMenuOpen(false)}
              className={`flex items-center gap-4 px-4 py-4 rounded-[12px] text-[16px] font-medium transition-colors mt-4 ${
                pathname.startsWith('/settings')
                  ? 'bg-accent/20 text-accent font-bold'
                  : 'text-white/80 bg-white/5 hover:bg-white/10'
              }`}
            >
              <Settings className={`w-6 h-6 ${pathname.startsWith('/settings') ? 'text-accent' : 'text-white/60'}`} />
              Settings
            </Link>
          </div>
        </div>
      )}
    </>
  );
}
