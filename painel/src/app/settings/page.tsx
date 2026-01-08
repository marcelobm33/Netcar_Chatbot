"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Save,
  RefreshCw,
  Bot,
  Clock,
  Shield,
  Sparkles,
  CheckCircle,
  AlertTriangle,
  Maximize2,
  X,
  Layers,
  Plus,
  Trash2,
  Eye,
  Lock,
  ShieldCheck,
  XCircle,
  Loader2,
  Edit3,
  AlertOctagon,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import IntegrationsTab from "@/components/settings/IntegrationsTab";
import { useToast } from "@/components/ui/toast";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";

// Prompt Layer Interface
interface PromptLayer {
  id: number;
  layer_type: "base" | "extension";
  name: string;
  content: string;
  is_active: boolean;
  is_deletable: boolean;
  created_at: string;
  updated_at: string;
}

// Analysis Result Interface
interface AnalysisResult {
  status: "approved" | "conflict" | "duplicate" | "error";
  message: string;
  suggestion?: string;
  conflicting_section?: string;
}

interface Settings {
  system_prompt: string;
  bot_enabled: boolean;
  business_hours_start: number;
  business_hours_end: number;
  greeting_cooldown_hours: number;
  ai_model: string;
  ai_temperature: number;
}

// Maintenance Mode Card Component
function MaintenanceModeCard() {
  const [maintenanceEnabled, setMaintenanceEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const { error: toastError } = useToast();

  useEffect(() => {
    async function fetchStatus() {
      try {
        const res: any = await api.getMaintenanceMode();
        setMaintenanceEnabled(res.enabled);
      } catch (e) {
        console.error("Erro ao carregar modo manutenção:", e);
      }
      setLoading(false);
    }
    fetchStatus();
  }, []);

  async function handleToggle(enabled: boolean) {
    setToggling(true);
    try {
      await api.setMaintenanceMode(enabled);
      setMaintenanceEnabled(enabled);
    } catch (e: any) {
      toastError("Erro ao alterar modo manutenção: " + e.message);
    }
    setToggling(false);
  }

  return (
    <Card
      className={maintenanceEnabled ? "border-amber-300 bg-amber-50/30" : ""}
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle
            className={`h-5 w-5 ${
              maintenanceEnabled ? "text-amber-600" : "text-muted-foreground"
            }`}
          />
          Modo Manutenção
        </CardTitle>
        <CardDescription>
          Quando ativado, o bot não responde nenhuma mensagem
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div
          className={`flex items-center justify-between p-4 border rounded-lg ${
            maintenanceEnabled ? "border-amber-300 bg-amber-100/50" : ""
          }`}
        >
          <div>
            <p className="font-medium">
              {maintenanceEnabled
                ? "🔧 Manutenção ATIVA"
                : "Manutenção Desativada"}
            </p>
            <p className="text-sm text-muted-foreground">
              {maintenanceEnabled
                ? "O bot está pausado. Nenhuma mensagem será respondida."
                : "Bot está operando normalmente."}
            </p>
          </div>
          <Switch
            checked={maintenanceEnabled}
            onCheckedChange={handleToggle}
            disabled={loading || toggling}
          />
        </div>
        {maintenanceEnabled && (
          <div className="mt-3 p-3 bg-amber-100 rounded-lg border border-amber-200 text-sm text-amber-800">
            <strong>⚠️ Atenção:</strong> Enquanto o modo manutenção estiver
            ativo, todas as mensagens dos clientes serão ignoradas.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  const {
    toast,
    success: toastSuccess,
    error: toastError,
    warning: toastWarning,
  } = useToast();
  const { confirm, confirmDelete } = useConfirmDialog();
  const [activeTab, setActiveTab] = useState("prompt");
  const [settings, setSettings] = useState<Settings>({
    system_prompt: "",
    bot_enabled: true,
    business_hours_start: 9,
    business_hours_end: 18,
    greeting_cooldown_hours: 4,
    ai_model: "gpt-4o",
    ai_temperature: 0.7,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Prompt Layers State
  const [layers, setLayers] = useState<PromptLayer[]>([]);
  const [finalPrompt, setFinalPrompt] = useState("");
  const [loadingLayers, setLoadingLayers] = useState(false);

  const [proposalContent, setProposalContent] = useState("");
  const [proposalName, setProposalName] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(
    null
  );
  const [addingExtension, setAddingExtension] = useState(false);
  const [extensionSaved, setExtensionSaved] = useState(false);

  // Modal States
  const [showBasePrompt, setShowBasePrompt] = useState(false);
  const [showFinalPrompt, setShowFinalPrompt] = useState(false);

  // Base Prompt Edit States
  const [editingBasePrompt, setEditingBasePrompt] = useState(false);
  const [editedBaseContent, setEditedBaseContent] = useState("");
  const [savingBasePrompt, setSavingBasePrompt] = useState(false);
  const [basePromptSaved, setBasePromptSaved] = useState(false);

  // Fetch Prompt Layers
  async function fetchLayers() {
    setLoadingLayers(true);
    try {
      const res: any = await api.getPromptLayers();
      if (res.layers) {
        setLayers(res.layers);
      }
      if (res.final_prompt) {
        setFinalPrompt(res.final_prompt);
      }
    } catch (e) {
      console.error("Erro ao carregar camadas de prompt:", e);
    }
    setLoadingLayers(false);
  }

  // Analyze Extension Proposal
  async function handleAnalyzeProposal() {
    if (!proposalContent.trim()) return;

    setAnalyzing(true);
    setAnalysisResult(null);

    try {
      const res: any = await api.proposeExtension(proposalContent);
      setAnalysisResult({
        status: res.status,
        message: res.message,
        suggestion: res.suggestion,
        conflicting_section: res.conflicting_section,
      });
    } catch (e: any) {
      setAnalysisResult({
        status: "error",
        message: e.message || "Erro ao analisar proposta",
      });
    }
    setAnalyzing(false);
  }

  // Add Extension
  async function handleAddExtension() {
    if (!proposalName.trim() || !proposalContent.trim()) {
      toastWarning("Preencha o nome e conteúdo da extensão");
      return;
    }

    setAddingExtension(true);
    try {
      await api.addExtension(proposalName, proposalContent);
      setProposalName("");
      setProposalContent("");
      setAnalysisResult(null);
      setExtensionSaved(true);
      setTimeout(() => setExtensionSaved(false), 5000);
      await fetchLayers();
    } catch (e: any) {
      toastError("Erro ao adicionar extensão: " + e.message);
    }
    setAddingExtension(false);
  }

  // Toggle Layer
  async function handleToggleLayer(id: number) {
    try {
      await api.toggleLayer(id);
      await fetchLayers();
    } catch (e: any) {
      toastError("Erro ao alternar extensão: " + e.message);
    }
  }

  // Delete Layer
  function handleDeleteLayer(id: number) {
    const layer = layers.find((l) => l.id === id);
    confirmDelete(layer?.name || "esta extensão", async () => {
      try {
        await api.deleteLayer(id);
        await fetchLayers();
      } catch (e: any) {
        toastError("Erro ao deletar extensão: " + e.message);
      }
    });
  }

  // Save Base Prompt (at client's own risk)
  async function handleSaveBasePrompt() {
    if (!editedBaseContent.trim() || editedBaseContent.length < 100) {
      toastWarning("O prompt base precisa ter pelo menos 100 caracteres");
      return;
    }

    confirm({
      title: "ATENÇÃO: Mudar Comportamento do Bot",
      description:
        "⚠️ Editar o prompt base pode alterar completamente o comportamento do bot. Alterações incorretas podem fazer o bot parar de funcionar corretamente. Uma versão de backup será salva automaticamente. Deseja continuar?",
      confirmText: "Salvar Alterações",
      variant: "danger",
      onConfirm: async () => {
        setSavingBasePrompt(true);
        try {
          await api.updateBasePrompt(editedBaseContent);
          setBasePromptSaved(true);
          setEditingBasePrompt(false);
          setTimeout(() => setBasePromptSaved(false), 5000);
          await fetchLayers();
        } catch (e: any) {
          toastError("Erro ao salvar prompt base: " + e.message);
        }
        setSavingBasePrompt(false);
      },
    });
  }

  // Start editing base prompt
  function handleStartEditBasePrompt() {
    if (baseLayer) {
      setEditedBaseContent(baseLayer.content);
      setEditingBasePrompt(true);
    }
  }

  // Fetch Settings
  async function fetchSettings() {
    try {
      const [botEnabled, model, temp, hoursStart, hoursEnd, cooldown] =
        await Promise.all([
          api.getConfig("bot_enabled"),
          api.getConfig("ai_model"),
          api.getConfig("ai_temperature"),
          api.getConfig("business_hours_start"),
          api.getConfig("business_hours_end"),
          api.getConfig("greeting_cooldown_hours"),
        ]);

      setSettings({
        system_prompt: "",
        bot_enabled: botEnabled?.bot_enabled !== "false",
        ai_model: model?.ai_model || "gpt-4o",
        ai_temperature: parseFloat(temp?.ai_temperature) || 0.7,
        business_hours_start:
          parseInt(hoursStart?.business_hours_start, 10) || 9,
        business_hours_end: parseInt(hoursEnd?.business_hours_end, 10) || 18,
        greeting_cooldown_hours:
          parseInt(cooldown?.greeting_cooldown_hours, 10) || 4,
      });
    } catch (e) {
      console.error("Erro ao carregar configurações:", e);
    }
    setLoading(false);
  }

  // Save Settings
  async function saveSettings() {
    setSaving(true);
    try {
      await api.setConfig("bot_enabled", String(settings.bot_enabled));
      await api.setConfig("ai_model", settings.ai_model);
      await api.setConfig("ai_temperature", String(settings.ai_temperature));
      await api.setConfig(
        "business_hours_start",
        String(settings.business_hours_start)
      );
      await api.setConfig(
        "business_hours_end",
        String(settings.business_hours_end)
      );
      await api.setConfig(
        "greeting_cooldown_hours",
        String(settings.greeting_cooldown_hours)
      );

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: any) {
      toastError("Erro ao salvar: " + e.message);
    }
    setSaving(false);
  }

  useEffect(() => {
    fetchSettings();
    fetchLayers();
  }, []);

  // Get base layer
  const baseLayer = layers.find((l) => l.layer_type === "base");
  const extensions = layers.filter((l) => l.layer_type === "extension");
  const activeExtensions = extensions.filter((l) => l.is_active);

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
          <h1 className="text-3xl font-bold tracking-tight">
            Configurações do Bot
          </h1>
          <p className="text-muted-foreground">
            Personalize o comportamento da IA
          </p>
        </div>
        <Button onClick={saveSettings} disabled={saving} className="gap-2">
          {saving ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {saving ? "Salvando..." : saved ? "Salvo!" : "Salvar Alterações"}
        </Button>
      </div>

      {saved && (
        <div className="bg-green-100 border border-green-200 text-green-700 px-4 py-3 rounded">
          ✅ Configurações salvas com sucesso!
        </div>
      )}

      <Tabs defaultValue="prompt" className="space-y-4">
        <TabsList>
          <TabsTrigger value="prompt" className="gap-2">
            <Layers className="h-4 w-4" /> Prompts
          </TabsTrigger>
          <TabsTrigger value="hours" className="gap-2">
            <Clock className="h-4 w-4" /> Horários
          </TabsTrigger>
          <TabsTrigger value="general" className="gap-2">
            <Shield className="h-4 w-4" /> Geral
          </TabsTrigger>
          <TabsTrigger value="integrations" className="gap-2">
            <Sparkles className="h-4 w-4" /> Integrações
          </TabsTrigger>
        </TabsList>

        <TabsContent value="prompt" className="space-y-4">
          {/* Tutorial Card */}
          <Card className="border-amber-200 bg-gradient-to-r from-amber-50/50 to-yellow-50/50">
            <CardHeader className="py-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-amber-600" />
                Como Funciona a Personalização do iAN
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid md:grid-cols-3 gap-4 text-sm">
                <div className="p-3 bg-white/60 rounded-lg border">
                  <div className="font-medium text-purple-700 mb-1">
                    1. Memória Base
                  </div>
                  <p className="text-muted-foreground">
                    Personalidade e regras fundamentais. Protegido para garantir
                    consistência.
                  </p>
                </div>
                <div className="p-3 bg-white/60 rounded-lg border">
                  <div className="font-medium text-blue-700 mb-1">
                    2. Micro Prompts
                  </div>
                  <p className="text-muted-foreground">
                    Regras extras que você pode adicionar, ativar/desativar ou
                    deletar a qualquer momento.
                  </p>
                </div>
                <div className="p-3 bg-white/60 rounded-lg border">
                  <div className="font-medium text-green-700 mb-1">
                    3. Teste Seguro
                  </div>
                  <p className="text-muted-foreground">
                    A IA Guardiã analisa cada nova regra antes de ativar,
                    evitando conflitos.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Memória 0 - Prompt Base */}
          <Card className="border-purple-200 bg-gradient-to-r from-purple-50/50 to-blue-50/50">
            <CardHeader className="py-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <Edit3 className="h-5 w-5 text-purple-600" />
                Memória Base
                <Badge
                  variant="outline"
                  className="ml-2 text-amber-600 border-amber-300"
                >
                  Editável
                </Badge>
                <div className="ml-auto flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowBasePrompt(true)}
                  >
                    <Eye className="h-4 w-4 mr-1" /> Ver Completo
                  </Button>
                  {!editingBasePrompt && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleStartEditBasePrompt}
                      className="text-amber-600 border-amber-300 hover:bg-amber-50"
                    >
                      <Edit3 className="h-4 w-4 mr-1" /> Editar
                    </Button>
                  )}
                </div>
              </CardTitle>
              <CardDescription>
                Contém a personalidade do iAN, regras de atendimento e fluxos
                principais.
                <strong className="text-amber-600">
                  {" "}
                  Edite por sua conta e risco.
                </strong>
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              {basePromptSaved && (
                <div className="bg-green-100 border border-green-300 text-green-800 px-4 py-3 rounded-lg flex items-center gap-3 mb-4">
                  <CheckCircle className="h-5 w-5" />
                  <span className="font-medium">
                    Prompt base salvo com sucesso! Versão anterior foi salva
                    como backup.
                  </span>
                </div>
              )}

              {editingBasePrompt ? (
                <div className="space-y-4">
                  <div className="p-3 bg-amber-50 rounded-lg border border-amber-200">
                    <div className="flex items-start gap-2">
                      <AlertOctagon className="h-5 w-5 text-amber-600 mt-0.5" />
                      <div className="text-sm text-amber-800">
                        <p className="font-medium">⚠️ Atenção: Área de Risco</p>
                        <p>
                          Alterações incorretas podem fazer o bot parar de
                          funcionar. Uma versão de backup será salva
                          automaticamente.
                        </p>
                      </div>
                    </div>
                  </div>

                  <Textarea
                    value={editedBaseContent}
                    onChange={(e) => setEditedBaseContent(e.target.value)}
                    rows={20}
                    className="font-mono text-sm"
                    placeholder="Conteúdo do prompt base..."
                  />

                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      {editedBaseContent.length.toLocaleString()} caracteres
                    </span>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setEditingBasePrompt(false);
                          setEditedBaseContent("");
                        }}
                        disabled={savingBasePrompt}
                      >
                        Cancelar
                      </Button>
                      <Button
                        onClick={handleSaveBasePrompt}
                        disabled={
                          savingBasePrompt || editedBaseContent.length < 100
                        }
                        className="bg-amber-600 hover:bg-amber-700"
                      >
                        {savingBasePrompt ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />{" "}
                            Salvando...
                          </>
                        ) : (
                          <>
                            <Save className="h-4 w-4 mr-2" /> Salvar Alterações
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : baseLayer ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-4 text-sm">
                    <span>
                      <strong>Tamanho:</strong>{" "}
                      {baseLayer.content.length.toLocaleString()} caracteres
                    </span>
                    <span>
                      <strong>Atualizado:</strong>{" "}
                      {new Date(baseLayer.updated_at).toLocaleDateString(
                        "pt-BR"
                      )}
                    </span>
                  </div>
                  <div className="bg-white/50 p-3 rounded-lg border text-sm text-muted-foreground font-mono truncate">
                    {baseLayer.content.substring(0, 150)}...
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground">Carregando...</p>
              )}
            </CardContent>
          </Card>

          {/* Success Banner */}
          {extensionSaved && (
            <div className="bg-green-100 border border-green-300 text-green-800 px-4 py-3 rounded-lg flex items-center gap-3">
              <CheckCircle className="h-5 w-5" />
              <span className="font-medium">
                Micro Prompt salvo com sucesso! Ele já está ativo e sendo usado
                pelo iAN.
              </span>
            </div>
          )}

          {/* Adicionar Micro Prompt */}
          <Card className="border-blue-200">
            <CardHeader className="py-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <Plus className="h-5 w-5 text-blue-600" />
                Adicionar Micro Prompt
              </CardTitle>
              <CardDescription>
                Crie regras personalizadas para o iAN. Faça uma alteração por
                vez e teste antes de adicionar mais.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Exemplos */}
              <div className="p-3 bg-blue-50/50 rounded-lg border border-blue-100">
                <p className="text-sm font-medium text-blue-800 mb-2">
                  💡 Exemplos de Micro Prompts:
                </p>
                <ul className="text-sm text-blue-700 space-y-1">
                  <li>
                    • <strong>Promoção:</strong> "Quando perguntarem sobre
                    preços, mencione que estamos com condições especiais de fim
                    de ano."
                  </li>
                  <li>
                    • <strong>Horário especial:</strong> "Nos dias 24 e 31 de
                    dezembro, informe que a loja fecha às 13h."
                  </li>
                  <li>
                    • <strong>Novo modelo:</strong> "Se perguntarem sobre a nova
                    Fiat Fastback, diga que acabou de chegar no estoque."
                  </li>
                </ul>
              </div>

              <div className="space-y-2">
                <Label>Nome do Micro Prompt</Label>
                <Input
                  placeholder="Ex: Promoção Natal 2024, Horário Especial, Novo Modelo..."
                  value={proposalName}
                  onChange={(e) => setProposalName(e.target.value)}
                  disabled={analyzing || addingExtension}
                />
              </div>

              <div className="space-y-2">
                <Label>
                  Regra (escreva como se estivesse instruindo o iAN)
                </Label>
                <Textarea
                  placeholder="Ex: Quando o cliente perguntar sobre financiamento, mencione que trabalhamos com taxas a partir de 1.49% ao mês."
                  value={proposalContent}
                  onChange={(e) => setProposalContent(e.target.value)}
                  rows={4}
                  disabled={analyzing || addingExtension}
                />
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={handleAnalyzeProposal}
                  disabled={!proposalContent.trim() || analyzing}
                  variant="outline"
                  className="gap-2"
                >
                  {analyzing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Analisando...
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="h-4 w-4" /> Analisar com IA
                      Guardiã
                    </>
                  )}
                </Button>
              </div>

              {/* Resultado da Análise */}
              {analysisResult && (
                <div
                  className={`p-4 rounded-lg border ${
                    analysisResult.status === "approved"
                      ? "bg-green-50 border-green-200"
                      : analysisResult.status === "error"
                      ? "bg-red-50 border-red-200"
                      : "bg-yellow-50 border-yellow-200"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {analysisResult.status === "approved" ? (
                      <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" />
                    ) : analysisResult.status === "error" ? (
                      <XCircle className="h-5 w-5 text-red-600 mt-0.5" />
                    ) : (
                      <AlertTriangle className="h-5 w-5 text-yellow-600 mt-0.5" />
                    )}
                    <div className="flex-1">
                      <p
                        className={`font-medium ${
                          analysisResult.status === "approved"
                            ? "text-green-800"
                            : analysisResult.status === "error"
                            ? "text-red-800"
                            : "text-yellow-800"
                        }`}
                      >
                        {analysisResult.status === "approved"
                          ? "Aprovado!"
                          : analysisResult.status === "duplicate"
                          ? "Duplicidade Detectada"
                          : analysisResult.status === "conflict"
                          ? "Conflito Detectado"
                          : "Erro"}
                      </p>
                      <p className="text-sm mt-1">{analysisResult.message}</p>
                      {analysisResult.suggestion && (
                        <p className="text-sm mt-2 italic">
                          {analysisResult.suggestion}
                        </p>
                      )}

                      {analysisResult.status === "approved" && (
                        <Button
                          onClick={handleAddExtension}
                          disabled={!proposalName.trim() || addingExtension}
                          className="mt-3 bg-green-600 hover:bg-green-700"
                        >
                          {addingExtension ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin mr-2" />{" "}
                              Adicionando...
                            </>
                          ) : (
                            <>
                              <Plus className="h-4 w-4 mr-2" /> Adicionar
                              Extensão
                            </>
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Lista de Micro Prompts */}
          <Card>
            <CardHeader className="py-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <Layers className="h-5 w-5" />
                Seus Micro Prompts ({extensions.length})
                <Badge variant="outline" className="ml-2">
                  {activeExtensions.length} ativo
                  {activeExtensions.length !== 1 ? "s" : ""}
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={fetchLayers}
                  disabled={loadingLayers}
                  className="ml-auto"
                >
                  {loadingLayers ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                </Button>
              </CardTitle>
              <CardDescription>
                Regras que você adicionou. Use o switch para ativar/desativar
                sem deletar. Delete apenas se não precisar mais.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {extensions.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Layers className="h-12 w-12 mx-auto mb-2 opacity-30" />
                  <p>Nenhum micro prompt adicionado ainda.</p>
                  <p className="text-sm">
                    Use o formulário acima para adicionar suas primeiras regras
                    personalizadas.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {extensions.map((ext) => (
                    <div
                      key={ext.id}
                      className={`rounded-lg border overflow-hidden ${
                        ext.is_active
                          ? "bg-green-50/50 border-green-200"
                          : "bg-gray-50 border-gray-200"
                      }`}
                    >
                      {/* Header */}
                      <div className="flex items-center justify-between p-4">
                        <div className="flex items-center gap-3">
                          <span
                            className={`w-3 h-3 rounded-full ${
                              ext.is_active ? "bg-green-500" : "bg-gray-400"
                            }`}
                          />
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold">{ext.name}</span>
                              <Badge
                                variant={
                                  ext.is_active ? "default" : "secondary"
                                }
                                className="text-xs"
                              >
                                {ext.is_active ? "Ativo" : "Inativo"}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Criado:{" "}
                              {new Date(ext.created_at).toLocaleDateString(
                                "pt-BR",
                                {
                                  day: "2-digit",
                                  month: "short",
                                  year: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                }
                              )}
                              {ext.updated_at !== ext.created_at && (
                                <span>
                                  {" "}
                                  • Atualizado:{" "}
                                  {new Date(ext.updated_at).toLocaleDateString(
                                    "pt-BR",
                                    { day: "2-digit", month: "short" }
                                  )}
                                </span>
                              )}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <Switch
                            checked={ext.is_active}
                            onCheckedChange={() => handleToggleLayer(ext.id)}
                          />
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleDeleteLayer(ext.id)}
                            className="gap-1"
                          >
                            <Trash2 className="h-4 w-4" />
                            Deletar
                          </Button>
                        </div>
                      </div>

                      {/* Content - Full view */}
                      <div className="border-t px-4 py-3 bg-white/50">
                        <p className="text-xs text-muted-foreground mb-1 font-medium">
                          Conteúdo da regra:
                        </p>
                        <pre className="text-sm whitespace-pre-wrap font-sans text-gray-700 max-h-40 overflow-y-auto">
                          {ext.content}
                        </pre>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Preview do Prompt Final */}
          <Card className="border-emerald-200 bg-emerald-50/30">
            <CardHeader className="py-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <Eye className="h-5 w-5 text-emerald-600" />
                Preview do Prompt Final
                <Badge variant="outline" className="ml-2">
                  {finalPrompt.length.toLocaleString()} caracteres
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowFinalPrompt(true)}
                  className="ml-auto"
                >
                  <Maximize2 className="h-4 w-4 mr-1" /> Expandir
                </Button>
              </CardTitle>
              <CardDescription>
                Prompt montado dinamicamente com base +{" "}
                {activeExtensions.length} extensão(ões) ativa(s).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="bg-white p-3 rounded-lg border text-sm text-muted-foreground font-mono max-h-32 overflow-hidden">
                {finalPrompt.substring(0, 500)}...
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="hours" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Horário de Atendimento</CardTitle>
              <CardDescription>
                O bot só responde durante estes horários (segunda a sexta)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-6">
                <div>
                  <Label>Início</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <Input
                      type="number"
                      min={0}
                      max={23}
                      value={settings.business_hours_start}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          business_hours_start:
                            parseInt(e.target.value, 10) || 9,
                        })
                      }
                      className="w-20"
                    />
                    <span className="text-muted-foreground">h</span>
                  </div>
                </div>
                <div>
                  <Label>Fim</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <Input
                      type="number"
                      min={0}
                      max={23}
                      value={settings.business_hours_end}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          business_hours_end:
                            parseInt(e.target.value, 10) || 18,
                        })
                      }
                      className="w-20"
                    />
                    <span className="text-muted-foreground">h</span>
                  </div>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                Mensagens fora do horário ficam pendentes até a abertura.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="general" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Status do Bot</CardTitle>
              <CardDescription>
                Liga ou desliga completamente o bot
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div>
                  <p className="font-medium">Bot Ativo</p>
                  <p className="text-sm text-muted-foreground">
                    {settings.bot_enabled
                      ? "Respondendo mensagens normalmente"
                      : "Pausado - não responde nada"}
                  </p>
                </div>
                <Switch
                  checked={settings.bot_enabled}
                  onCheckedChange={(checked) =>
                    setSettings({ ...settings, bot_enabled: checked })
                  }
                />
              </div>
            </CardContent>
          </Card>

          {/* Maintenance Mode Card */}
          <MaintenanceModeCard />

          <Card>
            <CardHeader>
              <CardTitle>Modelo da IA</CardTitle>
              <CardDescription>
                Escolha qual modelo LLM usar nas respostas
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <select
                  value={settings.ai_model}
                  onChange={(e) =>
                    setSettings({ ...settings, ai_model: e.target.value })
                  }
                  className="border rounded px-3 py-2 w-72"
                >
                  <optgroup label="OpenAI">
                    <option value="gpt-4.1">GPT-4.1 (Atual)</option>
                    <option value="gpt-4o-mini">GPT-4o Mini (Econômico)</option>
                    <option value="gpt-4o">GPT-4o (Mais Inteligente)</option>
                    <option value="gpt-4-turbo">GPT-4 Turbo</option>
                  </optgroup>
                  <optgroup label="DeepSeek">
                    <option value="deepseek-chat">
                      DeepSeek Chat (Rápido)
                    </option>
                    <option value="deepseek-reasoner">
                      DeepSeek Reasoner (Mais Robusto)
                    </option>
                  </optgroup>
                  <optgroup label="Anthropic">
                    <option value="claude-sonnet-4-20250514">
                      Claude 4 Sonnet (Amigável)
                    </option>
                    <option value="claude-3-5-haiku-latest">
                      Claude 3.5 Haiku (Rápido)
                    </option>
                  </optgroup>
                </select>
              </div>

              <div className="p-3 bg-blue-50 rounded-lg border border-blue-100 text-sm">
                <p className="font-medium text-blue-800">💡 Dica:</p>
                <p className="text-blue-700">
                  <strong>GPT-4o Mini</strong>: Mais rápido e econômico. Ideal
                  para uso diário.
                  <br />
                  <strong>DeepSeek Chat</strong>: Modelo alternativo com boa
                  interpretação de contexto.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Temperatura: {settings.ai_temperature.toFixed(1)}</Label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={settings.ai_temperature}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      ai_temperature: parseFloat(e.target.value),
                    })
                  }
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Preciso (0)</span>
                  <span>Criativo (1)</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Anti-Spam de Saudação</CardTitle>
              <CardDescription>
                Tempo mínimo entre saudações automáticas para o mesmo contato
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <Input
                  type="number"
                  min={1}
                  max={24}
                  value={settings.greeting_cooldown_hours}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      greeting_cooldown_hours:
                        parseInt(e.target.value, 10) || 4,
                    })
                  }
                  className="w-24"
                />
                <span className="text-muted-foreground">horas</span>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Integrations Tab */}
        <TabsContent value="integrations" className="space-y-4">
          <IntegrationsTab />
        </TabsContent>
      </Tabs>

      {/* Modal: Prompt Base Completo */}
      {showBasePrompt && baseLayer && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Lock className="h-5 w-5 text-purple-600" />
                Memória 0 - Prompt Base
              </h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowBasePrompt(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <pre className="whitespace-pre-wrap text-sm font-mono bg-gray-50 p-4 rounded-lg">
                {baseLayer.content}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Prompt Final Completo */}
      {showFinalPrompt && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Eye className="h-5 w-5 text-emerald-600" />
                Prompt Final Montado
              </h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowFinalPrompt(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <pre className="whitespace-pre-wrap text-sm font-mono bg-gray-50 p-4 rounded-lg">
                {finalPrompt}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
