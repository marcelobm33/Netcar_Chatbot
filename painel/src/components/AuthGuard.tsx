
'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    // Skip auth check for login page
    if (pathname === '/login' || pathname === '/login/') {
      setAuthorized(true);
      return;
    }

    const token = localStorage.getItem('admin_token');
    if (!token) {
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
    } else {
      setAuthorized(true);
    }
  }, [pathname, router]);

  // Show nothing while checking (or a simple spinner)
  if (!authorized && pathname !== '/login') {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-gray-400 animate-pulse">Verificando acesso...</div>
      </div>
    );
  }

  return <>{children}</>;
}
