'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, Save, RefreshCw, Clock, MessageSquare, CheckCircle } from "lucide-react";
import { useToast } from "@/components/ui/toast";

interface FollowupSequence {
  id: string;
  nome: string;
  delay_minutos: number;
  mensagem: string;
  ativo: boolean;
}

export default function FollowupConfigPage() {
  const [sequences, setSequences] = useState<FollowupSequence[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const { toast, error: toastError } = useToast();
  
  // General settings
  const [enabled, setEnabled] = useState(true);
  const [scheduleStart, setScheduleStart] = useState(9);
  const [scheduleEnd, setScheduleEnd] = useState(18);
  const [weekendEnabled, setWeekendEnabled] = useState(false);

  useEffect(() => {
    loadConfig();
  }, []);

  async function loadConfig() {
    setLoading(true);
    try {
      // Load followup_sequences
      const sequencesRes = await api.getConfig('followup_sequences');
      if (sequencesRes && typeof sequencesRes === 'string') {
        try {
          const parsed = JSON.parse(sequencesRes);
          if (Array.isArray(parsed)) {
            setSequences(parsed);
          }
        } catch (e) {
          console.error('Failed to parse sequences:', e);
        }
      }
      
      // Load other settings
      const enabledRes = await api.getConfig('followup_enabled');
      if (enabledRes !== null) setEnabled(enabledRes === 'true');
      
      const startRes = await api.getConfig('followup_schedule_start');
      if (startRes) setScheduleStart(parseInt(startRes, 10) || 9);
      
      const endRes = await api.getConfig('followup_schedule_end');
      if (endRes) setScheduleEnd(parseInt(endRes, 10) || 18);
      
      const weekendRes = await api.getConfig('followup_weekend');
      if (weekendRes !== null) setWeekendEnabled(weekendRes === 'true');
      
    } catch (error) {
      console.error('Failed to load config:', error);
    } finally {
      setLoading(false);
    }
  }

  async function saveConfig() {
    setSaving(true);
    try {
      // Save all settings
      await api.setConfig('followup_sequences', JSON.stringify(sequences));
      await api.setConfig('followup_enabled', enabled.toString());
      await api.setConfig('followup_schedule_start', scheduleStart.toString());
      await api.setConfig('followup_schedule_end', scheduleEnd.toString());
      await api.setConfig('followup_weekend', weekendEnabled.toString());
      
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (error) {
      console.error('Failed to save config:', error);
      toastError('Erro ao salvar configurações');
    } finally {
      setSaving(false);
    }
  }

  function addSequence() {
    const newSeq: FollowupSequence = {
      id: Date.now().toString(),
      nome: `Sequência ${sequences.length + 1}`,
      delay_minutos: 4,
      mensagem: 'Oi! Vi que você estava procurando um carro. Posso ajudar?',
      ativo: true,
    };
    setSequences([...sequences, newSeq]);
  }

  function updateSequence(id: string, field: keyof FollowupSequence, value: any) {
    setSequences(sequences.map(seq => 
      seq.id === id ? { ...seq, [field]: value } : seq
    ));
  }

  function removeSequence(id: string) {
    setSequences(sequences.filter(seq => seq.id !== id));
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Configuração de Follow-ups</h1>
          <p className="text-muted-foreground">Configure as mensagens automáticas de acompanhamento</p>
        </div>
        <Button 
          onClick={saveConfig} 
          disabled={saving}
          className="gap-2"
        >
          {saved ? (
            <>
              <CheckCircle className="w-4 h-4" />
              Salvo!
            </>
          ) : saving ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              Salvando...
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              Salvar Configurações
            </>
          )}
        </Button>
      </div>

      {/* General Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Configurações Gerais
          </CardTitle>
          <CardDescription>
            Defina quando os follow-ups podem ser enviados
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="enabled">Follow-ups Ativos</Label>
              <p className="text-sm text-muted-foreground">Enviar mensagens automáticas de acompanhamento</p>
            </div>
            <Switch
              id="enabled"
              checked={enabled}
              onCheckedChange={setEnabled}
            />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="scheduleStart">Horário Início</Label>
              <Input
                id="scheduleStart"
                type="number"
                min={0}
                max={23}
                value={scheduleStart}
                onChange={(e) => setScheduleStart(parseInt(e.target.value, 10) || 9)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="scheduleEnd">Horário Fim</Label>
              <Input
                id="scheduleEnd"
                type="number"
                min={0}
                max={23}
                value={scheduleEnd}
                onChange={(e) => setScheduleEnd(parseInt(e.target.value, 10) || 18)}
              />
            </div>
          </div>
          
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="weekend">Enviar no Fim de Semana</Label>
              <p className="text-sm text-muted-foreground">Permitir follow-ups aos sábados e domingos</p>
            </div>
            <Switch
              id="weekend"
              checked={weekendEnabled}
              onCheckedChange={setWeekendEnabled}
            />
          </div>
        </CardContent>
      </Card>

      {/* Sequences */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5" />
                Sequências de Follow-up
              </CardTitle>
              <CardDescription>
                Defina as mensagens e tempos de espera para cada sequência
              </CardDescription>
            </div>
            <Button onClick={addSequence} variant="outline" className="gap-2">
              <Plus className="w-4 h-4" />
              Adicionar Sequência
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {sequences.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <MessageSquare className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>Nenhuma sequência configurada</p>
              <p className="text-sm">Clique em "Adicionar Sequência" para criar uma</p>
            </div>
          ) : (
            sequences.map((seq, index) => (
              <div key={seq.id} className="border rounded-lg p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <span className="text-lg font-semibold text-muted-foreground">#{index + 1}</span>
                    <Input
                      value={seq.nome}
                      onChange={(e) => updateSequence(seq.id, 'nome', e.target.value)}
                      className="w-48"
                      placeholder="Nome da sequência"
                    />
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`ativo-${seq.id}`} className="text-sm">Ativo</Label>
                      <Switch
                        id={`ativo-${seq.id}`}
                        checked={seq.ativo}
                        onCheckedChange={(checked) => updateSequence(seq.id, 'ativo', checked)}
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeSequence(seq.id)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                
                <div className="grid grid-cols-4 gap-4">
                  <div className="space-y-2">
                    <Label>Delay (minutos)</Label>
                    <Input
                      type="number"
                      min={1}
                      value={seq.delay_minutos}
                      onChange={(e) => updateSequence(seq.id, 'delay_minutos', parseInt(e.target.value, 10) || 4)}
                    />
                  </div>
                  <div className="col-span-3 space-y-2">
                    <Label>Mensagem</Label>
                    <Textarea
                      value={seq.mensagem}
                      onChange={(e) => updateSequence(seq.id, 'mensagem', e.target.value)}
                      placeholder="Mensagem de follow-up..."
                      rows={2}
                    />
                  </div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Preview */}
      {sequences.filter(s => s.ativo).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Pré-visualização</CardTitle>
            <CardDescription>Como as sequências serão executadas</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {sequences
                .filter(s => s.ativo)
                .sort((a, b) => a.delay_minutos - b.delay_minutos)
                .map((seq, index) => (
                  <div key={seq.id} className="flex items-center gap-4 text-sm">
                    <span className="w-24 font-mono text-muted-foreground">
                      +{seq.delay_minutos}min
                    </span>
                    <span className="flex-1 truncate">{seq.mensagem}</span>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
