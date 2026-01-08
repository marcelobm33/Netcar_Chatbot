
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Lock, Mail, Loader2 } from 'lucide-react';

export default function LoginPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://netcar-worker.contato-11e.workers.dev';
            
            const res = await fetch(`${API_URL}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            const data = await res.json();

            if (res.ok && data.success) {
                // Store token
                localStorage.setItem('admin_token', data.token);
                // Redirect
                router.push('/');
            } else {
                setError(data.error || 'Falha ao entrar');
            }
        } catch (err) {
            setError('Erro de conexão com o servidor');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="w-full max-w-sm bg-white p-8 rounded-xl shadow-lg border border-gray-100">
            <div className="flex flex-col items-center mb-6">
                <div className="relative w-40 h-12 mb-2">
                     <Image 
                        src="/logo-netcar.png" 
                        alt="Netcar" 
                        fill
                        className="object-contain"
                        priority
                     />
                </div>
                <h1 className="text-xl font-bold text-gray-800">Acesso Restrito</h1>
                <p className="text-sm text-gray-500">Faça login para continuar</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                    <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg flex items-center gap-2">
                        <span className="font-bold">Aw, Snap!</span> {error}
                    </div>
                )}

                <div className="space-y-1">
                    <label className="text-sm font-medium text-gray-700">Email Corporativo</label>
                    <div className="relative">
                        <Mail className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                        <input 
                            type="email" 
                            required 
                            className="w-full pl-10 pr-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition"
                            placeholder="seu@email.com"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                        />
                    </div>
                </div>

                <div className="space-y-1">
                    <label className="text-sm font-medium text-gray-700">Senha</label>
                    <div className="relative">
                        <Lock className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                        <input 
                            type="password" 
                            required 
                            className="w-full pl-10 pr-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition"
                            placeholder="••••••••"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                        />
                    </div>
                </div>

                <button 
                    type="submit" 
                    disabled={loading}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-lg transition flex items-center justify-center gap-2"
                >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Entrar no Painel'}
                </button>
            </form>

            <div className="mt-6 text-center text-xs text-gray-400">
                &copy; 2025 Netcar Multimarcas
            </div>
        </div>
    );
}
