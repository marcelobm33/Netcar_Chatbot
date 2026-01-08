
'use client';

import { usePathname } from 'next/navigation';
import Sidebar from "@/components/Sidebar";
import Header from "@/components/Header";
import AuthGuard from "@/components/AuthGuard";
import { ToastProvider } from "@/components/ui/toast";
import { ConfirmDialogProvider } from "@/components/ui/confirm-dialog";

export default function ClientLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const isLoginPage = pathname === '/login' || pathname === '/login/';

    if (isLoginPage) {
        return (
            <ToastProvider>
                <ConfirmDialogProvider>
                    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">{children}</main>
                </ConfirmDialogProvider>
            </ToastProvider>
        );
    }

    return (
        <ToastProvider>
            <ConfirmDialogProvider>
                <AuthGuard>
                    <div className="grid min-h-screen md:grid-cols-[220px_1fr] lg:grid-cols-[280px_1fr]">
                        <Sidebar />
                        <div className="flex flex-col">
                            <Header />
                            <main className="flex flex-1 flex-col bg-muted/20 overflow-x-hidden">
                                <div className="w-full max-w-[1600px] mx-auto p-4 lg:p-6 flex flex-col gap-4 lg:gap-6">
                                    {children}
                                    
                                    <footer className="mt-auto py-3 border-t border-border/50 w-full">
                                        <p className="text-xs text-muted-foreground text-center w-full">
                                            © 2025 Netcar. Todos os direitos reservados. • Desenvolvido por <a href="https://oconnector.tech" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-medium">OConnector Technology</a>
                                        </p>
                                    </footer>
                                </div>
                            </main>
                        </div>
                    </div>
                </AuthGuard>
            </ConfirmDialogProvider>
        </ToastProvider>
    );
}
