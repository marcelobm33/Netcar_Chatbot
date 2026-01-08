
'use client';

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface PerformanceData {
  name: string;
  leads: number;
  conversion: number; // Percentage
  sales: number;
}

const mockData: PerformanceData[] = [
  { name: 'João', leads: 45, conversion: 15, sales: 7 },
  { name: 'Maria', leads: 60, conversion: 10, sales: 6 },
  { name: 'Pedro', leads: 30, conversion: 20, sales: 6 },
  { name: 'Ana', leads: 50, conversion: 12, sales: 6 },
];

interface PerformanceChartProps {
  data?: PerformanceData[];
}

export function PerformanceChart({ data = mockData }: PerformanceChartProps) {
  return (
    <Card className="col-span-4 lg:col-span-4">
      <CardHeader>
        <CardTitle>Performance da Equipe</CardTitle>
        <CardDescription>
          Leads atendidos vs. Vendas realizadas.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={350}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis 
                dataKey="name" 
                axisLine={false} 
                tickLine={false} 
                tick={{ fontSize: 12 }} 
            />
            <YAxis 
                axisLine={false} 
                tickLine={false} 
                tick={{ fontSize: 12 }}
            />
            <Tooltip 
                 contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
            />
            <Legend />
            <Bar 
                dataKey="leads" 
                name="Leads Atendidos" 
                fill="#94a3b8" 
                radius={[4, 4, 0, 0]} 
            />
            <Bar 
                dataKey="sales" 
                name="Vendas Fechadas" 
                fill="#2563eb" 
                radius={[4, 4, 0, 0]} 
            />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
