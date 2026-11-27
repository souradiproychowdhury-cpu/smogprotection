import React from 'react';
import { buildMailtoLink, buildSmsLink, buildWhatsAppLink, copyToClipboard } from '../lib/share';
import { useAppStore } from '../store/useAppStore';
import { ModalDialog } from './ModalDialog';

interface ShareModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  text: string;
}

export const ShareModal: React.FC<ShareModalProps> = ({ open, onClose, title, text }) => {
  const pushToast = useAppStore((s) => s.pushToast);
  const fullText = `${title}\n\n${text}\n\n${window.location.origin}`;

  const handleCopy = async () => {
    const ok = await copyToClipboard(fullText);
    pushToast(ok ? 'Copied to clipboard' : 'Copy failed — select text manually', ok ? 'success' : 'error');
    if (ok) onClose();
  };

  return (
    <ModalDialog open={open} onClose={onClose} title="Share Clean-Air Guidance">
      <div className="space-y-4">
        <div className="p-3 rounded-xl bg-surface-container-lowest text-body-sm text-on-surface-variant whitespace-pre-wrap max-h-40 overflow-y-auto border border-outline-variant/40">
          {fullText}
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={handleCopy}
            className="min-h-[44px] px-4 py-2.5 rounded-xl bg-gradient-to-r from-primary-container to-primary text-on-primary-container font-label-md text-label-md font-bold flex items-center justify-center gap-2"
          >
            <span className="material-symbols-outlined text-[18px]">content_copy</span>
            <span>Copy Text</span>
          </button>
          <a
            href={buildWhatsAppLink(fullText)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onClose}
            className="min-h-[44px] px-4 py-2.5 rounded-xl bg-secondary-container text-on-secondary-container font-label-md text-label-md font-bold flex items-center justify-center gap-2"
          >
            <span className="material-symbols-outlined text-[18px]">chat</span>
            <span>WhatsApp</span>
          </a>
          <a
            href={buildSmsLink(fullText)}
            onClick={onClose}
            className="min-h-[44px] px-4 py-2.5 rounded-xl bg-surface-container-high hover:bg-surface-bright text-on-surface font-label-md text-label-md font-semibold flex items-center justify-center gap-2"
          >
            <span className="material-symbols-outlined text-[18px]">sms</span>
            <span>SMS</span>
          </a>
          <a
            href={buildMailtoLink(title, fullText)}
            onClick={onClose}
            className="min-h-[44px] px-4 py-2.5 rounded-xl bg-surface-container-high hover:bg-surface-bright text-on-surface font-label-md text-label-md font-semibold flex items-center justify-center gap-2"
          >
            <span className="material-symbols-outlined text-[18px]">mail</span>
            <span>Email</span>
          </a>
        </div>
      </div>
    </ModalDialog>
  );
};
