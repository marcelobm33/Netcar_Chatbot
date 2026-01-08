'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Clock, Save, RefreshCw, MessageSquare, Calendar, Plus, Trash2, Edit2, Play, Pause, Info } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";

interface FollowupSequence {
  id: number;
  nome: string;
  delay_minutos: number;
  mensagem: string;
  ativo: boolean;
  ordem: number;
}

interface FollowupConfig {
  followup_enabled: boolean;
  followup_schedule_start: string;
  followup_schedule_end: string;
  followup_weekend: boolean;
}

// Format time for display (e.g., "09:30" -> "9h30" or "18:00" -> "18h")
function formatTimeDisplay(time: string | number): string {
  if (!time && time !== 0) return '';
  const s = String(time);
  if (s.includes(':')) {
    const [h, m] = s.split(':');
    const hour = parseInt(h, 10);
    const min = parseInt(m, 10) || 0;
    return min > 0 ? `${hour}h${m}` : `${hour}h`;
  }
  return `${s}h`;
}

// Ensure time format for input (HH:MM)
function toTimeInput(val: string | number): string {
  if (!val && val !== 0) return '09:00';
  const s = String(val);
  if (s.includes(':')) return s;
  const h = parseInt(s, 10);
  return `${h.toString().padStart(2, '0')}:00`;
}

// Templates padrão do YAML do iAN (definidos no prompt do bot)
const DEFAULT_SEQUENCES: FollowupSequence[] = [
  {
    id: 1,
    nome: 'Retomada 20min',
    delay_minutos: 20,
    mensagem: 'Opa, só pra avisar que sigo por aqui se precisar, beleza?',
    ativo: true,
    ordem: 1
  },
  {
    id: 2,
    nome: 'Oferta Consultor 30min',
    delay_minutos: 30,
    mensagem: 'Se quiser agilizar e já falar direto com uma pessoa, posso acionar um consultor agora. Quer que eu acione?',
    ativo: true,
    ordem: 2
  },
  {
    id: 3,
    nome: 'Reengajamento 24h',
    delay_minutos: 1440,
    mensagem: 'E aí, tudo certo? Passando pra saber se você ainda tá na busca pelo carro novo. Quer que eu te mostre opções do estoque?',
    ativo: true,
    ordem: 3
  },
  {
    id: 4,
    nome: 'Pós-Encaminhamento',
    delay_minutos: 60,
    mensagem: 'Oi! Passando pra saber se você conseguiu falar com o consultor da Netcar?',
    ativo: true,
    ordem: 4
  }
];

export default function FollowupPage() {
  const [config, setConfig] = useState<FollowupConfig>({
    followup_enabled: true,
    followup_schedule_start: '09:00',
    followup_schedule_end: '18:00',
    followup_weekend: false,
  });
  const [sequences, setSequences] = useState<FollowupSequence[]>(DEFAULT_SEQUENCES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const { toast, error: toastError, warning: toastWarning } = useToast();
  const { confirm, confirmDelete } = useConfirmDialog();
  
  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSequence, setEditingSequence] = useState<FollowupSequence | null>(null);
  const [formNome, setFormNome] = useState('');
  const [formDelay, setFormDelay] = useState(5);
  const [formMensagem, setFormMensagem] = useState('');

  useEffect(() => {
    fetchConfig();
  }, []);

  async function fetchConfig() {
    setLoading(true);
    try {
      const data: any = await api.getConfig();
      
      setConfig({
        followup_enabled: data.followup_enabled !== 'false',
        followup_schedule_start: data.followup_schedule_start || '09:00',
        followup_schedule_end: data.followup_schedule_end || '18:00',
        followup_weekend: data.followup_weekend === 'true',
      });
      
      // Parse sequences from JSON if stored
      if (data.followup_sequences) {
        try {
          const parsed = JSON.parse(data.followup_sequences);
          if (Array.isArray(parsed)) {
            setSequences(parsed);
          }
        } catch (e) {
          console.log('Using default sequences from iAN prompt');
        }
      }
    } catch (e) {
      console.error('Erro ao carregar config:', e);
    }
    setLoading(false);
  }

  async function saveAll() {
    console.log('[DEBUG] Saving config:', config);
    setSaving(true);
    try {
      await api.setConfig('followup_enabled', String(config.followup_enabled));
      await api.setConfig('followup_schedule_start', String(config.followup_schedule_start));
      await api.setConfig('followup_schedule_end', String(config.followup_schedule_end));
      await api.setConfig('followup_weekend', String(config.followup_weekend));
      await api.setConfig('followup_sequences', JSON.stringify(sequences));
      
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: any) {
      toastError('Erro ao salvar: ' + e.message);
    }
    setSaving(false);
  }

  function resetToDefaults() {
    confirm({
      title: 'Restaurar Padrões',
      description: 'Restaurar sequências padrão do iAN? Isso vai substituir todas as suas customizações atuais.',
      confirmText: 'Restaurar',
      variant: 'warning',
      onConfirm: () => setSequences(DEFAULT_SEQUENCES)
    });
  }

  function openAddModal() {
    setEditingSequence(null);
    setFormNome('');
    setFormDelay(5);
    setFormMensagem('');
    setIsModalOpen(true);
  }

  function openEditModal(seq: FollowupSequence) {
    setEditingSequence(seq);
    setFormNome(seq.nome);
    setFormDelay(seq.delay_minutos);
    setFormMensagem(seq.mensagem);
    setIsModalOpen(true);
  }

  function handleSaveSequence() {
    if (!formNome || !formMensagem) {
      toastWarning('Preencha todos os campos');
      return;
    }

    if (editingSequence) {
      setSequences(sequences.map(s => 
        s.id === editingSequence.id 
          ? { ...s, nome: formNome, delay_minutos: formDelay, mensagem: formMensagem }
          : s
      ));
    } else {
      const newSeq: FollowupSequence = {
        id: Date.now(),
        nome: formNome,
        delay_minutos: formDelay,
        mensagem: formMensagem,
        ativo: true,
        ordem: sequences.length + 1
      };
      setSequences([...sequences, newSeq]);
    }
    setIsModalOpen(false);
  }

  function handleDelete(id: number) {
    const seq = sequences.find(s => s.id === id);
    confirmDelete(seq?.nome || 'esta sequência', () => {
      setSequences(sequences.filter(s => s.id !== id));
    });
  }

  function toggleSequence(id: number) {
    setSequences(sequences.map(s => 
      s.id === id ? { ...s, ativo: !s.ativo } : s
    ));
  }

  function formatDelay(minutos: number): string {
    if (minutos < 60) return `${minutos} min`;
    if (minutos < 1440) return `${Math.floor(minutos / 60)}h`;
    return `${Math.floor(minutos / 1440)} dia(s)`;
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <RefreshCw className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 pt-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Sequências de Follow-up</h1>
          <p className="text-muted-foreground">
            Mensagens automáticas do iAN para reengajar clientes (v1.2.1)
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={resetToDefaults}>
            Restaurar Padrão
          </Button>
          <Button onClick={saveAll} disabled={saving} className="gap-2">
            {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? 'Salvando...' : saved ? 'Salvo!' : 'Salvar Tudo'}
          </Button>
        </div>
      </div>

      {saved && (
        <div className="bg-green-100 border border-green-200 text-green-700 px-4 py-3 rounded">
          Configurações e sequências salvas com sucesso!
        </div>
      )}

      {/* Info Card - IA 24/7 */}
      <Card className="bg-amber-50 border-amber-200">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
            <div className="text-sm text-amber-800">
              <p className="font-medium">Importante: IA funciona 24/7</p>
              <p className="text-amber-700">
                O horário configurado abaixo é apenas para <strong>mensagens de follow-up</strong> (para não incomodar o cliente de madrugada). 
                A IA <strong>sempre responde</strong> quando o cliente envia mensagem, a qualquer hora.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Status</p>
                <p className="text-2xl font-bold">{config.followup_enabled ? 'Ativo' : 'Pausado'}</p>
              </div>
              <Switch
                checked={config.followup_enabled}
                onCheckedChange={(checked) => setConfig(prev => ({...prev, followup_enabled: checked}))}
              />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-6">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Horário de Envio</p>
              <div className="flex items-center gap-2 mt-1">
                <Input
                  type="time"
                  step="1800"
                  value={toTimeInput(config.followup_schedule_start)}
                  onChange={(e) => setConfig({...config, followup_schedule_start: e.target.value})}
                  className="w-32 h-9"
                />
                <span>às</span>
                <Input
                  type="time"
                  step="1800"
                  value={toTimeInput(config.followup_schedule_end)}
                  onChange={(e) => setConfig({...config, followup_schedule_end: e.target.value})}
                  className="w-32 h-9"
                />
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Finais de Semana</p>
                <p className="text-sm">{config.followup_weekend ? 'Sáb 9h-17h' : 'Desativado'}</p>
              </div>
              <Switch
                checked={config.followup_weekend}
                onCheckedChange={(checked) => setConfig({...config, followup_weekend: checked})}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Sequences List */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" /> Sequências Programadas
            </CardTitle>
            <CardDescription>
              Baseadas no prompt do iAN - Editáveis conforme necessidade
            </CardDescription>
          </div>
          <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
            <DialogTrigger asChild>
              <Button size="sm" onClick={openAddModal} className="gap-2">
                <Plus className="h-4 w-4" /> Nova Sequência
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingSequence ? 'Editar Sequência' : 'Nova Sequência'}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Nome da Sequência</Label>
                  <Input 
                    value={formNome} 
                    onChange={(e) => setFormNome(e.target.value)} 
                    placeholder="Ex: Retomada Rápida" 
                  />
                </div>
                <div className="space-y-2">
                  <Label>Delay (minutos após inatividade)</Label>
                  <Input 
                    type="number"
                    min={1}
                    value={formDelay} 
                    onChange={(e) => setFormDelay(parseInt(e.target.value, 10) || 5)} 
                  />
                  <p className="text-xs text-muted-foreground">
                    Exemplos: 20 min, 30 min, 60 min (1h), 1440 min (24h)
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Mensagem</Label>
                  <Textarea 
                    rows={4}
                    value={formMensagem} 
                    onChange={(e) => setFormMensagem(e.target.value)} 
                    placeholder="Opa, sigo por aqui se precisar..."
                  />
                  <p className="text-xs text-muted-foreground">
                    Variáveis: {'{{nome}}'}, {'{{vendedor}}'}, {'{{modelo}}'}
                  </p>
                </div>
                <Button onClick={handleSaveSequence} className="w-full">
                  {editingSequence ? 'Salvar Alterações' : 'Adicionar Sequência'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-primary/5">
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Delay</TableHead>
                <TableHead className="max-w-xs">Mensagem</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sequences.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    Nenhuma sequência configurada. Clique em "Restaurar Padrão" para usar templates do iAN.
                  </TableCell>
                </TableRow>
              ) : (
                sequences.sort((a, b) => a.delay_minutos - b.delay_minutos).map((seq, idx) => (
                  <TableRow key={seq.id} className={!seq.ativo ? 'opacity-50' : ''}>
                    <TableCell className="font-mono text-muted-foreground">{idx + 1}</TableCell>
                    <TableCell className="font-medium">{seq.nome}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="bg-blue-50 text-blue-700">
                        <Clock className="h-3 w-3 mr-1" /> {formatDelay(seq.delay_minutos)}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-muted-foreground text-sm">
                      {seq.mensagem}
                    </TableCell>
                    <TableCell>
                      {seq.ativo ? (
                        <Badge className="bg-green-100 text-green-700 border-green-200">Ativo</Badge>
                      ) : (
                        <Badge variant="secondary">Pausado</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={() => toggleSequence(seq.id)}
                          title={seq.ativo ? 'Pausar' : 'Ativar'}
                        >
                          {seq.ativo ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={() => openEditModal(seq)}
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={() => handleDelete(seq.id)}
                          className="text-red-500 hover:text-red-600"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Summary */}
      <Card className="bg-blue-50 border-blue-200">
        <CardContent className="pt-6">
          <h3 className="font-semibold text-blue-900 mb-3">Resumo da Programação (Dados Reais)</h3>
          <div className="space-y-2 text-sm text-blue-800">
            {sequences.filter(s => s.ativo).length === 0 ? (
              <p>Nenhuma sequência ativa. Ative pelo menos uma sequência para o follow-up funcionar.</p>
            ) : (
              sequences.filter(s => s.ativo).sort((a, b) => a.delay_minutos - b.delay_minutos).map((seq, idx) => (
                <div key={seq.id} className="flex items-start gap-2 p-2 bg-white/50 rounded">
                  <span className="font-mono bg-blue-100 px-2 py-0.5 rounded text-xs shrink-0">{formatDelay(seq.delay_minutos)}</span>
                  <div>
                    <span className="font-medium">{seq.nome}:</span>
                    <p className="text-blue-600 italic">"{seq.mensagem}"</p>
                  </div>
                </div>
              ))
            )}
          </div>
          {config.followup_enabled ? (
            <p className="text-xs text-green-700 mt-3 border-t border-blue-200 pt-3 font-medium">
              ATIVO - Envia entre {formatTimeDisplay(config.followup_schedule_start)} e {formatTimeDisplay(config.followup_schedule_end)}
              {config.followup_weekend ? ' (incluindo sábados)' : ' (apenas dias úteis)'}
            </p>
          ) : (
            <p className="text-xs text-orange-600 mt-3 border-t border-orange-200 pt-3 font-medium">
              PAUSADO - Nenhuma mensagem será enviada automaticamente
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
