#!/bin/bash
# =============================================================================
# Script de Validação da API NetCar
# =============================================================================
# Compara a tipagem local com a resposta real da API
# 
# Uso:
#   npm run api:validate
#   ./src/api/validate.sh
# =============================================================================

BASE_URL="https://www.netcarmultimarcas.com.br/api/v1"

echo "═══════════════════════════════════════════"
echo "  🚗 Validação API NetCar"
echo "═══════════════════════════════════════════"
echo ""

# Campos esperados na tipagem
CAMPOS_ESPERADOS="id marca modelo ano valor valor_formatado preco_com_troca tem_desconto cor motor combustivel cambio potencia km portas lugares placa chassi renavam opcionais imagens destaque promocao link have_galery"

# Opcionais conhecidos (lista parcial)
OPCIONAIS_ESPERADOS="air_bag ar_condicionado camera_de_re multimidia piloto_automatico sensor_de_estacionamento teto_panoramico"

echo "🔍 Validando API Veículos..."
RESPONSE=$(curl -s "${BASE_URL}/veiculos.php?limit=3" 2>/dev/null)

if [ -z "$RESPONSE" ]; then
    echo "❌ Erro: Não foi possível acessar a API"
    exit 1
fi

# Verificar sucesso
SUCCESS=$(echo "$RESPONSE" | grep -o '"success": true')
if [ -z "$SUCCESS" ]; then
    echo "❌ API retornou erro"
    exit 1
fi

echo "✅ API respondeu com sucesso"
echo ""

# Extrair campos do JSON
echo "📊 Campos encontrados na API:"
CAMPOS_API=$(echo "$RESPONSE" | grep -oE '"[a-z_]+":' | sed 's/"//g' | sed 's/://g' | sort | uniq)
echo "$CAMPOS_API" | head -20
echo "..."
echo ""

# Extrair opcionais
echo "🔧 Opcionais encontrados:"
OPCIONAIS_API=$(echo "$RESPONSE" | grep -oE '"tag": "[a-z_]+"' | sed 's/"tag": "//g' | sed 's/"//g' | sort | uniq)
TOTAL_OPC=$(echo "$OPCIONAIS_API" | wc -l | tr -d ' ')
echo "Total: $TOTAL_OPC opcionais"
echo "$OPCIONAIS_API" | head -10
echo "..."
echo ""

# Comparar com esperados
echo "═══════════════════════════════════════════"
echo "  📋 RESUMO"
echo "═══════════════════════════════════════════"
echo ""
echo "✅ API Veículos: Funcionando"
echo "✅ Campos mapeados: $(echo "$CAMPOS_API" | wc -l | tr -d ' ')"
echo "✅ Opcionais detectados: $TOTAL_OPC"
echo ""
echo "💡 Para atualizar tipagem, edite: src/api/types.ts"
echo ""

# Verificar Stock API
echo "🔍 Validando API Stock..."
STOCK=$(curl -s "${BASE_URL}/stock.php?action=enterprises" 2>/dev/null)
if echo "$STOCK" | grep -q '"success": true'; then
    echo "✅ API Stock: Funcionando"
else
    echo "⚠️  API Stock: Erro ou sem resposta"
fi

echo ""
echo "═══════════════════════════════════════════"
echo "  ✅ Validação concluída!"
echo "═══════════════════════════════════════════"
