'use client'
import React, { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { X, Pencil, Trash2, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import { createCategoryAction, updateCategoryAction, deleteCategoryAction } from '@/lib/actions/categories';

interface Category {
  id: string;
  name: string;
}

interface CategoriesModalProps {
  isOpen: boolean;
  onClose: () => void;
  categories: Category[];
}

export function CategoriesModal({ isOpen, onClose, categories }: CategoriesModalProps) {
  const router = useRouter();
  const [newCat, setNewCat] = useState('');
  const [loading, setLoading] = useState(false);
  const isSubmittingRef = useRef(false);
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  if (!isOpen) return null;

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCat.trim() || isSubmittingRef.current || loading) return;
    
    isSubmittingRef.current = true;
    setLoading(true);
    try {
      const res = await createCategoryAction(newCat);
      if (res.success) {
        toast.success('Category added');
        setNewCat('');
        router.refresh();
      } else {
        toast.error(res.error || 'Failed to add category');
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error adding category');
    } finally {
      isSubmittingRef.current = false;
      setLoading(false);
    }
  };

  const startEdit = (cat: Category) => {
    setEditingId(cat.id);
    setEditName(cat.name);
  };

  const saveEdit = async () => {
    if (!editingId || !editName.trim() || isSubmittingRef.current || loading) return;
    isSubmittingRef.current = true;
    setLoading(true);
    try {
      const res = await updateCategoryAction(editingId, editName);
      if (res.success) {
        toast.success('Category updated');
        setEditingId(null);
        router.refresh();
      } else {
        toast.error(res.error || 'Failed to update category');
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error updating category');
    } finally {
      isSubmittingRef.current = false;
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (isSubmittingRef.current || loading) return;
    if (!window.confirm('Are you sure you want to delete this category?')) return;
    isSubmittingRef.current = true;
    setLoading(true);
    try {
      const res = await deleteCategoryAction(id);
      if (res.success) {
        toast.success('Category deleted');
        router.refresh();
      } else {
        toast.error(res.error || 'Failed to delete category');
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error deleting category');
    } finally {
      isSubmittingRef.current = false;
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1A17]/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-surface rounded-[16px] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.3)] w-full max-w-md overflow-hidden transform animate-in zoom-in-95 duration-200">
        
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="text-[16px] font-bold text-ink-primary">Product categories</h2>
          <button onClick={onClose} className="text-ink-muted hover:text-ink-primary transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5">
          <form onSubmit={handleAdd} className="mb-6">
            <label className="block text-[13px] font-medium text-ink-primary mb-2">New category</label>
            <div className="flex gap-2">
              <input 
                type="text" 
                value={newCat} 
                onChange={e => setNewCat(e.target.value)} 
                placeholder="e.g. Men, Women, Kids"
                className="flex-1 p-2.5 bg-surface border border-border rounded-[8px] text-[14px] focus:outline-none focus:ring-1 focus:ring-[#A83D24]"
              />
              <button 
                type="submit" 
                disabled={loading || !newCat.trim()}
                className="px-5 bg-[#A83D24]/50 hover:bg-[#A83D24] text-white font-medium rounded-[8px] transition-colors disabled:opacity-50 text-[14px]"
              >
                Add
              </button>
            </div>
          </form>

          <div className="border border-border rounded-[12px] divide-y divide-border overflow-hidden">
            {categories.length === 0 ? (
              <div className="p-4 text-center text-[13px] text-ink-muted bg-row-alt">No categories yet.</div>
            ) : (
              categories.map(cat => (
                <div key={cat.id} className="flex items-center justify-between p-4 bg-surface hover:bg-row-alt transition-colors group">
                  {editingId === cat.id ? (
                    <div className="flex items-center gap-2 flex-1 mr-2">
                      <input 
                        autoFocus
                        type="text" 
                        value={editName} 
                        onChange={e => setEditName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            saveEdit();
                          } else if (e.key === 'Escape') {
                            setEditingId(null);
                          }
                        }}
                        className="flex-1 p-1.5 bg-surface border border-[#A83D24] rounded-[6px] text-[14px] outline-none"
                      />
                      <button onClick={saveEdit} disabled={loading} className="text-green-600 hover:bg-green-50 p-1.5 rounded-[6px]">
                        <Check className="w-4 h-4" />
                      </button>
                      <button onClick={() => setEditingId(null)} className="text-ink-muted hover:bg-border p-1.5 rounded-[6px]">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className="text-[14px] font-medium text-ink-primary">{cat.name}</span>
                      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => startEdit(cat)} className="text-ink-muted hover:text-ink-primary p-1">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDelete(cat.id)} disabled={loading} className="text-ink-muted hover:text-red-600 p-1">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="p-5 border-t border-border flex justify-end">
          <button onClick={onClose} className="px-6 py-2 bg-transparent border border-[#A83D24] text-[#A83D24] hover:bg-[#A83D24]/5 font-medium rounded-[8px] transition-colors text-[14px]">
            Done
          </button>
        </div>

      </div>
    </div>
  );
}
