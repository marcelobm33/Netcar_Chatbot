'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Image from 'next/image';
import { 
  LayoutDashboard, Users, Ban, Clock, UserX, Phone, MessageSquare, Menu, LogOut, X, FileText, Settings, 
  BrainCircuit, ShieldAlert, KanbanSquare
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Simplified navigation - only essential features
// Note: Horários removed - store hours now come from official Netcar API
export const navItems = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Auditoria IA', href: '/pipeline', icon: BrainCircuit },
  { name: 'Vendedores', href: '/sellers', icon: Users },
  { name: 'Blocklist', href: '/blocklist', icon: UserX },
  { name: 'Follow-up', href: '/followup', icon: MessageSquare },
  { name: 'Configurações', href: '/settings', icon: Settings },
  { name: 'Documentação', href: '/docs', icon: FileText },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden border-r bg-muted/40 md:block w-[220px] lg:w-[280px] h-screen sticky top-0 flex flex-col">
      <div className="flex h-14 items-center border-b px-4 lg:h-[60px] lg:px-6 bg-white">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <Image 
            src="/logo-netcar.png" 
            alt="Netcar" 
            width={120} 
            height={32}
            className="object-contain"
          />
        </Link>
      </div>

      <div className="flex-1 overflow-auto py-4">
        <nav className="grid items-start gap-1 px-2 text-sm font-medium lg:px-4">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-3 transition-all duration-200",
                pathname === item.href 
                  ? "bg-primary text-primary-foreground shadow-md font-semibold" 
                  : "text-muted-foreground hover:text-primary hover:bg-primary/10"
              )}
            >
              <item.icon className={cn("h-5 w-5", pathname === item.href && "scale-110")} />
              {item.name}
            </Link>
          ))}
        </nav>
      </div>

      <div className="mt-auto border-t p-4">
        <div className="bg-muted/50 p-3 rounded-lg text-center">
          <p className="text-xs text-muted-foreground">iAN Bot v2.0 (R2)</p>
          <p className="text-[10px] text-muted-foreground/70 mt-1">by OConnector</p>
        </div>
      </div>
    </aside>
  );
}
