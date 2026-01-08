'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api'; // getSupabase removed
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, Play, PauseCircle } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";

interface Blocklist {
  id: string; // Phone is the ID
  telefone: string;
  motivo: string;
  pausado_em: string;
  expira_em: string;
}

function validateBrazilianPhone(phone: string): boolean {
  const cleaned = phone.replace(/\D/g, '');
  // 55 + DDD + 9 digits (13 total) or 55 + DDD + 8 digits (12 total)
  return /^55\d{10,11}$/.test(cleaned);
}

export default function BlocklistPage() {
  const { toast, error: toastError, warning: toastWarning } = useToast();
  const { confirm } = useConfirmDialog();
  const [items, setItems] = useState<Blocklist[]>([]);
  const [filteredItems, setFilteredItems] = useState<Blocklist[]>([]);
  const [loading, setLoading] = useState(true);
  const [newPhone, setNewPhone] = useState('');
  const [searchPhone, setSearchPhone] = useState('');
  const [adding, setAdding] = useState(false);
  const [isManualBlock, setIsManualBlock] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    fetchBlocklist();
  }, []);

  useEffect(() => {
    if (searchPhone.trim() === '') {
      setFilteredItems(items);
    } else {
      const search = searchPhone.replace(/\D/g, '');
      setFilteredItems(items.filter(item => 
        item.telefone.includes(search)
      ));
    }
  }, [searchPhone, items]);

  async function fetchBlocklist() {
    setLoading(true);
    try {
        const resp: any = await api.getBlocklist(1000);
        const data = (resp.entries || []).map((e: any) => ({
            ...e,
            id: e.telefone, // Use phone as ID
            motivo: e.motivo || 'Manual'
        }));
        setItems(data);
        setFilteredItems(data);
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  async function addToBlocklist() {
    if (!newPhone.trim()) {
      toastWarning('Digite um número de telefone');
      return;
    }

    if (!validateBrazilianPhone(newPhone)) {
      toastWarning('Número inválido! Use o formato: 5511999999999');
      return;
    }
    
    setAdding(true);
    setAdding(true);
    
    const cleanPhone = newPhone.replace(/\D/g, '');
    const daysToAdd = isManualBlock ? 36500 : 30;
    const motivo = isManualBlock ? 'Bloqueio manual permanente' : 'Pausa automática (30 dias)';
    
    try {
        const result: any = await api.addToBlocklist(cleanPhone, motivo, daysToAdd);
        if (result.success) {
            setNewPhone('');
            setIsManualBlock(false);
            setSuccessMessage(`Número ${cleanPhone} adicionado à blocklist com sucesso!`);
            setTimeout(() => setSuccessMessage(null), 3000);
            fetchBlocklist();
        } else {
             toastError('Erro ao adicionar');
        }
    } catch (e: any) { toastError('Erro: ' + e.message); }
    
    setAdding(false);
  }

  function removeFromBlocklist(phone: string) {
    confirm({
      title: 'Despausar número',
      description: 'Deseja despausar este número? O bot voltará a responder automaticamente.',
      confirmText: 'Despausar',
      variant: 'info',
      onConfirm: async () => {
        try {
          await api.removeFromBlocklist(phone);
          fetchBlocklist();
        } catch (e: any) { toastError('Erro: ' + e.message); }
      }
    });
  }

  function formatPhone(phone: string) {
    if (!phone) return '-';
    const clean = phone.replace(/\D/g, '');
    if (clean.length === 13) {
      return `+${clean.slice(0, 2)} (${clean.slice(2, 4)}) ${clean.slice(4, 9)}-${clean.slice(9)}`;
    }
    return phone;
  }

  function formatDate(date: string) {
    return new Date(date).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function getDaysRemaining(expira: string) {
    const now = new Date();
    const exp = new Date(expira);
    const diff = Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return diff;
  }

  function checkIfManualBlock(motivo: string | null) {
    return motivo === 'Bloqueio manual permanente';
  }

  function getDaysBadge(expira: string, motivo: string | null) {
    const isManual = checkIfManualBlock(motivo);
    
    if (isManual) {
      return <Badge variant="secondary" className="bg-purple-100 text-purple-700 border-purple-300">Bloqueio Manual</Badge>;
    }
    
    const diff = getDaysRemaining(expira);
    
    if (diff <= 0) return <Badge variant="destructive">Expirado</Badge>;
    if (diff <= 7) return <Badge variant="warning">{diff} dias restantes</Badge>;
    return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">{diff} dias restantes</Badge>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
         <div>
           <h1 className="text-3xl font-bold tracking-tight">Blocklist</h1>
           <p className="text-muted-foreground">Números pausados não recebem respostas automáticas do bot.</p>
         </div>
      </div>

      {successMessage && (
         <div className="bg-green-100 border border-green-200 text-green-700 px-4 py-3 rounded relative" role="alert">
           <strong className="font-bold">Sucesso! </strong>
           <span className="block sm:inline">{successMessage}</span>
         </div>
       )}

       <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Add Actions */}
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle>Pausar/Bloquear Número</CardTitle>
            <CardDescription>Pause temporário (30 dias) ou bloqueio permanente.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
             <Input 
               placeholder="Ex: 5511999999999" 
               value={newPhone}
               onChange={(e) => setNewPhone(e.target.value)}
             />
             <div className="flex items-center gap-2 p-3 border rounded-lg">
               <input 
                 type="checkbox" 
                 id="manual-block"
                 checked={isManualBlock}
                 onChange={(e) => setIsManualBlock(e.target.checked)}
                 className="rounded border-gray-300 text-primary focus:ring-primary"
               />
               <label htmlFor="manual-block" className="text-sm cursor-pointer flex-1">
                 Bloqueio <strong>Manual Permanente</strong> (apenas desbloqueio manual)
               </label>
             </div>
             <Button onClick={addToBlocklist} disabled={adding} className="w-full" variant="destructive">
               {adding ? 'Pausando...' : <><PauseCircle className="mr-2 h-4 w-4" /> {isManualBlock ? 'Bloquear' : 'Pausar (30 dias)'}</>}
             </Button>
          </CardContent>
        </Card>

        {/* List */}
        <Card className="md:col-span-2">
           <CardHeader>
             <div className="flex justify-between items-center">
               <CardTitle>Números Em Pausa</CardTitle>
               <div className="relative w-48">
                 <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                 <Input 
                   placeholder="Buscar..." 
                   className="pl-8 h-9" 
                   value={searchPhone}
                   onChange={(e) => setSearchPhone(e.target.value)}
                 />
               </div>
             </div>
           </CardHeader>
           <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-primary/5">
                  <TableRow className="border-primary/10 hover:bg-transparent">
                    <TableHead className="text-primary font-semibold">Telefone</TableHead>
                    <TableHead className="text-primary font-semibold">Motivo</TableHead>
                    <TableHead className="text-primary font-semibold">Fim da Pausa</TableHead>
                    <TableHead className="text-right text-primary font-semibold">Ação</TableHead>
                  </TableRow>
                </TableHeader>
               <TableBody>
                 {loading ? (
                    <TableRow>
                      <TableCell colSpan={4} className="h-24 text-center">
                        <div className="flex justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>
                      </TableCell>
                    </TableRow>
                 ) : filteredItems.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                        Nenhum número na blocklist.
                      </TableCell>
                    </TableRow>
                 ) : (
                    filteredItems.map((item) => (
                       <TableRow key={item.id} className="border-b border-primary/10 hover:bg-primary/5 transition-colors">
                        <TableCell className="font-mono">{formatPhone(item.telefone)}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">{item.motivo || 'Manual'}</TableCell>
                        <TableCell>{getDaysBadge(item.expira_em, item.motivo)}</TableCell>
                        <TableCell className="text-right">
                           <Button 
                             size="sm" 
                             variant="outline" 
                             className="text-green-600 hover:text-green-700 hover:bg-green-50 border-green-300" 
                             onClick={() => removeFromBlocklist(item.telefone)}
                           >
                             <Play className="h-4 w-4 mr-1" /> Desbloquear
                           </Button>
                        </TableCell>
                      </TableRow>
                    ))
                 )}
               </TableBody>
             </Table>
           </CardContent>
        </Card>
      </div>
    </div>
  );
}
