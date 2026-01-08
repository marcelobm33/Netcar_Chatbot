'use client';

import { useEffect, useState } from 'react';
import { api, Vendedor } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { UserPlus, Trash2, Edit2, Upload, User as UserIcon, PauseCircle, PlayCircle } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';

export default function SellersPage() {
  const { toast, error: toastError, warning: toastWarning } = useToast();
  const { confirmDelete } = useConfirmDialog();
  const [sellers, setSellers] = useState<Vendedor[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  
  // Form State
  const [editingId, setEditingId] = useState<number | null>(null);
  const [nome, setNome] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [ativo, setAtivo] = useState(true);

  useEffect(() => {
    fetchSellers();
  }, []);

  async function fetchSellers() {
    try {
      const data: any = await api.getSellers();
      setSellers(data || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  async function handleSave() {
    if (!nome || !whatsapp) { toastWarning('Nome e WhatsApp são obrigatórios'); return; }

    try {
      setLoading(true);
      await api.saveSeller({
        id: editingId,
        nome,
        whatsapp,
        imagem: imageUrl,
        ativo
      });
      
      setIsOpen(false);
      resetForm();
      fetchSellers();
    } catch (e: any) {
      toastError('Erro ao salvar: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  function handleDelete(id: number) {
    const seller = sellers.find(s => s.id === id);
    confirmDelete(seller?.nome || 'este vendedor', async () => {
      try {
        await api.deleteSeller(id);
        fetchSellers();
      } catch (e: any) {
        toastError('Erro ao excluir: ' + e.message);
      }
    });
  }

  async function handleToggleActive(seller: Vendedor) {
    try {
      await api.saveSeller({
        id: seller.id,
        nome: seller.nome,
        whatsapp: seller.whatsapp,
        imagem: seller.imagem || '',
        ativo: !seller.ativo
      });
      fetchSellers();
    } catch (e: any) {
      toastError('Erro ao alterar status: ' + e.message);
    }
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setUploading(true);
      const res = await api.uploadImage(file);
      if (res.url) {
        setImageUrl(res.url);
      }
    } catch (err: any) {
      toastError('Erro no upload: ' + err.message);
    } finally {
      setUploading(false);
    }
  }

  function openEdit(seller: Vendedor) {
    setEditingId(seller.id);
    setNome(seller.nome);
    setWhatsapp(seller.whatsapp);
    setImageUrl(seller.imagem || '');
    setAtivo(seller.ativo);
    setIsOpen(true);
  }

  function resetForm() {
    setEditingId(null);
    setNome('');
    setWhatsapp('');
    setImageUrl('');
    setAtivo(true);
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Equipe de Vendas</h1>
          <p className="text-muted-foreground mt-2">
            Gerencie os vendedores que atenderão os leads.
          </p>
        </div>
        <Dialog open={isOpen} onOpenChange={(open) => { setIsOpen(open); if(!open) resetForm(); }}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <UserPlus className="h-4 w-4" />
              Novo Vendedor
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingId ? 'Editar Vendedor' : 'Adicionar Novo Vendedor'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="flex items-center justify-center mb-4">
                  {imageUrl ? (
                      <div className="relative w-24 h-24 rounded-full overflow-hidden border-2 border-gray-100">
                          <img src={imageUrl} alt="Preview" className="w-full h-full object-cover" />
                      </div>
                  ) : (
                      <div className="w-24 h-24 rounded-full bg-gray-100 flex items-center justify-center text-gray-400">
                          <UserIcon className="h-10 w-10" />
                      </div>
                  )}
              </div>
              
              <div className="space-y-2">
                <Label>Foto do Perfil</Label>
                <div className="flex gap-2">
                    <Input type="file" onChange={handleImageUpload} disabled={uploading} accept="image/*" />
                </div>
                {uploading && <p className="text-xs text-blue-500">Enviando imagem...</p>}
              </div>

              <div className="space-y-2">
                <Label>Nome Completo</Label>
                <Input value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex: João Silva" />
              </div>
              
              <div className="space-y-2">
                <Label>WhatsApp (com DDD)</Label>
                <Input value={whatsapp} onChange={e => setWhatsapp(e.target.value)} placeholder="Ex: 5511999999999" />
              </div>
              
              <div className="flex items-center justify-between">
                <Label>Vendedor Ativo</Label>
                <Switch checked={ativo} onCheckedChange={setAtivo} />
              </div>

              <Button className="w-full" onClick={handleSave} disabled={loading || uploading}>
                {loading ? 'Salvando...' : 'Salvar Vendedor'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {sellers.map((seller) => (
          <Card key={seller.id} className="overflow-hidden">
            <CardHeader className="flex flex-row items-center gap-4 space-y-0 pb-2">
              <div className="h-12 w-12 rounded-full overflow-hidden bg-gray-100 border">
                  {seller.imagem ? (
                      <img src={seller.imagem} alt={seller.nome} className="h-full w-full object-cover" />
                  ) : (
                      <div className="h-full w-full flex items-center justify-center text-gray-400">
                          <UserIcon className="h-6 w-6" />
                      </div>
                  )}
              </div>
              <div className="flex-1">
                  <CardTitle className="text-base font-semibold">{seller.nome}</CardTitle>
                  <p className="text-xs text-muted-foreground">{seller.whatsapp}</p>
              </div>
              <div className={`h-2.5 w-2.5 rounded-full ${seller.ativo ? 'bg-green-500' : 'bg-red-500'}`} />
            </CardHeader>
            <CardContent>
              <div className="flex justify-end gap-2 mt-4">
                <Button
                  variant={seller.ativo ? "secondary" : "default"}
                  size="sm"
                  onClick={() => handleToggleActive(seller)}
                  title={seller.ativo ? 'Colocar em férias' : 'Reativar'}
                >
                  {seller.ativo ? (
                    <><PauseCircle className="h-4 w-4 mr-1" /> Férias</>
                  ) : (
                    <><PlayCircle className="h-4 w-4 mr-1" /> Ativar</>
                  )}
                </Button>
                <Button variant="outline" size="sm" onClick={() => openEdit(seller)}>
                  <Edit2 className="h-4 w-4 mr-1" /> Editar
                </Button>
                <Button variant="destructive" size="sm" onClick={() => handleDelete(seller.id)}>
                  <Trash2 className="h-4 w-4 mr-1" /> Excluir
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}

        {sellers.length === 0 && !loading && (
          <div className="col-span-full text-center py-12 text-muted-foreground">
            Nenhum vendedor cadastrado.
          </div>
        )}
      </div>
    </div>
  );
}
