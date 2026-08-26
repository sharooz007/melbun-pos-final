'use client'
import React, { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { X, Pencil, Trash2, Check, Layers, Plus, Loader2 } from 'lucide-react';
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
    if (!window.confirm('Are you sure you want to delete this category? Products in this category will become Uncategorized.')) return;
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
    <div 
      className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto cursor-pointer animate-in fade-in duration-150"
      onClick={(e) => { if (e.target === e.currentTarget && !loading) onClose(); }}
    >
      <div 
        className="relative bg-surface w-full max-w-md rounded-2xl shadow-2xl flex flex-col max-h-[88vh] my-auto border border-border overflow-hidden animate-in zoom-in-95 duration-150 cursor-default"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 bg-surface border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-accent/10 rounded-xl flex items-center justify-center text-accent">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-ink-primary">Product Categories</h2>
              <p className="text-xs text-ink-muted mt-0.5">Create and manage catalog categories</p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            disabled={loading}
            className="p-2 text-ink-muted hover:text-ink-primary hover:bg-row-alt rounded-full transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1">
          {/* Add Category Form */}
          <form onSubmit={handleAdd} className="space-y-1.5">
            <label className="block text-xs font-bold text-ink-primary">Add New Category</label>
            <div className="flex gap-2">
              <input 
                type="text" 
                value={newCat} 
                onChange={e => setNewCat(e.target.value)} 
                placeholder="e.g. Shirts, Pants, Jackets"
                className="flex-1 p-2.5 bg-surface border border-border rounded-xl text-xs font-semibold focus:ring-2 focus:ring-accent focus:outline-none"
              />
              <button 
                type="submit" 
                disabled={loading || !newCat.trim()}
                className="px-4 py-2.5 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded-xl transition flex items-center gap-1 shadow-xs disabled:opacity-50"
              >
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                <span>Add</span>
              </button>
            </div>
          </form>

          {/* Categories List */}
          <div className="space-y-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-ink-muted block">
              Existing Categories ({categories.length})
            </span>

            <div className="border border-border rounded-xl divide-y divide-border overflow-hidden bg-surface">
              {categories.length === 0 ? (
                <div className="p-5 text-center text-xs text-ink-muted bg-row-alt/40">
                  No categories created yet.
                </div>
              ) : (
                categories.map(cat => (
                  <div key={cat.id} className="flex items-center justify-between p-3 bg-surface hover:bg-row-alt/50 transition-colors">
                    {editingId === cat.id ? (
                      <div className="flex items-center gap-2 flex-1">
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
                          className="flex-1 p-1.5 bg-row-alt border border-accent rounded-lg text-xs font-semibold outline-none"
                        />
                        <button 
                          type="button" 
                          onClick={saveEdit} 
                          disabled={loading} 
                          className="text-emerald-600 hover:bg-emerald-50 p-1.5 rounded-lg transition"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button 
                          type="button" 
                          onClick={() => setEditingId(null)} 
                          className="text-ink-muted hover:bg-row-alt p-1.5 rounded-lg transition"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <span className="text-xs font-bold text-ink-primary">{cat.name}</span>
                        {/* Always visible action buttons for mobile touch devices */}
                        <div className="flex items-center gap-1 shrink-0">
                          <button 
                            type="button" 
                            onClick={() => startEdit(cat)} 
                            className="text-ink-muted hover:text-accent p-1.5 hover:bg-row-alt rounded-lg transition"
                            title="Edit Category"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button 
                            type="button" 
                            onClick={() => handleDelete(cat.id)} 
                            disabled={loading} 
                            className="text-ink-muted hover:text-red-600 p-1.5 hover:bg-red-50 rounded-lg transition"
                            title="Delete Category"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-surface border-t border-border flex justify-end shrink-0">
          <button 
            type="button" 
            onClick={onClose} 
            className="px-5 py-2 bg-surface border border-border hover:bg-row-alt text-ink-primary font-bold rounded-xl transition text-xs shadow-2xs"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
