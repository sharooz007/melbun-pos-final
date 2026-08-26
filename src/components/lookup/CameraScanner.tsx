'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Html5QrcodeScanner, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { Camera, X, CheckCircle2 } from 'lucide-react';

interface CameraScannerProps {
  onScan: (decodedText: string) => void;
  onClose: () => void;
  continuous?: boolean;
  statusMessage?: string | null;
}

export default function CameraScanner({
  onScan,
  onClose,
  continuous = false,
  statusMessage = null
}: CameraScannerProps) {
  const [lastScannedBarcode, setLastScannedBarcode] = useState<string | null>(null);
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);
  const isMountedRef = useRef<boolean>(true);
  const lastScanTimeRef = useRef<number>(0);
  const lastScannedCodeRef = useRef<string>('');

  useEffect(() => {
    isMountedRef.current = true;

    // Initialize the official Html5QrcodeScanner widget
    const scanner = new Html5QrcodeScanner(
      "reader",
      {
        fps: 15,
        qrbox: { width: 300, height: 160 },
        rememberLastUsedCamera: true,
        showTorchButtonIfSupported: true,
        showZoomSliderIfSupported: true,
        defaultZoomValueIfSupported: 2,
        formatsToSupport: [
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.CODE_93,
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
          Html5QrcodeSupportedFormats.CODABAR,
          Html5QrcodeSupportedFormats.ITF,
          Html5QrcodeSupportedFormats.QR_CODE
        ],
        experimentalFeatures: {
          useBarCodeDetectorIfSupported: true
        }
      },
      /* verbose= */ false
    );

    scannerRef.current = scanner;

    scanner.render(
      (decodedText: string) => {
        const now = Date.now();
        const isSameCode = decodedText === lastScannedCodeRef.current;
        const cooldown = isSameCode ? 1200 : 600;

        if (now - lastScanTimeRef.current < cooldown) {
          return;
        }

        lastScanTimeRef.current = now;
        lastScannedCodeRef.current = decodedText;

        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          try { navigator.vibrate(80); } catch (_) {}
        }

        if (isMountedRef.current) {
          setLastScannedBarcode(decodedText);
        }

        if (continuous) {
          if (isMountedRef.current) onScan(decodedText);
        } else {
          try {
            scanner.clear().catch(() => {}).finally(() => {
              if (isMountedRef.current) onScan(decodedText);
            });
          } catch (_) {
            if (isMountedRef.current) onScan(decodedText);
          }
        }
      },
      (_errorMessage: string) => {
        // Ignore frames where no barcode is detected
      }
    );

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        try {
          scanner.clear().then(() => onClose()).catch(() => onClose());
        } catch (_) {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      isMountedRef.current = false;
      window.removeEventListener('keydown', handleKeyDown);
      try {
        scanner.clear().catch(() => {});
      } catch (_) {}
    };
  }, [continuous, onScan, onClose]);

  const handleClose = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.clear();
      } catch (_) {}
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col justify-between animate-in fade-in duration-200 overflow-y-auto">
      {/* Top Controls Bar */}
      <div className="p-4 flex items-center justify-between text-white border-b border-white/10 shrink-0">
        <div className="flex items-center gap-2">
          <Camera className="w-5 h-5 text-red-500" />
          <span className="font-bold text-sm tracking-wide">
            {continuous ? 'CONTINUOUS POS SCANNER' : 'CAMERA BARCODE SCANNER'}
          </span>
        </div>
        
        <button 
          onClick={handleClose}
          className="p-2 bg-white/10 rounded-full hover:bg-white/20 transition-colors"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      {/* Main Viewport */}
      <div className="flex-1 flex flex-col items-center justify-center p-4 max-w-lg mx-auto w-full my-auto">
        <div className="w-full bg-white text-gray-900 rounded-2xl overflow-hidden shadow-2xl p-4">
          <div id="reader" className="w-full text-center"></div>
        </div>

        {/* Real-time Status / Haptic Badge */}
        {statusMessage ? (
          <div className="mt-4 px-4 py-2 bg-green-500/20 border border-green-500/40 text-green-300 rounded-xl text-xs font-bold flex items-center gap-2 animate-in slide-in-from-bottom duration-200">
            <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
            <span>{statusMessage}</span>
          </div>
        ) : lastScannedBarcode ? (
          <div className="mt-4 px-4 py-1.5 bg-white/10 text-gray-300 rounded-xl text-xs font-mono">
            Scanned: {lastScannedBarcode}
          </div>
        ) : null}
      </div>

      {/* Bottom Bar with Done Button */}
      <div className="p-4 bg-black/50 border-t border-white/10 flex items-center justify-center shrink-0">
        <button
          onClick={handleClose}
          className="w-full max-w-md py-3.5 bg-[#2563EB] hover:bg-[#1D4ED8] text-white font-bold rounded-xl text-sm transition shadow-lg flex items-center justify-center gap-2"
        >
          <span>{continuous ? 'Done & View Cart' : 'Close Scanner'}</span>
        </button>
      </div>

      <style jsx global>{`
        #reader {
          border: none !important;
        }
        #reader__scan_region {
          background: #000;
          border-radius: 12px;
          overflow: hidden;
        }
        #reader__dashboard_section_csr button,
        #reader__dashboard_section_swaplink,
        #reader__camera_permission_button {
          background-color: #2563eb !important;
          color: white !important;
          padding: 8px 16px !important;
          border-radius: 8px !important;
          font-weight: 600 !important;
          font-size: 13px !important;
          border: none !important;
          margin: 6px !important;
          cursor: pointer;
        }
        #reader__dashboard_section_swaplink {
          background-color: #f3f4f6 !important;
          color: #374151 !important;
        }
        #reader__camera_selection {
          padding: 6px 12px !important;
          border-radius: 8px !important;
          border: 1px solid #d1d5db !important;
          font-size: 13px !important;
          background: white !important;
          margin: 6px !important;
          max-width: 90% !important;
        }
      `}</style>
    </div>
  );
}
