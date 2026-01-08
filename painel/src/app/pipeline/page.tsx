'use client';

// Force Rebuild 2024-v2
import { useEffect, useState } from 'react';
import { api, Lead, Vendedor } from '@/lib/api';
// Keeping Vendedor from api for type
import { SourceIcon } from '@/components/SourceIcon';
import { AnimatedTooltip } from '@/components/ui/animated-tooltip';
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { 
  Flame, MessageCircle, Calendar, FileText, CheckCircle2, XCircle, 
  Bot, MousePointer2, RefreshCw, Car, ArrowRight, Thermometer,
  Sparkles, Sun, Snowflake, Phone, Trash2, ExternalLink, GripVertical
} from "lucide-react";
import { FaWhatsapp } from "react-icons/fa";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription 
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";

// Status Columns Configuration with Professional Icons
// Using a mapped object or component rendering for icons
const COLUMNS = [
  { id: 'novo', title: 'Novos', Icon: Sparkles, color: 'text-emerald-600', gradient: 'from-emerald-500/10 to-emerald-500/5', border: 'border-emerald-500' },
  { id: 'em_atendimento', title: 'Em Conversa', Icon: MessageCircle, color: 'text-blue-600', gradient: 'from-blue-500/10 to-blue-500/5', border: 'border-blue-500' },
  { id: 'visita_agendada', title: 'Visita/Teste', Icon: Calendar, color: 'text-orange-600', gradient: 'from-orange-500/10 to-orange-500/5', border: 'border-orange-500' },
  { id: 'proposta', title: 'Proposta', Icon: FileText, color: 'text-yellow-600', gradient: 'from-yellow-500/10 to-yellow-500/5', border: 'border-yellow-500' },
  { id: 'convertido', title: 'Vendido', Icon: CheckCircle2, color: 'text-purple-600', gradient: 'from-purple-500/10 to-purple-500/5', border: 'border-purple-500' },
  { id: 'perdido', title: 'Perdido', Icon: XCircle, color: 'text-gray-500', gradient: 'from-gray-500/10 to-gray-500/5', border: 'border-gray-400' }
];

export default function PipelinePage() {
  const { toast, success: toastSuccess, error: toastError } = useToast();
  const { confirmDelete, confirm } = useConfirmDialog();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [autoMove, setAutoMove] = useState(true);
  const [draggedLeadId, setDraggedLeadId] = useState<string | null>(null);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);

  useEffect(() => {
    fetchLeads();
    fetchVendedores();
    fetchConfig();
    
    // Auto-refresh every 30s
    const interval = setInterval(fetchLeads, 30000);
    return () => clearInterval(interval);
  }, []);

  async function fetchConfig() {
    try {
        const configs: any[] = await api.getConfig();
        const conf = configs.find((c: any) => c.key === 'crm_automove');
        if (conf) {
          setAutoMove(conf.value === 'true');
        }
    } catch(e) { console.error(e); }
  }

  async function toggleAutoMove() {
    const newValue = !autoMove;
    setAutoMove(newValue);
    try {
        await api.setConfig('crm_automove', String(newValue));
    } catch(e) { 
        setAutoMove(!newValue); // revert
        console.error(e); 
    }
  }

  async function fetchLeads() {
    try {
        // Fetch large limit
        const result = await api.getLeads(1000);
        setLeads(result.leads || []);
    } catch(e) { console.error(e); }
    setLoading(false);
    setRefreshing(false);
  }

  async function handleRefresh() {
    setRefreshing(true);
    await fetchLeads();
  }

  async function fetchVendedores() {
      try {
        const data: any = await api.getSellers();
        setVendedores(data || []);
      } catch (e) { console.error(e); }
  }

  async function updateStatus(id: string, status: string) {
    try {
        await api.updateLead(id, { status, updated_at: new Date().toISOString() });
        fetchLeads();
        if (selectedLead?.id === id) {
             setSelectedLead({ ...selectedLead, status });
        }
    } catch(e: any) { toastError(e.message); }
  }

  async function assignVendedor(vendedor: Vendedor) {
    if (!selectedLead) return;
    
    try {
        await api.updateLead(selectedLead.id, {
            vendedor_id: vendedor.id,
            vendedor_nome: vendedor.nome,
            status: 'em_atendimento',
            updated_at: new Date().toISOString()
        });
        
        fetchLeads();
        setSelectedLead({
            ...selectedLead,
            vendedor_id: vendedor.id,
            vendedor_nome: vendedor.nome,
            status: 'em_atendimento'
        });
    } catch(e: any) { toastError(e.message); }
  }

  function deleteLead(id: string) {
    const lead = leads.find(l => l.id === id);
    confirmDelete(lead?.nome || 'este lead', async () => {
      try {
        await api.deleteLead(id);
        setSelectedLead(null);
        fetchLeads();
      } catch(e: any) { toastError(e.message); }
    });
  }

  function reAnalyzeLead(lead: Lead) {
    confirm({
      title: 'Re-processar Lead com IA',
      description: 'Isso irá gerar um novo resumo e qualificação baseados na conversa atual. Deseja continuar?',
      confirmText: 'Re-processar',
      variant: 'info',
      onConfirm: async () => {
        try {
          const token = localStorage.getItem('admin_token') || '';
          const WORKER_URL = 'https://netcar-worker.contato-11e.workers.dev';
          
          const cleanPhone = lead.telefone.replace(/\D/g, '');
          const res = await fetch(`${WORKER_URL}/api/debug/summarize?phone=${cleanPhone}@s.whatsapp.net`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${token}` }
          });
          
          if (res.ok) {
              toastSuccess('IA re-processada com sucesso! Atualizando...');
              fetchLeads();
              setSelectedLead(null);
          } else {
              toastError('Erro ao re-processar lead.');
          }
        } catch(e: any) { 
          console.error(e); 
          toastError('Erro de conexão.');
        }
      }
    });
  }

  function moveLead(leadId: string, newStatus: string) {
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status: newStatus } : l));
    // Optimistic update, but ensuring API call happens
    api.updateLead(leadId, { status: newStatus, updated_at: new Date().toISOString() })
       .catch(e => {
           console.error(e);
           fetchLeads(); // revert on error
       });
  }

  function openWhatsApp(telefone: string) {
    const clean = telefone.replace(/\D/g, '');
    window.open(`https://wa.me/${clean}`, '_blank');
  }

  function formatDate(date: string) {
    return new Date(date).toLocaleString('pt-BR');
  }

  function getStatusBadge(status: string) {
    switch (status) {
      case 'novo': return <Badge variant="secondary">Novo</Badge>;
      case 'em_atendimento': return <Badge className="bg-blue-500 hover:bg-blue-600">Em Conversa</Badge>;
      case 'visita_agendada': return <Badge className="bg-orange-500 hover:bg-orange-600">Visita</Badge>;
      case 'proposta': return <Badge className="bg-yellow-500 hover:bg-yellow-600">Proposta</Badge>;
      case 'convertido': return <Badge variant="success">Vendido</Badge>;
      case 'perdido': return <Badge variant="destructive">Perdido</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  }

  // Score 2D Quadrant Badge
  function getQuadrantBadge(quadrant: string | null | undefined, engagement?: number, fit?: number) {
    const e = engagement || 0;
    const f = fit || 0;
    const tooltip = `Engajamento: ${e}% | Fit: ${f}%`;
    
    switch (quadrant) {
      case 'hot':
        return (
          <span title={tooltip} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-semibold">
            <Flame className="w-3 h-3" /> Hot
          </span>
        );
      case 'warm':
        return (
          <span title={tooltip} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 text-[10px] font-semibold">
            <Sun className="w-3 h-3" /> Warm
          </span>
        );
      case 'nurture':
        return (
          <span title={tooltip} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 text-[10px] font-semibold">
            <Thermometer className="w-3 h-3" /> Nurture
          </span>
        );
      case 'cold':
      default:
        return (
          <span title={tooltip} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-semibold">
            <Snowflake className="w-3 h-3" /> Cold
          </span>
        );
    }
  }

  // --- HTML5 Drag & Drop Logic ---

  function handleDragStart(e: React.DragEvent, leadId: string) {
    setDraggedLeadId(leadId);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function handleDrop(e: React.DragEvent, statusId: string) {
    e.preventDefault();
    if (draggedLeadId) {
      moveLead(draggedLeadId, statusId);
      setDraggedLeadId(null);
    }
  }

  // -------------------------------

  function formatPhone(phone: string) {
    if (!phone) return '';
    return phone.replace('@s.whatsapp.net', '').replace('@lid', '');
  }

  function getTemperatureBorder(temp: string | null) {
    if (temp === 'HOT') return 'border-l-4 border-l-red-500';
    if (temp === 'WARM') return 'border-l-4 border-l-orange-400';
    return 'border-l-4 border-l-blue-300';
  }

  function getInitials(nome: string | null, telefone: string) {
    if (nome && nome.length > 0) return nome.charAt(0).toUpperCase();
    return formatPhone(telefone).slice(-2);
  }

  const totalLeads = leads.length;
  const hotLeads = leads.filter(l => (l as any).temperature === 'HOT').length;
  const todayLeads = leads.filter(l => {
    const today = new Date();
    today.setHours(0,0,0,0);
    return new Date(l.created_at) >= today;
  }).length;

  // Colors for columns based on Netcar reference
  const columnColors: Record<string, string> = {
    'novo': 'bg-indigo-500',
    'em_atendimento': 'bg-blue-500',
    'agendamento': 'bg-emerald-500',
    'visita_realizada': 'bg-orange-500',
    'proposta': 'bg-green-600',
    'aguardando_retorno': 'bg-yellow-500',
    'fechamento': 'bg-teal-600',
    'entregue': 'bg-purple-600',
    'perdido': 'bg-red-500',
  };

  const getColumnColor = (statusId: string) => columnColors[statusId] || 'bg-gray-500';

  if (loading) {
    return (
      <div className="h-full flex flex-col bg-gray-50/50">
        {/* Header Skeleton */}
        <div className="px-6 py-4 bg-background/80 border-b">
          <div className="flex justify-between items-center">
            <div>
              <div className="h-7 w-48 bg-gray-200 dark:bg-gray-700 rounded animate-pulse mb-2" />
              <div className="h-4 w-64 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
            </div>
            <div className="flex items-center gap-4">
              <div className="h-8 w-24 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
              <div className="h-10 w-28 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
            </div>
          </div>
        </div>
        
        {/* Kanban Skeleton */}
        <div className="flex-1 overflow-x-auto p-4">
          <div className="grid grid-cols-6 gap-3 min-w-[1100px]">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex flex-col bg-muted/20 rounded-xl">
                <div className="h-14 bg-gray-300 dark:bg-gray-600 rounded-t-xl animate-pulse" />
                <div className="p-2 space-y-3">
                  {Array.from({ length: 3 }).map((_, j) => (
                    <div key={j} className="bg-white rounded-lg p-3 shadow-sm border">
                      <div className="h-4 w-3/4 bg-gray-200 rounded animate-pulse mb-2" />
                      <div className="flex items-center gap-2 mb-2">
                        <div className="h-8 w-8 bg-gray-200 rounded-full animate-pulse" />
                        <div className="flex-1">
                          <div className="h-3 w-24 bg-gray-200 rounded animate-pulse mb-1" />
                          <div className="h-2 w-16 bg-gray-200 rounded animate-pulse" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-gray-50/50">
      {/* Header */}
      <div className="px-6 py-4 bg-background/80 backdrop-blur-sm border-b border-border sticky top-0 z-10">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              Auditoria de IA & Qualidade
            </h1>
            <p className="text-muted-foreground text-sm mt-0.5">Supervisão automotiva e validação de leads</p>
          </div>
          
          <div className="flex items-center gap-6">
            
            {/* Auto/Manual Toggle Switch */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/50 border">
              <Bot className={`h-4 w-4 ${autoMove ? 'text-green-600' : 'text-orange-500'}`} />
              <span className={`text-xs font-medium ${autoMove ? 'text-green-700' : 'text-orange-600'}`}>
                {autoMove ? 'Auto' : 'Manual'}
              </span>
              <Switch 
                checked={autoMove} 
                onCheckedChange={toggleAutoMove}
                className="data-[state=checked]:bg-green-600"
              />
            </div>

            <div className="flex items-center gap-6 border-l pl-6 border-border">
              <div className="text-center hidden lg:block">
                <p className="text-xl font-bold text-foreground">{totalLeads}</p>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Total</p>
              </div>
              <div className="text-center hidden lg:block">
                <p className="text-xl font-bold text-red-500">{hotLeads}</p>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Quentes</p>
              </div>
              
              <Button 
                onClick={handleRefresh} 
                variant="outline"
                className="gap-2"
                disabled={refreshing}
              >
                <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                {refreshing ? 'Atualizando...' : 'Atualizar'}
              </Button>
            </div>

          </div>
        </div>
      </div>

      {/* Kanban Board */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="grid grid-cols-6 h-full gap-3 pb-4 px-2 min-w-[1100px]">
          {COLUMNS.map(col => {
             const columnLeads = leads.filter(l => l.status === col.id);
             
             return (
              <div key={col.id} className="flex flex-col bg-muted/20 rounded-xl"
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, col.id)}
              >
                {/* Netcar-style Colorful Header */}
                <div className={`p-3 rounded-t-xl text-white text-center shadow-sm mb-2 ${getColumnColor(col.id)}`}>
                  <h3 className="font-medium tracking-wide text-sm">{col.title}</h3>
                  <div className="text-[10px] opacity-90 mt-1 font-medium">
                    LEADS: {columnLeads.length}
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-3">
                  {columnLeads.map(lead => (
                    <div 
                      key={lead.id} 
                      style={{ border: '1px solid #fdba74' }}
                      className={`bg-white rounded-lg p-3 shadow-sm hover:shadow-md hover:border-orange-400 transition-all duration-200 group cursor-grab active:cursor-grabbing relative ${draggedLeadId === lead.id ? 'opacity-50 rotate-1' : ''}`}
                      onClick={() => setSelectedLead(lead)}
                      draggable
                      onDragStart={(e) => handleDragStart(e, lead.id)}
                    >
                      {/* Drag Handle */}
                      <div className="absolute top-2 right-2 text-gray-300 hover:text-gray-500 cursor-grab z-20">
                         <GripVertical className="h-4 w-4" />
                      </div>
                      {/* Vehicle Interest (Top Highlight) */}
                      <div className="mb-2 relative">
                        <span className="font-medium text-xs text-gray-700 block line-clamp-2 pr-2">
                           {lead.modelo_interesse || lead.interesse || 'Interesse não informado'}
                        </span>
                      </div>

                      {/* Client Info */}
                      <div className="flex items-center gap-2 mb-2">
                        <div className="flex-shrink-0">
                           <div className="h-8 w-8 rounded-full bg-gray-100 flex items-center justify-center overflow-hidden border border-gray-100">
                             {getInitials(lead.nome, lead.telefone)}
                           </div>
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-gray-900 truncate">{lead.nome || 'Sem Nome'}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                             <p className="text-[10px] text-gray-400 uppercase tracking-wide">
                               {lead.vendedor_nome || 'SEM VENDEDOR'}
                             </p>
                             {lead.vendedor_id && (
                               <div className="flex items-center">
                                 {(() => {
                                   const seller = vendedores.find(v => v.id === lead.vendedor_id);
                                   if (!seller) return null;
                                   return (
                                     <Avatar className="h-4 w-4 ml-1 ring-1 ring-white">
                                       <AvatarImage src={seller.imagem} />
                                       <AvatarFallback className="text-[8px] bg-primary text-primary-foreground">
                                         {seller.nome.charAt(0)}
                                       </AvatarFallback>
                                     </Avatar>
                                   );
                                 })()}
                               </div>
                             )}
                          </div>
                        </div>
                      </div>

                      {/* Footer: Source & Actions */}
                      <div className="flex items-center justify-between pt-2 border-t border-gray-50 mt-1">
                        <div className="flex items-center gap-2">
                           <div title={`Origem: ${lead.origin_source || 'Desconhecida'}`} className="flex items-center gap-1">
                             <SourceIcon source={lead.origin_source} className="w-4 h-4" />
                             <span className="text-[10px] text-gray-400 capitalize">{lead.origin_source || 'Direto'}</span>
                           </div>
                           {/* Score 2D Quadrant Badge */}
                           {getQuadrantBadge((lead as any).lead_quadrant, (lead as any).engagement_score, (lead as any).fit_score)}
                        </div>
                        
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                           <Button variant="ghost" size="icon" className="h-6 w-6"><Phone className="h-3 w-3 text-green-600" /></Button>
                        </div>
                      </div>
                      
                      {/* Lead Scoring Thermometer 🌡️ */}
                      {(lead.score && lead.score > 0) && (
                        <div className="mt-2 flex items-center gap-2">
                          <Thermometer className={`h-3.5 w-3.5 ${(lead.score || 0) >= 70 ? 'text-red-500' : (lead.score || 0) >= 40 ? 'text-orange-500' : 'text-blue-400'}`} />
                          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div 
                              className={`h-full transition-all duration-500 ${
                                (lead.score || 0) >= 70 ? 'bg-gradient-to-r from-orange-500 to-red-500' : 
                                (lead.score || 0) >= 40 ? 'bg-gradient-to-r from-yellow-400 to-orange-500' : 
                                'bg-gradient-to-r from-blue-300 to-blue-400'
                              }`} 
                              style={{ width: `${lead.score || 0}%` }}
                            />
                          </div>
                          <span className={`text-[10px] font-bold ${(lead.score || 0) >= 70 ? 'text-red-600' : (lead.score || 0) >= 40 ? 'text-orange-600' : 'text-blue-500'}`}>
                            {lead.score}%
                          </span>
                        </div>
                      )}
                      
                      {/* AI Summary Badge inside card if needed */}
                      {lead.ia_summary && (
                         <div className="mt-2 bg-blue-50 text-blue-700 text-[10px] p-1.5 rounded border border-blue-100 line-clamp-2">
                           🤖 {lead.ia_summary}
                         </div>
                      )}

                    </div>
                  ))}
                  {columnLeads.length === 0 && (
                    <div className="h-24 flex items-center justify-center border-2 border-dashed border-gray-200 rounded-lg text-gray-300 text-xs uppercase font-medium">
                      Vazio
                    </div>
                  )}
                </div>
              </div>
             );
          })}
        </div>
      </div>
      <Dialog open={!!selectedLead} onOpenChange={(open) => !open && setSelectedLead(null)}>
        <DialogContent className="overflow-y-auto max-h-[85vh] sm:max-w-lg">
          <DialogHeader className="mb-4">
            <DialogTitle>Detalhes do Lead</DialogTitle>
            <DialogDescription>
              Informações completas e histórico de interações.
            </DialogDescription>
          </DialogHeader>
          {selectedLead && (
            <>

              <div className="space-y-6">
                {/* Header Info */}
                <div className="flex items-start gap-4">
                  <Avatar className="h-16 w-16">
                     <AvatarImage src={`https://ui-avatars.com/api/?name=${selectedLead.nome}&background=random`} />
                     <AvatarFallback>{selectedLead.nome?.charAt(0)}</AvatarFallback>
                  </Avatar>
                  <div>
                    <h3 className="text-lg font-bold leading-none mb-1 flex items-center gap-2">
                       <SourceIcon source={selectedLead.origin_source} className="w-4 h-4" />
                       {selectedLead.nome || 'Sem Nome'}
                    </h3>
                    <p className="text-muted-foreground text-sm flex items-center gap-1">
                      <Phone className="h-3 w-3" /> {formatPhone(selectedLead.telefone)}
                    </p>
                    <div className="mt-2 text-xs text-muted-foreground">
                      Criado em {formatDate(selectedLead.created_at)}
                    </div>
                  </div>
                </div>

                <div className="grid gap-2">
                   <Button onClick={() => openWhatsApp(selectedLead.telefone)} className="w-full bg-[#25D366] hover:bg-[#128C7E] text-white">
                     <FaWhatsapp className="mr-2 h-4 w-4" /> Iniciar WhatsApp
                   </Button>
                </div>

                {/* Status & Vendedor */}
                <div className="space-y-4 rounded-lg border p-4 bg-muted/40">
                   <div className="flex justify-between items-center">
                     <span className="text-sm font-medium">Status Atual</span>
                     {getStatusBadge(selectedLead.status)}
                   </div>
                   
                   <div className="space-y-2">
                     <span className="text-sm font-medium block">Vendedor Responsável</span>
                     <div className="flex flex-wrap gap-2">
                       {vendedores.map(v => (
                         <Button
                           key={v.id}
                           variant={selectedLead.vendedor_id === v.id ? "default" : "outline"}
                           size="sm"
                           onClick={() => assignVendedor(v)}
                           className={`h-9 text-xs gap-2 ${selectedLead.vendedor_id === v.id ? 'pl-1' : ''}`}
                         >
                           {v.imagem && (
                             <Avatar className="h-6 w-6">
                               <AvatarImage src={v.imagem} />
                               <AvatarFallback>{v.nome.charAt(0)}</AvatarFallback>
                             </Avatar>
                           )}
                           {v.nome.split(' ')[0]}
                         </Button>
                       ))}
                     </div>
                   </div>
                </div>

                {/* Interesse */}
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    <Car className="h-4 w-4" /> Veículo de Interesse
                  </h4>
                  {selectedLead.modelo_interesse || selectedLead.interesse ? (
                     <div className="bg-blue-50/50 border border-blue-100 p-3 rounded-md text-sm text-blue-900">
                       {selectedLead.modelo_interesse || selectedLead.interesse}
                     </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Nenhum veículo identificado.</p>
                  )}
                </div>

                {/* Resumo IA */}
                {selectedLead.ia_summary && (
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold flex items-center gap-2">
                      🧠 Resumo IA
                    </h4>
                    <div className="bg-amber-50/50 border border-amber-100 p-3 rounded-md text-sm text-amber-900 leading-relaxed">
                      {selectedLead.ia_summary}
                    </div>
                  </div>
                )}

                <div className="pt-2">
                   <Button variant="outline" className="w-full border-blue-200 text-blue-700 hover:bg-blue-50" onClick={() => reAnalyzeLead(selectedLead)}>
                     <Bot className="mr-2 h-4 w-4" /> Re-processar IA (Debug)
                   </Button>
                </div>
                
                <div className="pt-4 border-t">
                  <Button variant="destructive" className="w-full" onClick={() => deleteLead(selectedLead.id)}>
                    <Trash2 className="mr-2 h-4 w-4" /> Excluir Lead
                  </Button>
                </div>

              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
