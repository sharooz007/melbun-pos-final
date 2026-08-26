'use client'

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
  FileText
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

export default function Sidebar() {
  const pathname = usePathname();

  if (pathname === '/login') return null;

  return (
    <aside className="w-[240px] bg-ink-primary flex flex-col h-[100dvh] sticky top-0 border-r border-white/10 shrink-0">
      <div className="p-6 flex items-center gap-3">
        <div className="w-8 h-8 bg-accent rounded-[8px] flex items-center justify-center font-bold text-white shadow-[0_2px_10px_rgba(168,61,36,0.5)]">S</div>
        <span className="text-white font-bold tracking-tight text-[18px]">SLYD POS</span>
      </div>
      
      <nav className="flex-1 px-4 py-2 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = pathname === item.href || 
            (item.href === '/inventory/products' && pathname.startsWith('/inventory')) || 
            (item.href !== '/' && item.href !== '/inventory/products' && pathname.startsWith(item.href));
          return (
            <Link
              key={item.name}
              href={item.href}
              className={`flex items-center gap-3 px-4 py-2.5 rounded-[8px] text-[14px] font-medium transition-colors ${
                isActive 
                  ? 'bg-accent/20 text-accent font-bold' 
                  : 'text-white/60 hover:bg-white/5 hover:text-white'
              }`}
            >
              <item.icon className={`w-[18px] h-[18px] ${isActive ? 'text-accent' : ''}`} />
              {item.name}
            </Link>
          );
        })}
      </nav>
      
      <div className="p-4 border-t border-white/10">
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
  );
}
