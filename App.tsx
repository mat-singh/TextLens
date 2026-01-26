
import React, { useState, useRef, useEffect, useCallback, memo } from 'react';
import { extractTextFromImage } from './services/geminiService';
import { ExtractionResult, AppState } from './types';
import { Toast } from './components/Toast';
import { HistoryItem } from './components/HistoryItem';

interface BoxRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

// 1. Memoized Video Component with resilient play logic
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

      // Listen for window focus to ensure video resumes playing if browser paused it
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
  
  // Framing Box State
  const [boxRect, setBoxRect] = useState<BoxRect>({ top: 35, left: 7.5, width: 85, height: 30 });
  const [activeHandle, setActiveHandle] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);

  // Use a ref for the stream to handle cleanup without triggering re-renders in callbacks
  const streamRef = useRef<MediaStream | null>(null);
  const dragStartPos = useRef<{ x: number, y: number } | null>(null);
  const initialBox = useRef<BoxRect | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Zoom logic
  const [zoom, setZoom] = useState(1);
  const initialPinchDist = useRef<number | null>(null);
  const initialZoom = useRef<number>(1);

  // 2. Optimized Camera Start (No stream dependency to avoid infinite loops)
  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera API not supported.");
      return;
    }

    try {
      setError(null);
      
      // Stop old tracks first
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

      // Handle cases where the track might end unexpectedly
      newStream.getVideoTracks().forEach(track => {
        track.onended = () => {
          // Only restart if the tab is still visible
          if (document.visibilityState === 'visible') {
            console.log("Track ended unexpectedly, restarting...");
            startCamera();
          }
        };
      });

      streamRef.current = newStream;
      setStream(newStream);
    } catch (err: any) {
      console.error("Camera access failed:", err);
      setError("Could not access camera. Check permissions or close other apps using the camera.");
      setAppState(AppState.ERROR);
    }
  }, []);

  // 3. Lifecycle Management for Mobile Resume
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log("App returned to foreground, refreshing camera...");
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
  }, [activeHandle]);

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
    <div className="relative h-[100dvh] w-full bg-slate-950 flex flex-col overflow-hidden text-slate-50">
      <header className="absolute top-0 left-0 w-full z-40 p-5 flex justify-between items-start bg-gradient-to-b from-black/80 to-transparent pointer-events-none">
        <div className="flex items-center gap-3 pointer-events-auto">
          <div className="bg-blue-600 p-2 rounded-xl shadow-lg"><i className="lucide-scan-text text-white w-5 h-5 block"></i></div>
          <h1 className="text-xl font-black uppercase tracking-tighter">TextLens</h1>
        </div>
        <button onClick={() => setIsMenuOpen(true)} className="w-12 h-12 flex items-center justify-center rounded-full bg-slate-900/90 border border-blue-500/30 backdrop-blur-md pointer-events-auto shadow-xl">
          <i className="lucide-menu text-blue-400 w-6 h-6"></i>
          {history.length > 0 && <span className="absolute -top-1 -right-1 h-5 min-w-[20px] bg-blue-600 rounded-full text-[10px] font-bold flex items-center justify-center border-2 border-slate-950">{history.length}</span>}
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

        {error && (
          <div className="absolute inset-0 z-50 bg-slate-950/90 backdrop-blur-sm flex flex-col items-center justify-center p-10 text-center">
            <i className="lucide-alert-circle w-12 h-12 text-red-500 mb-4"></i>
            <h2 className="text-xl font-bold mb-2">Camera Error</h2>
            <p className="text-slate-400 text-sm mb-6">{error}</p>
            <button onClick={() => startCamera()} className="px-10 py-3 bg-blue-600 rounded-full font-bold">Retry</button>
          </div>
        )}

        {/* Framing Box UI */}
        {!showHistory && !error && (
          <div className="absolute inset-0 z-30 pointer-events-none">
            <div 
              className="absolute bg-transparent shadow-[0_0_0_9999px_rgba(0,0,0,0.6)] border border-white/30 transition-shadow duration-75"
              style={{ top: `${boxRect.top}%`, left: `${boxRect.left}%`, width: `${boxRect.width}%`, height: `${boxRect.height}%` }}
            >
              {/* Handles */}
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
                  <div className={`w-6 h-6 border-blue-500 ${h.includes('top') ? 'border-t-4' : 'border-b-4'} ${h.includes('left') ? 'border-l-4' : 'border-r-4'} rounded-sm`}></div>
                </div>
              ))}
              {/* Drag Area */}
              <div 
                className="absolute inset-8 pointer-events-auto cursor-move bg-white/5 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center rounded-lg"
                onTouchStart={(e) => handleBoxInteractionStart(e, 'move')}
                onMouseDown={(e) => handleBoxInteractionStart(e, 'move')}
              >
                <i className="lucide-move text-white/20 w-8 h-8"></i>
              </div>
            </div>
          </div>
        )}

        {/* Latest Result Card */}
        {latestResult && !showHistory && (
          <div className="absolute bottom-36 left-4 right-4 z-40 bg-slate-900/90 backdrop-blur-xl border border-white/10 rounded-2xl p-4 shadow-2xl flex items-center gap-4 animate-in slide-in-from-bottom-5">
            <img src={latestResult.previewUrl} className="w-14 h-14 rounded-lg object-cover border border-white/5" />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Captured</p>
              <p className="text-sm text-white line-clamp-1 opacity-80">{latestResult.text}</p>
            </div>
            <button onClick={() => { navigator.clipboard.writeText(latestResult.text); setToastMessage("Copied!"); }} className="bg-blue-600 p-3 rounded-xl active:scale-90 transition-transform">
              <i className="lucide-copy text-white w-5 h-5"></i>
            </button>
          </div>
        )}

        {/* Processing Indicator */}
        {appState === AppState.PROCESSING && (
          <div className="absolute inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex flex-col items-center justify-center">
            <div className="w-16 h-16 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin mb-6"></div>
            <h3 className="text-xl font-bold">Analyzing Frame</h3>
            <p className="text-slate-400 text-sm animate-pulse">Reading text with Gemini AI...</p>
          </div>
        )}
      </main>

      <canvas ref={canvasRef} className="hidden" />

      <footer className="h-32 bg-slate-950 border-t border-white/5 flex items-center justify-center relative z-20 pb-[env(safe-area-inset-bottom,0px)]">
        <button 
          onClick={captureAndExtract}
          disabled={appState === AppState.PROCESSING || !!error}
          className={`w-20 h-20 rounded-full flex items-center justify-center transition-all ${appState === AppState.PROCESSING ? 'bg-slate-800 scale-90' : 'bg-white hover:scale-110 active:scale-95'}`}
        >
          <div className="w-16 h-16 rounded-full border-2 border-slate-950 flex items-center justify-center">
            <i className={`lucide-scan w-8 h-8 ${appState === AppState.PROCESSING ? 'text-slate-600' : 'text-slate-950'}`}></i>
          </div>
        </button>
      </footer>

      {/* Menu Drawer */}
      <div className={`fixed inset-0 z-[100] transition-all duration-300 ${isMenuOpen ? 'visible' : 'invisible'}`}>
        <div className={`absolute inset-0 bg-black/80 transition-opacity ${isMenuOpen ? 'opacity-100' : 'opacity-0'}`} onClick={() => setIsMenuOpen(false)}></div>
        <div className={`absolute top-0 right-0 h-full w-72 bg-slate-900 border-l border-white/5 shadow-2xl transition-transform ${isMenuOpen ? 'translate-x-0' : 'translate-x-full'}`}>
          <div className="p-8 flex flex-col h-full">
            <div className="flex justify-between items-center mb-8">
              <span className="text-xl font-black italic">TEXTLENS</span>
              <button onClick={() => setIsMenuOpen(false)}><i className="lucide-x w-6 h-6"></i></button>
            </div>
            <button onClick={() => { setShowHistory(true); setIsMenuOpen(false); }} className="flex items-center gap-4 p-4 bg-slate-800 rounded-2xl">
              <i className="lucide-history text-blue-400"></i>
              <div className="text-left"><p className="font-bold">Scan History</p><p className="text-xs text-slate-500">{history.length} items</p></div>
            </button>
          </div>
        </div>
      </div>

      {/* History Panel */}
      <div className={`fixed inset-0 z-[110] bg-slate-950 transition-transform duration-500 ${showHistory ? 'translate-y-0' : 'translate-y-full'}`}>
        <div className="h-full flex flex-col p-6">
          <header className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-black">HISTORY</h2>
            <button onClick={() => setShowHistory(false)} className="bg-slate-900 p-2 rounded-full"><i className="lucide-chevron-down w-8 h-8"></i></button>
          </header>
          <div className="flex-1 overflow-y-auto space-y-4 pb-20">
            {history.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center opacity-20"><i className="lucide-file-text w-16 h-16 mb-4"></i><p>No scans yet</p></div>
            ) : (
              history.map(item => <HistoryItem key={item.id} result={item} onCopy={() => { navigator.clipboard.writeText(item.text); setToastMessage("Copied!"); }} onDelete={(id) => setHistory(prev => prev.filter(x => x.id !== id))} />)
            )}
          </div>
        </div>
      </div>

      {toastMessage && <Toast message={toastMessage} onClose={() => setToastMessage(null)} />}
    </div>
  );
};

export default App;
