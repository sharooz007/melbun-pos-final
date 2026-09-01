'use client';

import React, { useState, useEffect } from 'react';
import { MessageSquare, X, Send, Copy, Check, Phone } from 'lucide-react';
import { cleanWhatsAppPhone, openWhatsAppChat } from '@/lib/whatsapp';
import toast from 'react-hot-toast';

interface WhatsAppPromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  defaultPhone?: string | null;
  message: string;
  customerName?: string | null;
}

export function WhatsAppPromptModal({
  isOpen,
  onClose,
  title = 'Send WhatsApp Message',
  defaultPhone = '',
  message,
  customerName
}: WhatsAppPromptModalProps) {
  const [phoneNumber, setPhoneNumber] = useState(defaultPhone || '');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setPhoneNumber(defaultPhone || '');
    }
  }, [isOpen, defaultPhone]);

  if (!isOpen) return null;

  const handleSend = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = cleanWhatsAppPhone(phoneNumber);
    if (phoneNumber.trim() && !clean) {
      toast.error('Please enter a valid phone number (at least 10 digits).');
      return;
    }
    openWhatsAppChat({ phone: clean, message });
    onClose();
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(message);
    setCopied(true);
    toast.success('Message copied to clipboard!');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div 
      className="fixed inset-0 z-[250] flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto cursor-pointer animate-in fade-in duration-150"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div 
        className="bg-surface rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-2xl border border-border space-y-4 cursor-default animate-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-50 text-emerald-700 rounded-xl">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-ink-primary">{title}</h3>
              {customerName && (
                <p className="text-xs text-ink-muted truncate max-w-[220px]">
                  Recipient: {customerName}
                </p>
              )}
            </div>
          </div>
          <button 
            type="button"
            onClick={onClose}
            className="p-1.5 text-ink-muted hover:text-ink-primary hover:bg-row-alt rounded-full transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSend} className="space-y-3.5">
          <div>
            <label className="block text-xs font-bold text-ink-primary mb-1 flex items-center gap-1">
              <Phone className="w-3.5 h-3.5 text-ink-muted" />
              Recipient WhatsApp Number
            </label>
            <div className="relative flex items-center">
              <span className="absolute left-3 font-mono text-xs font-bold text-ink-muted select-none">
                +91
              </span>
              <input
                type="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="10-digit mobile number"
                autoFocus
                className="w-full pl-12 pr-3.5 py-2.5 bg-row-alt border border-border rounded-xl text-xs sm:text-sm font-mono font-bold text-ink-primary focus:ring-2 focus:ring-accent focus:bg-surface outline-none transition"
              />
            </div>
            <p className="text-[10px] text-ink-muted mt-1">
              Leave blank to select contact manually inside WhatsApp.
            </p>
          </div>

          {/* Message Preview */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] font-bold text-ink-muted uppercase tracking-wider">
                Message Preview
              </label>
              <button
                type="button"
                onClick={handleCopy}
                className="text-[11px] font-bold text-accent hover:underline flex items-center gap-1 cursor-pointer"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                <span>{copied ? 'Copied' : 'Copy Text'}</span>
              </button>
            </div>
            <div className="p-3 bg-row-alt rounded-xl border border-border text-xs font-sans text-ink-primary max-h-36 overflow-y-auto whitespace-pre-wrap leading-relaxed select-text">
              {message}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 text-xs font-bold text-ink-muted hover:bg-row-alt rounded-xl transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 bg-[#25D366] hover:bg-[#20ba59] text-white text-xs font-bold rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Open in WhatsApp</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
