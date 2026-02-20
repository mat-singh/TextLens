
import React, { useState, useRef, useEffect, useCallback, memo } from 'react';
import { extractTextFromImage } from './services/geminiService';
import { ExtractionResult, AppState } from './types';
import { Toast } from './components/Toast';
import { HistoryItem } from './components/HistoryItem';
import { Analytics } from '@vercel/analytics/react';

interface BoxRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const CameraView = memo(({ stream, error }: { stream: MediaStream | null, error: string | null }) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let mounted = true;
    if (videoRef.current && stream) {
      if (videoRef.current.srcObject !== stream) {
        videoRef.current.srcObject = stream;
      }
      
      const playVideo = async () => {
        if (!videoRef.current || !mounted) return;
        try {
          await videoRef.current.play();
        } catch (e) {
          console.warn("Auto-play was prevented or failed during resume", e);
        }
      };

      playVideo();
      window.addEventListener('focus', playVideo);
      return () => {
        mounted = false;
        window.removeEventListener('focus', playVideo);
      };
    }
  }, [stream]);

  return (
    <video 
      ref={videoRef} 
      autoPlay 
      playsInline 
      muted 
      className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${error ? 'opacity-0' : 'opacity-100'}`} 
    />
  );
});

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [history, setHistory] = useState<ExtractionResult[]>([]);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latestResult, setLatestResult] = useState<ExtractionResult | null>(null);
  
  const [boxRect, setBoxRect] = useState<BoxRect>({ top: 35, left: 7.5, width: 85, height: 30 });
  const [activeHandle, setActiveHandle] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const dragStartPos = useRef<{ x: number, y: number } | null>(null);
  const initialBox = useRef<BoxRect | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const [zoom, setZoom] = useState(1);
  const initialPinchDist = useRef<number | null>(null);
  const initialZoom = useRef<number>(1);

  // Check for API key presence to show early warning
  const [isApiKeyMissing, setIsApiKeyMissing] = useState(false);

  useEffect(() => {
    const key = process.env.API_KEY;
    if (!key || key === "undefined" || key === "") {
      setIsApiKeyMissing(true);
      setError("Gemini API Key is not configured. Please set 'API_KEY' in your environment settings.");
    } else {
      setIsApiKeyMissing(false);
    }
  }, []);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera API not supported in this browser.");
      return;
    }

    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }

      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { 
          facingMode: 'environment', 
          width: { ideal: 1920 }, 
          height: { ideal: 1080 } 
        }
      });

      newStream.getVideoTracks().forEach(track => {
        track.onended = () => {
          if (document.visibilityState === 'visible') {
            startCamera();
          }
        };
      });

      streamRef.current = newStream;
      setStream(newStream);
      
      // Only clear error if it wasn't an API key error
      const key = process.env.API_KEY;
      if (key && key !== "undefined" && key !== "") {
        setError(null);
      }
    } catch (err: any) {
      console.error("Camera Access Error:", err);
      setError("Could not access camera. Please ensure permissions are granted.");
      setAppState(AppState.ERROR);
    }
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        startCamera();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    startCamera();

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, [startCamera]);

  const applyZoom = useCallback((level: number) => {
    const track = stream?.getVideoTracks()[0];
    if (track && 'applyConstraints' in track) {
      const capabilities = (track as any).getCapabilities?.() || {};
      if (capabilities.zoom) {
        const clamped = Math.min(Math.max(level, capabilities.zoom.min), capabilities.zoom.max);
        track.applyConstraints({ advanced: [{ zoom: clamped }] } as any).catch(() => {});
        setZoom(clamped);
      }
    }
  }, [stream]);

  const handleBoxInteractionStart = (e: React.TouchEvent | React.MouseEvent, handle: string) => {
    e.stopPropagation();
    setActiveHandle(handle);
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    dragStartPos.current = { x: clientX, y: clientY };
    initialBox.current = { ...boxRect };
  };

  const handleBoxInteractionMove = useCallback((clientX: number, clientY: number) => {
    if (!activeHandle || !dragStartPos.current || !initialBox.current || !containerRef.current) return;

    const container = containerRef.current.getBoundingClientRect();
    const dx = ((clientX - dragStartPos.current.x) / container.width) * 100;
    const dy = ((clientY - dragStartPos.current.y) / container.height) * 100;

    setBoxRect(prev => {
      const next = { ...prev };
      const minSize = 10;
      if (activeHandle === 'move') {
        next.left = Math.max(0, Math.min(100 - prev.width, initialBox.current!.left + dx));
        next.top = Math.max(0, Math.min(100 - prev.height, initialBox.current!.top + dy));
      } else {
        if (activeHandle.includes('right')) next.width = Math.max(minSize, Math.min(100 - prev.left, initialBox.current!.width + dx));
        if (activeHandle.includes('left')) {
          const newWidth = Math.max(minSize, initialBox.current!.width - dx);
          const actualDx = initialBox.current!.width - newWidth;
          if (initialBox.current!.left + actualDx >= 0) {
            next.width = newWidth;
            next.left = initialBox.current!.left + actualDx;
          }
        }
        if (activeHandle.includes('bottom')) next.height = Math.max(minSize, Math.min(100 - prev.top, initialBox.current!.height + dy));
        if (activeHandle.includes('top')) {
          const newHeight = Math.max(minSize, initialBox.current!.height - dy);
          const actualDy = initialBox.current!.height - newHeight;
          if (initialBox.current!.top + actualDy >= 0) {
            next.height = newHeight;
            next.top = initialBox.current!.top + actualDy;
          }
        }
      }
      return next;
    });
  }, [activeHandle, boxRect]);

  const handleGlobalTouchMove = (e: React.TouchEvent) => {
    if (activeHandle) {
      handleBoxInteractionMove(e.touches[0].clientX, e.touches[0].clientY);
      return;
    }
    if (e.touches.length === 2) {
      const dist = Math.hypot(e.touches[0].pageX - e.touches[1].pageX, e.touches[0].pageY - e.touches[1].pageY);
      if (initialPinchDist.current === null) {
        initialPinchDist.current = dist;
        initialZoom.current = zoom;
      } else {
        applyZoom(initialZoom.current * (dist / initialPinchDist.current));
      }
    }
  };

  const captureAndExtract = async () => {
    const key = process.env.API_KEY;
    if (!key || key === "undefined" || key === "") {
      setError("Please set your Gemini API Key in the deployment settings first.");
      setIsApiKeyMissing(true);
      return;
    }

    const video = containerRef.current?.querySelector('video');
    if (!video || !canvasRef.current || appState === AppState.PROCESSING) return;

    setAppState(AppState.PROCESSING);
    setLatestResult(null);

    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    if (!context || video.videoWidth === 0) {
      setAppState(AppState.IDLE);
      return;
    }

    const sW = video.videoWidth;
    const sH = video.videoHeight;
    const dW = video.clientWidth;
    const dH = video.clientHeight;
    const sR = sW / sH;
    const dR = dW / dH;

    let vW, vH, xO, yO;
    if (sR > dR) { vH = sH; vW = sH * dR; xO = (sW - vW) / 2; yO = 0; }
    else { vW = sW; vH = sW / dR; xO = 0; yO = (sH - vH) / 2; }

    const cropX = xO + (vW * (boxRect.left / 100));
    const cropY = yO + (vH * (boxRect.top / 100));
    const cropW = vW * (boxRect.width / 100);
    const cropH = vH * (boxRect.height / 100);

    canvas.width = cropW;
    canvas.height = cropH;
    context.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
    
    try {
      const text = await extractTextFromImage(canvas.toDataURL('image/jpeg', 0.9));
      const res: ExtractionResult = { id: Date.now().toString(), timestamp: Date.now(), text, previewUrl: canvas.toDataURL('image/jpeg', 0.5) };
      setHistory(prev => [res, ...prev]);
      setLatestResult(res);
      setAppState(AppState.IDLE);
      setToastMessage("Text detected!");
    } catch (err: any) {
      setError(err.message);
      setAppState(AppState.IDLE);
    }
  };

  return (
    <div className="relative h-[100dvh] w-full bg-[#020617] flex flex-col overflow-hidden text-slate-50 font-sans">
      <header className="absolute top-0 left-0 w-full z-40 p-6 flex justify-between items-start bg-gradient-to-b from-black/80 to-transparent pointer-events-none">
        <div className="flex items-center gap-3 pointer-events-auto">
          <div className="bg-blue-600 p-2.5 rounded-xl shadow-[0_0_20px_rgba(37,99,235,0.4)]"><i className="lucide-scan-text text-white w-5 h-5 block"></i></div>
          <h1 className="text-xl font-black uppercase tracking-tighter italic">TextLens AI</h1>
        </div>
        <button onClick={() => setIsMenuOpen(true)} className="w-12 h-12 flex items-center justify-center rounded-2xl bg-slate-900/90 border border-blue-500/30 backdrop-blur-md pointer-events-auto shadow-2xl active:scale-90 transition-transform">
          <i className="lucide-menu text-blue-400 w-6 h-6"></i>
          {history.length > 0 && <span className="absolute -top-1 -right-1 h-5 min-w-[20px] bg-blue-600 rounded-full text-[10px] font-bold flex items-center justify-center border-2 border-[#020617] px-1">{history.length}</span>}
        </button>
      </header>

      <main 
        ref={containerRef}
        className="flex-1 relative bg-black overflow-hidden touch-none"
        onTouchMove={handleGlobalTouchMove}
        onTouchEnd={() => { setActiveHandle(null); initialPinchDist.current = null; }}
        onMouseMove={(e) => activeHandle && handleBoxInteractionMove(e.clientX, e.clientY)}
        onMouseUp={() => setActiveHandle(null)}
      >
        <CameraView stream={stream} error={error} />

        {(error || isApiKeyMissing) && (
          <div className="absolute inset-0 z-50 bg-[#020617]/95 backdrop-blur-xl flex flex-col items-center justify-center p-10 text-center overflow-y-auto">
            <div className={`p-8 rounded-[2rem] border max-w-sm ${isApiKeyMissing ? 'bg-amber-500/10 border-amber-500/20 shadow-[0_0_50px_rgba(245,158,11,0.1)]' : 'bg-red-500/10 border-red-500/20 shadow-[0_0_50px_rgba(239,68,68,0.1)]'}`}>
              <div className={`w-16 h-16 mb-6 mx-auto rounded-2xl flex items-center justify-center ${isApiKeyMissing ? 'bg-amber-500/20' : 'bg-red-500/20'}`}>
                <i className={`lucide-${isApiKeyMissing ? 'key' : 'alert-triangle'} w-8 h-8 ${isApiKeyMissing ? 'text-amber-500' : 'text-red-500'}`}></i>
              </div>
              <h2 className={`text-2xl font-black mb-4 tracking-tight ${isApiKeyMissing ? 'text-amber-400' : 'text-red-400'}`}>
                {isApiKeyMissing ? 'Setup Required' : 'Oops! Error'}
              </h2>
              <p className="text-slate-400 text-sm leading-relaxed mb-8">
                {error}
                {isApiKeyMissing && <span className="block mt-3 font-medium text-slate-300">Add 'API_KEY' to your environment variables and redeploy to enable OCR.</span>}
              </p>
              <div className="flex flex-col gap-3">
                <button onClick={() => { startCamera(); if (!isApiKeyMissing) setError(null); }} className="w-full py-4 bg-white text-slate-950 rounded-2xl font-black active:scale-[0.98] transition-all shadow-xl">
                  Try Again
                </button>
                <button onClick={() => window.location.reload()} className="w-full py-4 bg-slate-900 text-slate-500 rounded-2xl font-bold text-sm hover:text-slate-300 transition-colors">
                  Refresh App
                </button>
              </div>
            </div>
          </div>
        )}

        {!showHistory && !error && !isApiKeyMissing && (
          <div className="absolute inset-0 z-30 pointer-events-none">
            <div 
              className="absolute bg-transparent shadow-[0_0_0_9999px_rgba(0,0,0,0.65)] border-2 border-white/40 transition-shadow duration-75 rounded-lg"
              style={{ top: `${boxRect.top}%`, left: `${boxRect.left}%`, width: `${boxRect.width}%`, height: `${boxRect.height}%` }}
            >
              <div className="absolute inset-0 bg-blue-500/5"></div>
              {['top-left', 'top-right', 'bottom-left', 'bottom-right'].map(h => (
                <div 
                  key={h}
                  className={`absolute w-12 h-12 pointer-events-auto flex p-2 
                    ${h === 'top-left' ? '-top-4 -left-4 items-start justify-start cursor-nw-resize' : ''}
                    ${h === 'top-right' ? '-top-4 -right-4 items-start justify-end cursor-ne-resize' : ''}
                    ${h === 'bottom-left' ? '-bottom-4 -left-4 items-end justify-start cursor-sw-resize' : ''}
                    ${h === 'bottom-right' ? '-bottom-4 -right-4 items-end justify-end cursor-se-resize' : ''}
                  `}
                  onTouchStart={(e) => handleBoxInteractionStart(e, h)}
                  onMouseDown={(e) => handleBoxInteractionStart(e, h)}
                >
                  <div className={`w-6 h-6 border-blue-500 ${h.includes('top') ? 'border-t-[5px]' : 'border-b-[5px]'} ${h.includes('left') ? 'border-l-[5px]' : 'border-r-[5px]'} rounded-sm`}></div>
                </div>
              ))}
              <div 
                className="absolute inset-10 pointer-events-auto cursor-move bg-white/5 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center rounded-2xl"
                onTouchStart={(e) => handleBoxInteractionStart(e, 'move')}
                onMouseDown={(e) => handleBoxInteractionStart(e, 'move')}
              >
                <div className="bg-black/40 backdrop-blur-md p-3 rounded-full"><i className="lucide-move text-white/50 w-6 h-6"></i></div>
              </div>
            </div>
          </div>
        )}

        {latestResult && !showHistory && !error && (
          <div className="absolute bottom-36 left-6 right-6 z-40 bg-[#0f172a]/95 backdrop-blur-2xl border border-white/10 rounded-3xl p-5 shadow-[0_20px_60px_rgba(0,0,0,0.5)] flex items-center gap-5 animate-in slide-in-from-bottom-8 duration-500">
            <div className="relative group">
               <img src={latestResult.previewUrl} className="w-16 h-16 rounded-xl object-cover border border-white/10 shadow-lg" />
               <div className="absolute inset-0 bg-blue-500/20 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity"></div>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-black text-blue-400 uppercase tracking-[0.15em] mb-1">Text Captured</p>
              <p className="text-[13px] text-slate-200 line-clamp-2 leading-snug opacity-90">{latestResult.text}</p>
            </div>
            <button 
              onClick={() => { navigator.clipboard.writeText(latestResult.text); setToastMessage("Copied to Clipboard!"); }} 
              className="bg-blue-600 w-12 h-12 rounded-2xl flex items-center justify-center shadow-[0_0_20px_rgba(37,99,235,0.3)] active:scale-90 transition-transform"
            >
              <i className="lucide-copy text-white w-5 h-5"></i>
            </button>
          </div>
        )}

        {appState === AppState.PROCESSING && (
          <div className="absolute inset-0 z-50 bg-[#020617]/85 backdrop-blur-xl flex flex-col items-center justify-center">
            <div className="relative">
              <div className="w-20 h-20 border-[6px] border-blue-500/20 border-t-blue-500 rounded-full animate-spin"></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <i className="lucide-brain-circuit text-blue-500 w-8 h-8 animate-pulse"></i>
              </div>
            </div>
            <h3 className="text-2xl font-black mt-8 tracking-tight">Processing Image</h3>
            <p className="text-slate-400 text-sm mt-2 opacity-80 italic">Gemini AI is analyzing the text...</p>
          </div>
        )}
      </main>

      <canvas ref={canvasRef} className="hidden" />

      <footer className="h-40 bg-[#020617] border-t border-white/5 flex items-center justify-center relative z-20 pb-[env(safe-area-inset-bottom,0px)] px-10">
        <div className="absolute inset-0 bg-gradient-to-t from-blue-900/10 to-transparent opacity-50"></div>
        <button 
          onClick={captureAndExtract}
          disabled={appState === AppState.PROCESSING || !!error || isApiKeyMissing}
          className={`relative w-24 h-24 rounded-full flex items-center justify-center transition-all duration-300 group ${appState === AppState.PROCESSING ? 'bg-slate-900 scale-90' : 'bg-white hover:scale-110 active:scale-95 disabled:opacity-30 disabled:grayscale'}`}
        >
          {/* Shimmer effect for button */}
          {!isApiKeyMissing && appState !== AppState.PROCESSING && (
            <div className="absolute -inset-2 bg-blue-500/20 rounded-full blur-xl group-hover:bg-blue-500/40 transition-all duration-500"></div>
          )}
          <div className="w-20 h-20 rounded-full border-[3px] border-[#020617] flex items-center justify-center relative z-10">
            <i className={`lucide-scan-text w-10 h-10 ${appState === AppState.PROCESSING ? 'text-slate-600' : 'text-slate-950'}`}></i>
          </div>
        </button>
      </footer>

      {/* Side Menu Drawer */}
      <div className={`fixed inset-0 z-[100] transition-all duration-300 ${isMenuOpen ? 'visible' : 'invisible'}`}>
        <div className={`absolute inset-0 bg-black/90 transition-opacity ${isMenuOpen ? 'opacity-100' : 'opacity-0'}`} onClick={() => setIsMenuOpen(false)}></div>
        <div className={`absolute top-0 right-0 h-full w-80 bg-slate-900 border-l border-white/10 shadow-[0_0_100px_rgba(0,0,0,1)] transition-transform duration-500 ${isMenuOpen ? 'translate-x-0' : 'translate-x-full'}`}>
          <div className="p-10 flex flex-col h-full">
            <div className="flex justify-between items-center mb-12">
              <span className="text-2xl font-black italic tracking-tighter text-blue-500">SETTINGS</span>
              <button onClick={() => setIsMenuOpen(false)} className="w-10 h-10 flex items-center justify-center bg-slate-800 rounded-xl"><i className="lucide-x w-5 h-5"></i></button>
            </div>
            
            <button onClick={() => { setShowHistory(true); setIsMenuOpen(false); }} className="flex items-center gap-5 p-6 bg-slate-800/50 hover:bg-slate-800 rounded-3xl border border-white/5 transition-all active:scale-95 group">
              <div className="w-12 h-12 rounded-2xl bg-blue-600/20 flex items-center justify-center group-hover:bg-blue-600 transition-colors">
                <i className="lucide-history text-blue-400 group-hover:text-white transition-colors"></i>
              </div>
              <div className="text-left">
                <p className="font-black tracking-tight">Scan History</p>
                <p className="text-xs text-slate-500">{history.length} items captured</p>
              </div>
            </button>
            
            <div className="mt-auto pt-10 border-t border-white/5">
              <p className="text-[10px] text-slate-600 uppercase font-black tracking-widest mb-4">Device Status</p>
              <div className="flex items-center gap-3 text-sm text-slate-400">
                <div className={`w-2 h-2 rounded-full ${stream ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]' : 'bg-red-500'}`}></div>
                <span>Camera {stream ? 'Connected' : 'Disconnected'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* History View Overlay */}
      <div className={`fixed inset-0 z-[110] bg-[#020617] transition-transform duration-700 cubic-bezier(0.4, 0, 0.2, 1) ${showHistory ? 'translate-y-0' : 'translate-y-full'}`}>
        <div className="h-full flex flex-col p-8 max-w-2xl mx-auto">
          <header className="flex justify-between items-center mb-10 pt-4">
            <div>
              <h2 className="text-3xl font-black italic tracking-tighter">HISTORY</h2>
              <p className="text-slate-500 text-xs mt-1 uppercase font-bold tracking-widest">Saved scan collection</p>
            </div>
            <button onClick={() => setShowHistory(false)} className="bg-slate-900 w-14 h-14 rounded-2xl flex items-center justify-center border border-white/5 active:scale-90 transition-transform">
              <i className="lucide-chevron-down w-8 h-8 text-blue-400"></i>
            </button>
          </header>
          
          <div className="flex-1 overflow-y-auto space-y-6 pb-24 pr-2 scroll-smooth">
            {history.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center opacity-10 text-center">
                <i className="lucide-file-text w-24 h-24 mb-6"></i>
                <p className="text-2xl font-black italic">ARCHIVE EMPTY</p>
                <p className="text-sm mt-3 font-medium">Your scan records will appear here</p>
              </div>
            ) : (
              history.map(item => (
                <HistoryItem 
                  key={item.id} 
                  result={item} 
                  onCopy={(txt) => { navigator.clipboard.writeText(txt); setToastMessage("Text Copied!"); }} 
                  onDelete={(id) => setHistory(prev => prev.filter(x => x.id !== id))} 
                />
              ))
            )}
          </div>
        </div>
      </div>

      {toastMessage && <Toast message={toastMessage} onClose={() => setToastMessage(null)} />}
      <Analytics />
    </div>
  );
};

export default App;
