
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface ReportData {
  totalLeads: number;
  activeLeads: number;
  sales: number;
  conversionRate: string;
  topSeller: string;
}

export function generateExecutiveReport(data: ReportData, funnelData: any[], salesData: any[]) {
  const doc = new jsPDF();
  const date = new Date().toLocaleDateString('pt-BR');

  // Header
  doc.setFontSize(20);
  doc.setTextColor(40, 40, 40);
  doc.text('Relatório Executivo - Netcar', 14, 22);
  
  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text(`Gerado em: ${date}`, 14, 28);

  // Stats Cards (Simple Text layout for PDF)
  doc.setFontSize(12);
  doc.setTextColor(0, 0, 0);
  doc.text('Resumo Geral', 14, 40);
  
  doc.setDrawColor(200, 200, 200);
  doc.line(14, 42, 196, 42);

  const stats = [
    ['Total de Leads', data.totalLeads.toString()],
    ['Leads Ativos', data.activeLeads.toString()],
    ['Vendas Fechadas', data.sales.toString()],
    ['Taxa de Conversão', data.conversionRate],
    ['Melhor Vendedor', data.topSeller]
  ];

  autoTable(doc, {
    startY: 45,
    head: [['Métrica', 'Valor']],
    body: stats,
    theme: 'grid',
    headStyles: { fillColor: [59, 130, 246] }, // Blue
    columnStyles: { 0: { fontStyle: 'bold' } }
  });

  // Funnel Section
  let finalY = (doc as any).lastAutoTable.finalY + 15;
  doc.text('Funil de Vendas', 14, finalY);
  doc.line(14, finalY + 2, 196, finalY + 2);

  const funnelBody = funnelData.map(item => [item.stage, item.count]);
  
  autoTable(doc, {
    startY: finalY + 5,
    head: [['Etapa', 'Quantidade']],
    body: funnelBody,
    theme: 'striped',
    headStyles: { fillColor: [245, 158, 11] } // Amber
  });

  // Sales Performance Section
  finalY = (doc as any).lastAutoTable.finalY + 15;
  doc.text('Performance por Vendedor', 14, finalY);
  doc.line(14, finalY + 2, 196, finalY + 2);

  const salesBody = salesData.map(item => [item.name, item.leads, item.sales, item.conversion + '%']);

  autoTable(doc, {
    startY: finalY + 5,
    head: [['Vendedor', 'Leads', 'Vendas', 'Conversão']],
    body: salesBody,
    theme: 'striped',
    headStyles: { fillColor: [34, 197, 94] } // Green
  });

  // Footer
  const pageCount = doc.internal.pages.length - 1; // fix logic
  doc.setFontSize(8);
  doc.setTextColor(150);
  doc.text('Documento confidencial. Uso interno Netcar.', 14, 285);

  // Save
  doc.save(`relatorio-executivo-${date.replace(/\//g, '-')}.pdf`);
}
