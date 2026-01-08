#!/usr/bin/env npx ts-node
/**
 * Script de Validação da API NetCar
 * ==================================
 * Compara a tipagem local com a resposta real da API
 * para detectar campos novos ou removidos.
 * 
 * Uso:
 *   npx ts-node src/api/validate.ts
 *   npm run api:validate
 */

import { OPCIONAIS_CONHECIDOS } from './types';

const BASE_URL = 'https://www.netcarmultimarcas.com.br/api/v1';

// Campos esperados do veículo (baseado na nossa tipagem)
const VEICULO_CAMPOS_ESPERADOS = [
  'id', 'marca', 'modelo', 'ano', 'valor', 'valor_formatado',
  'preco_com_troca', 'preco_com_troca_formatado', 'tem_desconto', 'valor_sem_desconto',
  'cor', 'motor', 'combustivel', 'cambio', 'potencia', 'km', 'portas', 'lugares',
  'placa', 'chassi', 'renavam',
  'direcao', 'ar_condicionado', 'vidros_eletricos', 'travas_eletricas',
  'airbag', 'abs', 'alarme', 'som', 'rodas', 'pneus', 'freios', 'suspensao',
  'motor_status', 'cambio_status', 'pintura_status', 'lataria_status',
  'interior_status', 'pneus_status', 'documentacao', 'observacoes',
  'link', 'have_galery', 'imagens', 'opcionais',
  'data_cadastro', 'data_atualizacao', 'status', 'destaque', 'promocao'
];

interface ValidationResult {
  endpoint: string;
  status: 'ok' | 'warning' | 'error';
  newFields: string[];
  missingFields: string[];
  newOpcionais: string[];
  message: string;
}

async function fetchAPI<T>(endpoint: string): Promise<T> {
  const response = await fetch(`${BASE_URL}${endpoint}`);
  if (!response.ok) {
    throw new Error(`API Error: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function validateVeiculos(): Promise<ValidationResult> {
  console.log('🔍 Validando API Veículos...');
  
  const result: ValidationResult = {
    endpoint: '/veiculos.php',
    status: 'ok',
    newFields: [],
    missingFields: [],
    newOpcionais: [],
    message: ''
  };

  try {
    const response = await fetchAPI<{ data: Record<string, unknown>[] }>('/veiculos.php?limit=5');
    
    if (!response.data || response.data.length === 0) {
      result.status = 'warning';
      result.message = 'Nenhum veículo retornado para validação';
      return result;
    }

    // Pegar todos os campos únicos de todos os veículos
    const allFields = new Set<string>();
    const allOpcionais = new Set<string>();

    for (const veiculo of response.data) {
      Object.keys(veiculo).forEach(key => allFields.add(key));
      
      // Verificar opcionais
      if (Array.isArray(veiculo.opcionais)) {
        for (const opc of veiculo.opcionais as { tag: string }[]) {
          if (opc.tag) allOpcionais.add(opc.tag);
        }
      }
    }

    // Campos novos (na API mas não na tipagem)
    result.newFields = [...allFields].filter(f => !VEICULO_CAMPOS_ESPERADOS.includes(f));
    
    // Campos faltando (na tipagem mas não na API) - menos crítico
    result.missingFields = VEICULO_CAMPOS_ESPERADOS.filter(f => !allFields.has(f));
    
    // Opcionais novos
    result.newOpcionais = [...allOpcionais].filter(o => !OPCIONAIS_CONHECIDOS.includes(o as any));

    // Determinar status
    if (result.newFields.length > 0 || result.newOpcionais.length > 0) {
      result.status = 'warning';
      result.message = 'Novos campos/opcionais detectados na API';
    } else {
      result.message = 'Tipagem sincronizada com a API';
    }

  } catch (error) {
    result.status = 'error';
    result.message = `Erro ao acessar API: ${error}`;
  }

  return result;
}

async function validateStock(): Promise<ValidationResult> {
  console.log('🔍 Validando API Stock...');
  
  const result: ValidationResult = {
    endpoint: '/stock.php',
    status: 'ok',
    newFields: [],
    missingFields: [],
    newOpcionais: [],
    message: 'Stock API validada'
  };

  try {
    // Testar ações conhecidas
    const actions = ['enterprises', 'years', 'prices'];
    
    for (const action of actions) {
      const response = await fetchAPI<{ success: boolean }>(`/stock.php?action=${action}`);
      if (!response.success) {
        result.status = 'warning';
        result.message = `Action '${action}' retornou success=false`;
      }
    }
  } catch (error) {
    result.status = 'error';
    result.message = `Erro ao acessar API: ${error}`;
  }

  return result;
}

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  🚗 Validação API NetCar');
  console.log('═══════════════════════════════════════════\n');

  const results: ValidationResult[] = [];

  // Validar cada endpoint
  results.push(await validateVeiculos());
  results.push(await validateStock());

  // Mostrar resultados
  console.log('\n═══════════════════════════════════════════');
  console.log('  📊 RESULTADOS');
  console.log('═══════════════════════════════════════════\n');

  for (const result of results) {
    const icon = result.status === 'ok' ? '✅' : result.status === 'warning' ? '⚠️' : '❌';
    console.log(`${icon} ${result.endpoint}: ${result.message}`);
    
    if (result.newFields.length > 0) {
      console.log(`   📦 Novos campos: ${result.newFields.join(', ')}`);
    }
    if (result.newOpcionais.length > 0) {
      console.log(`   🔧 Novos opcionais: ${result.newOpcionais.join(', ')}`);
    }
    if (result.missingFields.length > 0 && result.missingFields.length < 10) {
      console.log(`   📭 Campos não encontrados: ${result.missingFields.join(', ')}`);
    }
    console.log('');
  }

  // Resumo
  const hasWarnings = results.some(r => r.status === 'warning');
  const hasErrors = results.some(r => r.status === 'error');

  if (hasErrors) {
    console.log('❌ Validação falhou. Verifique os erros acima.');
    process.exit(1);
  } else if (hasWarnings) {
    console.log('⚠️  Validação concluída com avisos. Considere atualizar a tipagem.');
    process.exit(0);
  } else {
    console.log('✅ Validação concluída. Tipagem sincronizada!');
    process.exit(0);
  }
}

main().catch(console.error);
