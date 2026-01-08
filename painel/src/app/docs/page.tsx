"use client";

import React from "react";

export default function DocsPage() {
  return (
    <div className="max-w-4xl mx-auto p-8 space-y-8">
      <div>
        <h1 className="text-4xl font-bold tracking-tight mb-4">📚 Documentação do Sistema</h1>
        <p className="text-xl text-muted-foreground">
          Visão geral da arquitetura, fluxos e guias de manutenção do iAN.
        </p>
      </div>

      {/* Quick Links for Maintenance */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <a href="#reconectar" className="bg-white p-4 rounded-lg shadow hover:shadow-md transition border-l-4 border-red-500">
          <h3 className="font-semibold text-gray-900">🔴 Reconectar WhatsApp</h3>
          <p className="text-sm text-gray-500">Quando o bot para de responder</p>
        </a>
        <a href="#recriar" className="bg-white p-4 rounded-lg shadow hover:shadow-md transition border-l-4 border-yellow-500">
          <h3 className="font-semibold text-gray-900">⚠️ Recriar Instância</h3>
          <p className="text-sm text-gray-500">Quando reconexão não funciona</p>
        </a>
        <a href="#problemas" className="bg-white p-4 rounded-lg shadow hover:shadow-md transition border-l-4 border-blue-500">
          <h3 className="font-semibold text-gray-900">💡 Problemas Comuns</h3>
          <p className="text-sm text-gray-500">Soluções rápidas</p>
        </a>
      </div>

      {/* Section: Reconectar WhatsApp */}
      <section id="reconectar" className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
          <span className="bg-red-100 text-red-600 px-2 py-1 rounded text-sm">URGENTE</span>
          Como Reconectar o WhatsApp
        </h2>
        
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
          <p className="text-red-800 font-medium">
            ⚠️ Quando usar: O bot parou de responder e você recebeu alerta de desconexão.
          </p>
        </div>

        <ol className="space-y-4">
          <li className="flex gap-4">
            <span className="flex-shrink-0 w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold">1</span>
            <div>
              <h4 className="font-semibold">Acesse a Evolution API</h4>
              <p className="text-gray-600">Abra o painel da Evolution API no navegador:</p>
              <code className="block bg-gray-100 p-2 rounded mt-2 text-sm">
                https://thriller-rack-susan-dis.trycloudflare.com
              </code>
            </div>
          </li>
          <li className="flex gap-4">
            <span className="flex-shrink-0 w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold">2</span>
            <div>
              <h4 className="font-semibold">Faça login com a chave API</h4>
              <code className="block bg-gray-100 p-2 rounded mt-2 text-sm">
                429683C4C977415CAAFCCE10F7D57E11
              </code>
            </div>
          </li>
          <li className="flex gap-4">
            <span className="flex-shrink-0 w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold">3</span>
            <div>
              <h4 className="font-semibold">Encontre a instância &quot;netcar-bot&quot;</h4>
              <p className="text-gray-600">Clique na instância para ver os detalhes</p>
            </div>
          </li>
          <li className="flex gap-4">
            <span className="flex-shrink-0 w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold">4</span>
            <div>
              <h4 className="font-semibold">Clique em &quot;Connect&quot; ou &quot;Reconectar&quot;</h4>
              <p className="text-gray-600">Um QR Code será exibido</p>
            </div>
          </li>
          <li className="flex gap-4">
            <span className="flex-shrink-0 w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold">5</span>
            <div>
              <h4 className="font-semibold">Escaneie o QR Code</h4>
              <p className="text-gray-600">
                No celular: WhatsApp → Menu (3 pontos) → Aparelhos Conectados → Conectar Aparelho
              </p>
            </div>
          </li>
          <li className="flex gap-4">
            <span className="flex-shrink-0 w-8 h-8 bg-green-600 text-white rounded-full flex items-center justify-center font-bold">✓</span>
            <div>
              <h4 className="font-semibold text-green-700">Pronto!</h4>
              <p className="text-gray-600">O status deve mudar para &quot;CONNECTED&quot; e o bot voltará a funcionar.</p>
            </div>
          </li>
        </ol>
      </section>

      {/* Section: Recriar Instância */}
      <section id="recriar" className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
          <span className="bg-yellow-100 text-yellow-700 px-2 py-1 rounded text-sm">AVANÇADO</span>
          Como Recriar a Instância (Quando Reconexão Falha)
        </h2>
        
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
          <p className="text-yellow-800 font-medium">
            ⚠️ Quando usar: O passo acima não funcionou e aparece erro &quot;SessionError&quot; ou &quot;No sessions&quot;.
          </p>
        </div>

        <ol className="space-y-4">
          <li className="flex gap-4">
            <span className="flex-shrink-0 w-8 h-8 bg-yellow-600 text-white rounded-full flex items-center justify-center font-bold">1</span>
            <div>
              <h4 className="font-semibold">Delete a instância atual</h4>
              <p className="text-gray-600">No painel da Evolution API, clique em &quot;Delete&quot; na instância netcar-bot</p>
              <div className="bg-red-50 p-2 rounded mt-2 text-sm text-red-700">
                ⚠️ Isso vai desconectar o WhatsApp temporariamente
              </div>
            </div>
          </li>
          <li className="flex gap-4">
            <span className="flex-shrink-0 w-8 h-8 bg-yellow-600 text-white rounded-full flex items-center justify-center font-bold">2</span>
            <div>
              <h4 className="font-semibold">Crie uma nova instância</h4>
              <p className="text-gray-600">Clique em &quot;New Instance&quot; e use estas configurações:</p>
              <div className="bg-gray-100 p-3 rounded mt-2 text-sm font-mono">
                <div><strong>Instance Name:</strong> netcar-bot</div>
                <div><strong>Token:</strong> (deixe vazio)</div>
                <div><strong>Number:</strong> (deixe vazio)</div>
              </div>
            </div>
          </li>
          <li className="flex gap-4">
            <span className="flex-shrink-0 w-8 h-8 bg-yellow-600 text-white rounded-full flex items-center justify-center font-bold">3</span>
            <div>
              <h4 className="font-semibold">Configure o Webhook</h4>
              <p className="text-gray-600">Após criar, vá em &quot;Settings&quot; → &quot;Webhook&quot; e configure:</p>
              <div className="bg-gray-100 p-3 rounded mt-2 text-sm font-mono">
                <div><strong>URL:</strong></div>
                <div className="break-all text-xs">https://netcar-worker.contato-11e.workers.dev/webhook/evolution</div>
                <div className="mt-2"><strong>Events:</strong> MESSAGES_UPSERT, MESSAGES_UPDATE, CONNECTION_UPDATE</div>
                <div><strong>Enabled:</strong> ✅ Sim</div>
              </div>
            </div>
          </li>
          <li className="flex gap-4">
            <span className="flex-shrink-0 w-8 h-8 bg-yellow-600 text-white rounded-full flex items-center justify-center font-bold">4</span>
            <div>
              <h4 className="font-semibold">Conecte escaneando o QR Code</h4>
              <p className="text-gray-600">Clique em &quot;Connect&quot; e escaneie o QR Code com o WhatsApp do celular.</p>
            </div>
          </li>
          <li className="flex gap-4">
            <span className="flex-shrink-0 w-8 h-8 bg-green-600 text-white rounded-full flex items-center justify-center font-bold">✓</span>
            <div>
              <h4 className="font-semibold text-green-700">Pronto!</h4>
              <p className="text-gray-600">A nova instância está configurada. O webhook será reconfigurado automaticamente pelo sistema.</p>
            </div>
          </li>
        </ol>
      </section>

      {/* Section: Problemas Comuns */}
      <section id="problemas" className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">
          💡 Problemas Comuns e Soluções
        </h2>

        <div className="space-y-4">
          <div className="border-l-4 border-blue-500 pl-4">
            <h4 className="font-semibold">Bot não responde mas está conectado</h4>
            <p className="text-gray-600 text-sm">
              Verifique se o número não está na blocklist. Vá em Configurações → Blocklist e remova se necessário.
            </p>
          </div>
          
          <div className="border-l-4 border-blue-500 pl-4">
            <h4 className="font-semibold">QR Code não aparece</h4>
            <p className="text-gray-600 text-sm">
              A Evolution API pode estar offline. Verifique se o servidor está rodando. A URL do Cloudflare Tunnel muda quando reinicia.
            </p>
          </div>
          
          <div className="border-l-4 border-blue-500 pl-4">
            <h4 className="font-semibold">Erro &quot;not-acceptable&quot; ao enviar mensagem</h4>
            <p className="text-gray-600 text-sm">
              A sessão do WhatsApp expirou. Reconecte seguindo o passo a passo acima.
            </p>
          </div>
          
          <div className="border-l-4 border-blue-500 pl-4">
            <h4 className="font-semibold">Erro &quot;SessionError: No sessions&quot;</h4>
            <p className="text-gray-600 text-sm">
              A instância precisa ser recriada. Siga o passo a passo &quot;Recriar Instância&quot; acima.
            </p>
          </div>
          
          <div className="border-l-4 border-blue-500 pl-4">
            <h4 className="font-semibold">Bot responde lento (mais de 30 segundos)</h4>
            <p className="text-gray-600 text-sm">
              Normal para respostas com imagens de carros. O sistema busca, processa e envia as imagens.
            </p>
          </div>
        </div>
      </section>

      {/* Architecture Section */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold border-b pb-2">Arquitetura (Cloudflare Stack)</h2>
        <p>
          O sistema foi migrado completamente para a edge network da Cloudflare, eliminando a dependência do Supabase para maior performance e menor latência.
        </p>
        <ul className="list-disc pl-6 space-y-2 text-gray-700">
          <li><strong>Cloudflare Workers:</strong> Backend serverless que gerencia toda a lógica de negócios, webhooks do WhatsApp e integrações com IA.</li>
          <li><strong>Cloudflare D1 (SQL):</strong> Banco de dados relacional distribuído para armazenar leads, vendedores, configurações e histórico de mensagens.</li>
          <li><strong>Cloudflare KV:</strong> Armazenamento chave-valor de ultra-baixa latência para Blocklist e Cache.</li>
          <li><strong>Cloudflare R2:</strong> Armazenamento de objetos para imagens dos vendedores e mídia, incluindo proxy de imagens com cache.</li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold border-b pb-2">Fluxo de Atendimento</h2>
        <div className="bg-gray-50 p-6 rounded-lg border">
          <h3 className="font-semibold mb-2">Entrada de Lead (WhatsApp)</h3>
          <p className="text-sm text-gray-600 mb-4">
            Quando um cliente envia uma mensagem para o número da loja:
          </p>
          <ol className="list-decimal pl-6 space-y-2 text-sm">
            <li>O webhook da Evolution API recebe a mensagem e repassa para o Worker.</li>
            <li>O Worker verifica se o remetente está na <strong>Blocklist</strong> (KV). Se sim, ignora.</li>
            <li>Se for um novo lead, é criado no <strong>D1</strong>. (Opcional: Disparo de Webhook para CRM externo).</li>
            <li>A IA (OpenAI) analisa a mensagem para determinar a intenção e contexto.</li>
            <li>O sistema responde automaticamente ou encaminha para um vendedor.</li>
          </ol>
        </div>
      </section>

      {/* Contact Support */}
      <section className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-lg shadow p-6 text-white">
        <h2 className="text-xl font-bold mb-2">🛠️ Precisa de Ajuda Técnica?</h2>
        <p className="opacity-90 mb-4">
          Se os passos acima não funcionarem, entre em contato com o suporte técnico.
        </p>
        <div className="flex gap-4">
          <a 
            href="https://wa.me/5551988792811" 
            target="_blank"
            rel="noopener noreferrer"
            className="bg-white text-blue-600 px-4 py-2 rounded font-semibold hover:bg-blue-50 transition"
          >
            💬 WhatsApp Suporte
          </a>
        </div>
      </section>

      {/* Footer */}
      <div className="text-center text-gray-500 text-sm">
        Última atualização: {new Date().toLocaleDateString("pt-BR")}
      </div>
    </div>
  );
}

