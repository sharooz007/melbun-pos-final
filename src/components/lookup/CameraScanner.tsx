'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { Camera, X, RefreshCw, CheckCircle2 } from 'lucide-react';

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
  const [error, setError] = useState<string | null>(null);
  const [cameras, setCameras] = useState<{ id: string; label: string }[]>([]);
  const [activeCamIndex, setActiveCamIndex] = useState<number>(0);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [lastScannedBarcode, setLastScannedBarcode] = useState<string | null>(null);
  const [isSwitching, setIsSwitching] = useState<boolean>(false);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const isStartingRef = useRef<boolean>(false);
  const isMountedRef = useRef<boolean>(true);
  const lastScanTimeRef = useRef<number>(0);
  const lastScannedCodeRef = useRef<string>('');

  const startScanner = useCallback(async (targetIndex?: number, targetFacingMode?: 'environment' | 'user') => {
    if (isStartingRef.current) return;
    setError(null);
    setIsSwitching(true);
    isStartingRef.current = true;

    try {
      if (!scannerRef.current) {
        scannerRef.current = new Html5Qrcode("reader", {
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
          },
          verbose: false
        });
      }

      const scanner = scannerRef.current;
      if (scanner.isScanning) {
        try {
          await scanner.stop();
        } catch (_) {}
        // Give mobile hardware a moment to release camera sensor
        await new Promise(res => setTimeout(res, 200));
      }

      // Discover available cameras
      let devices: { id: string; label: string }[] = [];
      try {
        const found = await Html5Qrcode.getCameras();
        if (found && found.length > 0) {
          devices = found.map(d => ({ id: d.id, label: d.label || `Camera ${d.id}` }));
          if (isMountedRef.current) setCameras(devices);
        }
      } catch (_) {}

      const activeIdx = targetIndex !== undefined ? targetIndex : activeCamIndex;
      const activeFacing = targetFacingMode !== undefined ? targetFacingMode : facingMode;

      // Select camera configuration
      let cameraConfig: any;
      if (devices.length > 1 && devices[activeIdx]) {
        cameraConfig = devices[activeIdx].id;
      } else {
        cameraConfig = { facingMode: activeFacing };
      }

      await scanner.start(
        cameraConfig,
        {
          fps: 20,
          qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
            // Dynamic rectangular scan window optimized for 1D horizontal retail barcodes
            const width = Math.floor(viewfinderWidth * 0.85);
            const height = Math.floor(viewfinderHeight * 0.55);
            return { width: Math.max(220, width), height: Math.max(120, height) };
          },
          aspectRatio: 1.0,
          videoConstraints: {
            facingMode: activeFacing,
            width: { min: 640, ideal: 1280, max: 1920 },
            height: { min: 480, ideal: 720, max: 1080 }
          }
        },
        (decodedText) => {
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
            if (scanner.isScanning) {
              scanner.stop().catch(() => {}).finally(() => {
                if (isMountedRef.current) onScan(decodedText);
              });
            } else {
              if (isMountedRef.current) onScan(decodedText);
            }
          }
        },
        () => {
          // Ignore scanning frames without barcodes
        }
      );

      // If component unmounted while start was in-flight, immediately stop
      if (!isMountedRef.current && scanner.isScanning) {
        scanner.stop().catch(() => {});
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError("Could not start camera. Please ensure camera permissions are granted.");
      }
    } finally {
      isStartingRef.current = false;
      if (isMountedRef.current) setIsSwitching(false);
    }
  }, [onScan, continuous, activeCamIndex, facingMode]);

  const handleSwitchCamera = async () => {
    if (isStartingRef.current || isSwitching) return;
    
    if (cameras.length > 1) {
      const nextIdx = (activeCamIndex + 1) % cameras.length;
      setActiveCamIndex(nextIdx);
      await startScanner(nextIdx);
    } else {
      const nextFacing = facingMode === 'environment' ? 'user' : 'environment';
      setFacingMode(nextFacing);
      await startScanner(undefined, nextFacing);
    }
  };

  useEffect(() => {
    isMountedRef.current = true;
    startScanner(0, 'environment');

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (scannerRef.current && scannerRef.current.isScanning) {
          scannerRef.current.stop().then(() => onClose()).catch(() => onClose());
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      isMountedRef.current = false;
      window.removeEventListener('keydown', handleKeyDown);
      if (scannerRef.current) {
        try {
          if (scannerRef.current.isScanning) {
            scannerRef.current.stop().catch(() => {});
          }
        } catch (_) {}
      }
    };
  }, [startScanner, onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col justify-between animate-in fade-in duration-200">
      {/* Top Controls Bar */}
      <div className="p-4 flex items-center justify-between text-white border-b border-white/10">
        <div className="flex items-center gap-2">
          <Camera className="w-5 h-5 text-red-500" />
          <span className="font-bold text-sm tracking-wide">
            {continuous ? 'CONTINUOUS POS SCANNER' : 'CAMERA BARCODE SCANNER'}
          </span>
        </div>
        
        <div className="flex items-center gap-3">
          <button
            onClick={handleSwitchCamera}
            disabled={isStartingRef.current || isSwitching}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 active:scale-95 rounded-full text-xs font-semibold tracking-wider transition-all disabled:opacity-50"
            title="Switch camera"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSwitching ? 'animate-spin' : ''}`} />
            <span>
              {cameras.length > 1
                ? `Camera ${activeCamIndex + 1}/${cameras.length}`
                : facingMode === 'environment' ? 'Switch to Front' : 'Switch to Back'}
            </span>
          </button>

          <button 
            onClick={async () => {
              if (scannerRef.current && scannerRef.current.isScanning) {
                try {
                  await scannerRef.current.stop();
                } catch (e) {
                  // ignore
                }
              }
              onClose();
            }}
            className="p-2 bg-white/10 rounded-full hover:bg-white/20 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* Main Viewport */}
      <div className="flex-1 flex flex-col items-center justify-center p-4 max-w-md mx-auto w-full">
        <div className="w-full aspect-[4/3] sm:aspect-[16/9] relative bg-black rounded-2xl overflow-hidden shadow-2xl ring-4 ring-white/10">
          <div id="reader" className="w-full h-full"></div>
          
          {/* Overlay scanning guides */}
          <div className="absolute inset-0 pointer-events-none border-[20px] sm:border-[24px] border-black/50" />
          <div className="absolute inset-0 pointer-events-none border-2 border-red-500 m-[20px] sm:m-[24px] rounded-lg" />
          
          {/* Scanning line animation */}
          <div className="absolute top-[20px] sm:top-[24px] left-[20px] sm:left-[24px] right-[20px] sm:right-[24px] h-0.5 bg-red-500 animate-[scan_2s_ease-in-out_infinite] shadow-[0_0_8px_2px_rgba(239,68,68,0.5)]" />
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
        ) : (
          <div className="mt-4 text-gray-400 text-xs text-center">
            Align barcode inside the red box to scan
          </div>
        )}
      </div>

      {/* Bottom Bar with Done Button for Continuous Mode */}
      <div className="p-4 bg-black/50 border-t border-white/10 flex items-center justify-center">
        <button
          onClick={async () => {
            if (scannerRef.current && scannerRef.current.isScanning) {
              try {
                await scannerRef.current.stop();
              } catch (e) {}
            }
            onClose();
          }}
          className="w-full max-w-md py-3.5 bg-[#2563EB] hover:bg-[#1D4ED8] text-white font-bold rounded-xl text-sm transition shadow-lg flex items-center justify-center gap-2"
        >
          <span>Done &amp; View Cart</span>
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-900/50 text-red-200 text-center text-sm border-t border-red-900 flex flex-col sm:flex-row items-center justify-center gap-2">
          <span>{error}</span>
          <button 
            onClick={() => startScanner()}
            className="px-3 py-1 bg-red-700 hover:bg-red-600 text-white rounded-lg text-xs font-bold transition-colors"
          >
            Retry Permissions
          </button>
        </div>
      )}
    </div>
  );
}
