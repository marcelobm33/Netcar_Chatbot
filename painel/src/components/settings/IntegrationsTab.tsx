'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Webhook, Save, RefreshCw, CheckCircle, AlertTriangle, 
  Send, ExternalLink, Copy, Info, Key, Shield, Code, 
  Plus, Trash2, Eye, EyeOff, Lock, BookOpen, Server,
  Activity, Database, Car, ChevronDown, ChevronRight
} from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";

// ========================================
// TYPES
// ========================================
interface ApiToken {
  id: number;
  label: string;
  token_hash: string;
  is_active: boolean;
  created_at: string;
}

interface ApiEndpoint {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  description: string;
  auth: 'Pública' | 'Bearer Token' | 'Admin';
  example?: object;
}

interface EndpointCategory {
  name: string;
  icon: React.ReactNode;
  description: string;
  endpoints: ApiEndpoint[];
}

// ========================================
// API DOCUMENTATION DATA
// ========================================
const API_DOCS: EndpointCategory[] = [
  {
    name: 'Monitoramento',
    icon: <Activity className="h-4 w-4" />,
    description: 'Verificar status e saúde do sistema',
    endpoints: [
      {
        method: 'GET',
        path: '/',
        description: 'Verifica se a API está online',
        auth: 'Pública',
        example: { status: 'ok', service: 'netcar-worker', version: '5.4.0', timestamp: '2025-12-25T12:00:00Z' }
      },
      {
        method: 'GET',
        path: '/health',
        description: 'Diagnóstico profundo (DB, WhatsApp, APIs)',
        auth: 'Pública',
        example: {
          status: 'healthy',
          checks: {
            db: { status: 'ok', latency: 185 },
            evolution: { status: 'ok', latency: 974 },
            kv: { status: 'ok', latency: 223 },
            vectorize: { status: 'ok', latency: 307 }
          }
        }
      }
    ]
  },
  {
    name: 'Webhooks',
    icon: <Webhook className="h-4 w-4" />,
    description: 'Endpoints para integração WhatsApp',
    endpoints: [
      {
        method: 'POST',
        path: '/webhook/evolution',
        description: 'Recebimento de eventos do WhatsApp',
        auth: 'Pública',
        example: {
          event: 'messages.upsert',
          instance: 'netcar-bot',
          data: {
            key: { remoteJid: '5551999999999@s.whatsapp.net', fromMe: false },
            pushName: 'Cliente',
            message: { conversation: 'Olá, gostaria de saber sobre o HB20.' }
          }
        }
      },
      {
        method: 'POST',
        path: '/maintenance/cleanup',
        description: 'Encerra leads inativos (7+ dias)',
        auth: 'Admin'
      }
    ]
  },
  {
    name: 'Analytics',
    icon: <Database className="h-4 w-4" />,
    description: 'Métricas e relatórios do sistema',
    endpoints: [
      {
        method: 'GET',
        path: '/analytics/funnel',
        description: 'Contagem de leads por etapa do funil',
        auth: 'Bearer Token',
        example: {
          timestamp: '2025-12-25T12:00:00Z',
          funnel: { novo: 150, em_atendimento: 45, qualificado: 12, perdido: 5 },
          total: 212
        }
      },
      {
        method: 'GET',
        path: '/analytics/performance',
        description: 'Tempo médio de resposta e conversão',
        auth: 'Bearer Token'
      },
      {
        method: 'GET',
        path: '/api/v1/analytics/summary',
        description: 'Resumo geral de métricas',
        auth: 'Bearer Token'
      }
    ]
  },
  {
    name: 'Leads',
    icon: <Server className="h-4 w-4" />,
    description: 'Gerenciamento de leads e conversas',
    endpoints: [
      {
        method: 'GET',
        path: '/api/v1/leads',
        description: 'Listar todos os leads',
        auth: 'Bearer Token',
        example: { data: [{ id: 'uuid', phone: '5551999999999', name: 'João', status: 'ativo' }], meta: { total: 150, page: 1 } }
      },
      {
        method: 'GET',
        path: '/api/v1/leads/:id',
        description: 'Obter lead específico',
        auth: 'Bearer Token'
      },
      {
        method: 'GET',
        path: '/api/v1/leads/:id/history',
        description: 'Histórico de conversas do lead',
        auth: 'Bearer Token'
      }
    ]
  },
  {
    name: 'Estoque',
    icon: <Car className="h-4 w-4" />,
    description: 'Veículos disponíveis para venda',
    endpoints: [
      {
        method: 'GET',
        path: '/api/estoque',
        description: 'Lista completa de veículos',
        auth: 'Pública',
        example: {
          success: true,
          total: 2,
          data: [{ id: 101, modelo: 'HB20', versao: 'Comfort 1.0', ano: 2021, preco: 65900, transmissao: 'Manual' }]
        }
      },
      {
        method: 'GET',
        path: '/api/proxy/stock-attention',
        description: 'Veículos em destaque',
        auth: 'Pública'
      }
    ]
  },
  {
    name: 'Configurações',
    icon: <Shield className="h-4 w-4" />,
    description: 'Administração do bot',
    endpoints: [
      {
        method: 'GET',
        path: '/api/admin/config/:key',
        description: 'Obter valor de configuração',
        auth: 'Admin'
      },
      {
        method: 'POST',
        path: '/api/admin/config',
        description: 'Salvar configuração',
        auth: 'Admin',
        example: { key: 'bot_enabled', value: 'true' }
      }
    ]
  }
];

const WEBHOOK_EVENTS = [
  { name: 'lead_created', description: 'Novo lead criado', example: { event: 'lead_created', data: { lead_id: 'uuid', phone: '5511999999999' } } },
  { name: 'lead_updated', description: 'Lead atualizado', example: { event: 'lead_updated', data: { lead_id: 'uuid', qualification: 'HOT' } } },
  { name: 'lead_handover', description: 'Lead transferido', example: { event: 'lead_handover', data: { lead_id: 'uuid', seller: { name: 'João' } } } }
];

// ========================================
// MAIN COMPONENT
// ========================================
export default function IntegrationsTab() {
  // Webhook State
  const [webhookUrl, setWebhookUrl] = useState('');
  const [originalUrl, setOriginalUrl] = useState('');
  const [webhookSaving, setWebhookSaving] = useState(false);
  const [webhookSaved, setWebhookSaved] = useState(false);
  const [webhookTesting, setWebhookTesting] = useState(false);
  const [webhookTestResult, setWebhookTestResult] = useState<'success' | 'error' | null>(null);
  const [webhookTestMessage, setWebhookTestMessage] = useState('');
  
  // API State
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiTesting, setApiTesting] = useState(false);
  const [apiTestResult, setApiTestResult] = useState<{ success: boolean; message: string } | null>(null);
  
  // Token State
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [loadingTokens, setLoadingTokens] = useState(false);
  const [newTokenLabel, setNewTokenLabel] = useState('');
  const [creatingToken, setCreatingToken] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  
  // Docs State
  const [expandedCategory, setExpandedCategory] = useState<string | null>('Monitoramento');
  const [expandedEndpoint, setExpandedEndpoint] = useState<string | null>(null);
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null);
  
  const [loading, setLoading] = useState(true);
  const { toast, error: toastError } = useToast();
  const { confirm } = useConfirmDialog();

  useEffect(() => { loadConfig(); }, []);

  async function loadConfig() {
    setLoading(true);
    try {
      const config = await api.getConfig('CLIENT_WEBHOOK_URL');
      if (config && typeof config === 'string') { setWebhookUrl(config); setOriginalUrl(config); }
    } catch (e) { console.error('Erro ao carregar configuração:', e); }
    setLoading(false);
  }

  // Webhook Functions
  async function saveWebhookUrl() {
    setWebhookSaving(true);
    try {
      await api.setConfig('CLIENT_WEBHOOK_URL', webhookUrl);
      setOriginalUrl(webhookUrl);
      setWebhookSaved(true);
      setTimeout(() => setWebhookSaved(false), 3000);
    } catch (e: any) { toastError('Erro: ' + e.message); }
    setWebhookSaving(false);
  }

  async function testWebhook() {
    if (!webhookUrl) { setWebhookTestResult('error'); setWebhookTestMessage('Insira uma URL'); return; }
    setWebhookTesting(true);
    try {
      const res = await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'test', timestamp: new Date().toISOString() }) });
      setWebhookTestResult(res.ok ? 'success' : 'error');
      setWebhookTestMessage(res.ok ? `Sucesso! Status: ${res.status}` : `Erro: HTTP ${res.status}`);
    } catch (e: any) { setWebhookTestResult('error'); setWebhookTestMessage(`Erro: ${e.message}`); }
    setWebhookTesting(false);
  }

  // API Functions
  async function testApiConnection() {
    if (!apiKey) { setApiTestResult({ success: false, message: 'Insira a chave' }); return; }
    setApiTesting(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || ''}/api/v1/leads?limit=1`, { headers: { 'Authorization': `Bearer ${apiKey}` } });
      if (res.ok) { const d = await res.json(); setApiTestResult({ success: true, message: `Conectado! ${d.meta?.total || 0} leads` }); }
      else { setApiTestResult({ success: false, message: `Falha: HTTP ${res.status}` }); }
    } catch (e: any) { setApiTestResult({ success: false, message: `Erro: ${e.message}` }); }
    setApiTesting(false);
  }

  async function loadTokens() {
    setLoadingTokens(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || ''}/api/v1/internal/tokens`, { headers: { 'X-Api-Key': apiKey } });
      if (res.ok) { const d = await res.json(); setTokens(d.data || []); }
    } catch (e) { console.error('Erro:', e); }
    setLoadingTokens(false);
  }

  async function createToken() {
    if (!newTokenLabel.trim()) return;
    setCreatingToken(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || ''}/api/v1/internal/tokens`, { method: 'POST', headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ label: newTokenLabel }) });
      if (res.ok) { const d = await res.json(); setNewToken(d.token); setNewTokenLabel(''); loadTokens(); }
    } catch (e) { console.error('Erro:', e); }
    setCreatingToken(false);
  }

  function revokeToken(id: number) {
    confirm({
      title: 'Revogar Token',
      description: 'Tem certeza que deseja revogar esta chave de API? Aplicações que a utilizam perderão o acesso imediatamente.',
      confirmText: 'Revogar',
      variant: 'danger',
      onConfirm: async () => {
        try { await fetch(`${process.env.NEXT_PUBLIC_API_URL || ''}/api/v1/internal/tokens/${id}`, { method: 'DELETE', headers: { 'X-Api-Key': apiKey } }); loadTokens(); } catch (e) { console.error('Erro:', e); }
      }
    });
  }

  function copyToClipboard(text: string) { navigator.clipboard.writeText(text); }
  
  const hasWebhookChanges = webhookUrl !== originalUrl;
  const methodColors: Record<string, string> = { GET: 'bg-green-100 text-green-700', POST: 'bg-blue-100 text-blue-700', PUT: 'bg-yellow-100 text-yellow-700', DELETE: 'bg-red-100 text-red-700' };

  if (loading) { return <div className="flex justify-center items-center h-32"><RefreshCw className="h-6 w-6 animate-spin text-primary" /></div>; }

  return (
    <div className="space-y-6">
      <Tabs defaultValue="docs" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="docs" className="gap-2"><BookOpen className="h-4 w-4" /> Manual API</TabsTrigger>
          <TabsTrigger value="webhook" className="gap-2"><Webhook className="h-4 w-4" /> Webhook</TabsTrigger>
          <TabsTrigger value="test" className="gap-2"><Code className="h-4 w-4" /> Testar</TabsTrigger>
          <TabsTrigger value="keys" className="gap-2"><Key className="h-4 w-4" /> Chaves</TabsTrigger>
        </TabsList>

        {/* ========== TAB: DOCUMENTAÇÃO ========== */}
        <TabsContent value="docs" className="space-y-4">
          <Card className="border-blue-200 bg-gradient-to-r from-blue-50/50 to-indigo-50/50">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-lg">
                <BookOpen className="h-5 w-5 text-blue-600" />
                Documentação da API Netcar
              </CardTitle>
              <CardDescription>
                Base URL: <code className="bg-white px-2 py-0.5 rounded text-sm">https://netcar-worker.contato-11e.workers.dev</code>
              </CardDescription>
            </CardHeader>
          </Card>

          {API_DOCS.map((category) => (
            <Card key={category.name}>
              <button
                onClick={() => setExpandedCategory(expandedCategory === category.name ? null : category.name)}
                className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary/10 rounded-lg">{category.icon}</div>
                  <div className="text-left">
                    <h3 className="font-semibold">{category.name}</h3>
                    <p className="text-sm text-muted-foreground">{category.description}</p>
                  </div>
                </div>
                {expandedCategory === category.name ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
              </button>

              {expandedCategory === category.name && (
                <CardContent className="pt-0 space-y-2">
                  {category.endpoints.map((ep, i) => (
                    <div key={i} className="border rounded-lg overflow-hidden">
                      <button
                        onClick={() => setExpandedEndpoint(expandedEndpoint === `${category.name}-${i}` ? null : `${category.name}-${i}`)}
                        className="w-full flex items-center gap-3 p-3 hover:bg-gray-50 transition-colors text-left"
                      >
                        <Badge className={`font-mono text-xs w-16 justify-center ${methodColors[ep.method]}`}>{ep.method}</Badge>
                        <code className="text-sm flex-1">{ep.path}</code>
                        <Badge variant="outline" className="text-xs">{ep.auth}</Badge>
                      </button>
                      
                      {expandedEndpoint === `${category.name}-${i}` && (
                        <div className="border-t bg-gray-50 p-3 space-y-2">
                          <p className="text-sm text-muted-foreground">{ep.description}</p>
                          {ep.example && (
                            <div>
                              <div className="flex justify-between items-center mb-1">
                                <span className="text-xs font-medium">Exemplo de Resposta</span>
                                <Button variant="ghost" size="sm" onClick={() => copyToClipboard(JSON.stringify(ep.example, null, 2))} className="h-6 gap-1 text-xs">
                                  <Copy className="h-3 w-3" /> Copiar
                                </Button>
                              </div>
                              <pre className="text-xs font-mono bg-white p-2 rounded border overflow-x-auto max-h-40">{JSON.stringify(ep.example, null, 2)}</pre>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </CardContent>
              )}
            </Card>
          ))}
        </TabsContent>

        {/* ========== TAB: WEBHOOK ========== */}
        <TabsContent value="webhook" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Webhook className="h-5 w-5" /> Webhook para CRM</CardTitle>
              <CardDescription>Receba notificações quando leads forem criados ou transferidos</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>URL do Webhook</Label>
                <div className="flex gap-2">
                  <Input type="url" placeholder="https://seu-crm.com/webhook" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} className="flex-1" />
                  <Button variant="outline" onClick={testWebhook} disabled={webhookTesting || !webhookUrl} className="gap-2">
                    {webhookTesting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Testar
                  </Button>
                </div>
              </div>
              {webhookTestResult && (
                <div className={`flex items-center gap-2 p-3 rounded-lg ${webhookTestResult === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                  {webhookTestResult === 'success' ? <CheckCircle className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />} {webhookTestMessage}
                </div>
              )}
              <div className="flex justify-between items-center pt-2">
                <span className="text-sm text-muted-foreground flex items-center gap-1">
                  {originalUrl ? <><CheckCircle className="h-3 w-3 text-green-500" /> Configurado</> : <><Info className="h-3 w-3" /> Não configurado</>}
                </span>
                <Button onClick={saveWebhookUrl} disabled={webhookSaving || !hasWebhookChanges} className="gap-2">
                  {webhookSaving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {webhookSaved ? 'Salvo!' : 'Salvar'}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-lg">Eventos Disponíveis</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {WEBHOOK_EVENTS.map((ev) => (
                <div key={ev.name} className="border rounded-lg overflow-hidden">
                  <button onClick={() => setExpandedEvent(expandedEvent === ev.name ? null : ev.name)} className="w-full flex items-center justify-between p-3 hover:bg-gray-50">
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className="font-mono text-xs">{ev.name}</Badge>
                      <span className="text-sm text-muted-foreground">{ev.description}</span>
                    </div>
                    <ExternalLink className="h-4 w-4 text-muted-foreground" />
                  </button>
                  {expandedEvent === ev.name && (
                    <div className="border-t bg-gray-50 p-3">
                      <pre className="text-xs font-mono bg-white p-2 rounded border overflow-x-auto">{JSON.stringify(ev.example, null, 2)}</pre>
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========== TAB: TESTAR API ========== */}
        <TabsContent value="test" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Code className="h-5 w-5" /> Testar Conexão</CardTitle>
              <CardDescription>Valide sua chave de API</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Chave da API</Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input type={showApiKey ? 'text' : 'password'} placeholder="netcar-admin-secret-v1" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="pr-10" />
                    <button type="button" onClick={() => setShowApiKey(!showApiKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                      {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <Button onClick={testApiConnection} disabled={apiTesting} className="gap-2">
                    {apiTesting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Testar
                  </Button>
                </div>
              </div>
              {apiTestResult && (
                <div className={`flex items-center gap-2 p-3 rounded-lg ${apiTestResult.success ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                  {apiTestResult.success ? <CheckCircle className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />} {apiTestResult.message}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-amber-200 bg-amber-50/50">
            <CardContent className="pt-4">
              <div className="flex gap-3">
                <Info className="h-5 w-5 text-amber-600 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-amber-800 mb-1">Como usar a API</p>
                  <p className="text-amber-700">Inclua o header <code className="bg-amber-100 px-1 rounded">Authorization: Bearer &lt;sua-chave&gt;</code> em todas as requisições.</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========== TAB: CHAVES ========== */}
        <TabsContent value="keys" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Key className="h-5 w-5" /> Gerenciador de Chaves</CardTitle>
              <CardDescription>Crie e gerencie tokens de API</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!apiKey ? (
                <div className="text-center py-6 border rounded-lg bg-gray-50">
                  <Lock className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">Insira sua chave na aba "Testar" primeiro.</p>
                </div>
              ) : (
                <>
                  <div className="flex gap-2">
                    <Input placeholder="Nome da chave (ex: CRM Vendas)" value={newTokenLabel} onChange={(e) => setNewTokenLabel(e.target.value)} className="flex-1" />
                    <Button onClick={createToken} disabled={creatingToken || !newTokenLabel} className="gap-2">
                      {creatingToken ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Criar
                    </Button>
                    <Button variant="outline" onClick={loadTokens} disabled={loadingTokens}>
                      <RefreshCw className={`h-4 w-4 ${loadingTokens ? 'animate-spin' : ''}`} />
                    </Button>
                  </div>
                  {newToken && (
                    <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                      <p className="text-sm font-medium text-green-800 mb-2">✅ Chave criada! Copie agora:</p>
                      <div className="flex gap-2">
                        <code className="flex-1 bg-white p-2 rounded border text-sm font-mono break-all">{newToken}</code>
                        <Button size="sm" onClick={() => copyToClipboard(newToken)}><Copy className="h-3 w-3" /></Button>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => setNewToken(null)} className="mt-2">Fechar</Button>
                    </div>
                  )}
                  <div className="space-y-2">
                    {tokens.filter(t => t.is_active).map((token) => (
                      <div key={token.id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div>
                          <p className="font-medium">{token.label}</p>
                          <p className="text-xs text-muted-foreground">Criado em {new Date(token.created_at).toLocaleDateString()}</p>
                        </div>
                        <Button variant="outline" size="sm" onClick={() => revokeToken(token.id)} className="text-red-600 gap-1">
                          <Trash2 className="h-3 w-3" /> Revogar
                        </Button>
                      </div>
                    ))}
                    {tokens.length === 0 && !loadingTokens && <p className="text-center text-muted-foreground py-4">Nenhuma chave criada.</p>}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="border-blue-200 bg-blue-50/50">
            <CardContent className="pt-4">
              <div className="flex gap-3">
                <Shield className="h-5 w-5 text-blue-600 mt-0.5" />
                <div className="text-sm text-blue-800">
                  <p className="font-medium mb-1">Segurança</p>
                  <p className="text-blue-700">Chaves têm acesso total. Mantenha em segredo e revogue se comprometidas.</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
