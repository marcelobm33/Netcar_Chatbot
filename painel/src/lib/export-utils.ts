/**
 * Export Utilities for Dashboard
 * Provides CSV and PDF export functionality
 */

/**
 * Convert data array to CSV string
 */
export function convertToCSV<T extends Record<string, unknown>>(
  data: T[],
  columns: { key: keyof T; label: string }[]
): string {
  if (data.length === 0) return '';

  // Header row
  const header = columns.map(col => `"${col.label}"`).join(',');

  // Data rows
  const rows = data.map(item =>
    columns.map(col => {
      const value = item[col.key];
      if (value === null || value === undefined) return '""';
      if (typeof value === 'string') return `"${value.replace(/"/g, '""')}"`;
      if (value instanceof Date) return `"${value.toLocaleDateString('pt-BR')}"`;
      return `"${String(value)}"`;
    }).join(',')
  );

  return [header, ...rows].join('\n');
}

/**
 * Download CSV file
 */
export function downloadCSV(csvContent: string, filename: string): void {
  const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  
  link.setAttribute('href', url);
  link.setAttribute('download', `${filename}.csv`);
  link.style.visibility = 'hidden';
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Lead columns for export
 */
export const leadExportColumns = [
  { key: 'name' as const, label: 'Nome' },
  { key: 'phone' as const, label: 'Telefone' },
  { key: 'origem' as const, label: 'Origem' },
  { key: 'status' as const, label: 'Status' },
  { key: 'score' as const, label: 'Score' },
  { key: 'temperature' as const, label: 'Temperatura' },
  { key: 'interesse' as const, label: 'Interesse' },
  { key: 'vendedor_nome' as const, label: 'Vendedor' },
  { key: 'created_at' as const, label: 'Data Criação' },
  { key: 'last_message_at' as const, label: 'Última Mensagem' },
];

/**
 * Seller performance columns for export
 */
export const sellerPerformanceColumns = [
  { key: 'name' as const, label: 'Vendedor' },
  { key: 'total_leads' as const, label: 'Total Leads' },
  { key: 'leads_won' as const, label: 'Vendas' },
  { key: 'conversion_rate' as const, label: 'Taxa Conversão (%)' },
  { key: 'avg_response_time' as const, label: 'Tempo Resposta Médio' },
];

/**
 * Format date for filename
 */
export function getExportFilename(prefix: string): string {
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  return `${prefix}_${date}`;
}

/**
 * Export leads to CSV
 */
export function exportLeadsToCSV(leads: Record<string, unknown>[]): void {
  const csv = convertToCSV(leads, leadExportColumns);
  downloadCSV(csv, getExportFilename('leads_netcar'));
}

/**
 * Export seller performance to CSV
 */
export function exportSellersToCSV(sellers: Record<string, unknown>[]): void {
  const csv = convertToCSV(sellers, sellerPerformanceColumns);
  downloadCSV(csv, getExportFilename('vendedores_performance'));
}

// ========================================
// PDF Export (requires jspdf)
// ========================================

/**
 * Dynamic import of jsPDF to avoid SSR issues
 */
export async function exportToPDF(
  title: string,
  data: Record<string, unknown>[],
  columns: { key: string; label: string }[]
): Promise<void> {
  // Dynamically import jsPDF
  const { jsPDF } = await import('jspdf');
  // @ts-expect-error - autotable is a plugin
  await import('jspdf-autotable');

  const doc = new jsPDF();

  // Title
  doc.setFontSize(18);
  doc.text(title, 14, 22);

  // Subtitle with date
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, 14, 30);

  // Table
  const tableColumn = columns.map(c => c.label);
  const tableRows = data.map(item =>
    columns.map(col => {
      const value = item[col.key];
      if (value === null || value === undefined) return '-';
      if (value instanceof Date) return value.toLocaleDateString('pt-BR');
      return String(value);
    })
  );

  // @ts-expect-error - autotable extends jsPDF
  doc.autoTable({
    head: [tableColumn],
    body: tableRows,
    startY: 35,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [41, 128, 185] },
  });

  // Save
  doc.save(`${getExportFilename(title.toLowerCase().replace(/\s+/g, '_'))}.pdf`);
}

/**
 * Export leads to PDF
 */
export async function exportLeadsToPDF(leads: Record<string, unknown>[]): Promise<void> {
  await exportToPDF('Relatório de Leads - Netcar', leads, leadExportColumns);
}

/**
 * Export seller performance to PDF
 */
export async function exportSellersToPDF(sellers: Record<string, unknown>[]): Promise<void> {
  await exportToPDF('Performance de Vendedores - Netcar', sellers, sellerPerformanceColumns);
}
