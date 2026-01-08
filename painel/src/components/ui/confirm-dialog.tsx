'use client';

import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle, HelpCircle, Info, Trash2 } from 'lucide-react';

// ========================================
// TYPES
// ========================================
type ConfirmVariant = 'danger' | 'warning' | 'info' | 'default';

interface ConfirmOptions {
  title?: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  variant?: ConfirmVariant;
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
}

interface ConfirmDialogContextType {
  confirm: (options: ConfirmOptions) => void;
  confirmDelete: (itemName: string, onConfirm: () => void | Promise<void>) => void;
}

// ========================================
// CONTEXT
// ========================================
const ConfirmDialogContext = React.createContext<ConfirmDialogContextType | null>(null);

// ========================================
// HOOK
// ========================================
export function useConfirmDialog() {
  const context = React.useContext(ConfirmDialogContext);
  if (!context) {
    throw new Error('useConfirmDialog must be used within a ConfirmDialogProvider');
  }
  return context;
}

// ========================================
// PROVIDER
// ========================================
export function ConfirmDialogProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);
  const [options, setOptions] = React.useState<ConfirmOptions | null>(null);

  const confirm = React.useCallback((opts: ConfirmOptions) => {
    setOptions(opts);
    setIsOpen(true);
  }, []);

  const confirmDelete = React.useCallback((itemName: string, onConfirm: () => void | Promise<void>) => {
    confirm({
      title: 'Confirmar exclusão',
      description: `Tem certeza que deseja excluir "${itemName}"? Esta ação não pode ser desfeita.`,
      confirmText: 'Excluir',
      cancelText: 'Cancelar',
      variant: 'danger',
      onConfirm,
    });
  }, [confirm]);

  const handleConfirm = async () => {
    if (!options?.onConfirm) return;
    
    setIsLoading(true);
    try {
      await options.onConfirm();
      setIsOpen(false);
      setOptions(null);
    } catch (error) {
      console.error('Error in confirm action:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    options?.onCancel?.();
    setIsOpen(false);
    setOptions(null);
  };

  const getIcon = () => {
    switch (options?.variant) {
      case 'danger':
        return <Trash2 className="h-6 w-6 text-red-500" />;
      case 'warning':
        return <AlertTriangle className="h-6 w-6 text-amber-500" />;
      case 'info':
        return <Info className="h-6 w-6 text-blue-500" />;
      default:
        return <HelpCircle className="h-6 w-6 text-gray-500" />;
    }
  };

  const getConfirmButtonClass = () => {
    switch (options?.variant) {
      case 'danger':
        return 'bg-red-600 hover:bg-red-700 text-white';
      case 'warning':
        return 'bg-amber-600 hover:bg-amber-700 text-white';
      default:
        return '';
    }
  };

  return (
    <ConfirmDialogContext.Provider value={{ confirm, confirmDelete }}>
      {children}
      <Dialog open={isOpen} onOpenChange={(open) => !open && handleCancel()}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 p-2 rounded-full bg-gray-100">
                {getIcon()}
              </div>
              <div className="flex-1">
                <DialogTitle className="text-lg">
                  {options?.title || 'Confirmar ação'}
                </DialogTitle>
                <DialogDescription className="mt-2 text-sm text-gray-600">
                  {options?.description}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <DialogFooter className="mt-4 flex gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={handleCancel}
              disabled={isLoading}
            >
              {options?.cancelText || 'Cancelar'}
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={isLoading}
              className={getConfirmButtonClass()}
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Processando...
                </span>
              ) : (
                options?.confirmText || 'Confirmar'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmDialogContext.Provider>
  );
}
