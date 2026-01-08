
'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis, Tooltip, Legend } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface FunnelData {
  stage: string;
  count: number;
  fill: string;
}

const mockData: FunnelData[] = [
  { stage: 'Novos', count: 120, fill: '#3b82f6' },
  { stage: 'Em Atendimento', count: 85, fill: '#f59e0b' },
  { stage: 'Visita Agendada', count: 45, fill: '#8b5cf6' },
  { stage: 'Proposta', count: 20, fill: '#10b981' },
  { stage: 'Vendido', count: 12, fill: '#22c55e' }, // Added SOLD stage
];

interface FunnelChartProps {
  data?: FunnelData[];
}

export function FunnelChart({ data = mockData }: FunnelChartProps) {
  return (
    <Card className="col-span-4 lg:col-span-3">
      <CardHeader>
        <CardTitle>Funil de Vendas</CardTitle>
        <CardDescription>
          Distribuição dos leads por etapa do pipeline.
        </CardDescription>
      </CardHeader>
      <CardContent className="pl-2">
        <ResponsiveContainer width="100%" height={350}>
          <BarChart data={data} layout="vertical" margin={{ left: 20 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" hide />
            <YAxis 
                dataKey="stage" 
                type="category" 
                axisLine={false} 
                tickLine={false}
                width={120}
                tick={{ fontSize: 12 }} 
            />
            <Tooltip 
                cursor={{ fill: 'transparent' }}
                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
            />
            <Bar 
                dataKey="count" 
                radius={[0, 4, 4, 0]} 
                barSize={32}
                animationDuration={1500}
            />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
