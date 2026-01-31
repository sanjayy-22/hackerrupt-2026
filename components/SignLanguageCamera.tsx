import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Video, Square, Camera } from 'lucide-react';

interface SignLanguageCameraProps {
  onSignDetected: (text: string, imageData: string) => void;
  onProcessingChange?: (isProcessing: boolean) => void;
  language?: 'en' | 'ta';
}

const SignLanguageCamera: React.FC<SignLanguageCameraProps> = ({ onSignDetected, onProcessingChange, language = 'en' }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const diffCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const prevFrameDataRef = useRef<ImageData | null>(null);
  const captureIntervalRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [isStreaming, setIsStreaming] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [flash, setFlash] = useState(false);
  const [detectedText, setDetectedText] = useState<string>('');
  const [permissionStatus, setPermissionStatus] = useState<'idle' | 'prompt' | 'granted' | 'denied'>('idle');
  const [isRequestingCamera, setIsRequestingCamera] = useState(false);
  const [isOfflineMode, setIsOfflineMode] = useState(true);

  // Stop everything (Stream + Capture)
  const stopEverything = useCallback(() => {
    console.log('Stopping everything...');
    setIsCapturing(false);
    setIsStreaming(false);

    // clear interval
    if (captureIntervalRef.current) {
      clearInterval(captureIntervalRef.current);
      captureIntervalRef.current = null;
    }

    // stop tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    // clear video
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const requestCameraAccess = useCallback(async (): Promise<boolean> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera access is not supported in this browser.");
      setPermissionStatus('denied');
      return false;
    }

    setIsRequestingCamera(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: "user"
        },
        audio: false
      });

      streamRef.current = stream;
      setIsStreaming(true); // triggering re-render to show <video>
      setError(null);
      setPermissionStatus('granted');
      return true;
    } catch (err) {
      console.error("Error accessing camera:", err);
      setError("Camera access denied or not available. Please allow permission and try again.");
      setIsStreaming(false);
      setPermissionStatus('denied');
      return false;
    } finally {
      setIsRequestingCamera(false);
    }
  }, []);

  // Effect to attach stream to video element once it's mounted
  useEffect(() => {
    if (isStreaming && videoRef.current && streamRef.current) {
      console.log("Attaching stream to video element");
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(e => console.error("Error playing video:", e));
    }
  }, [isStreaming]);

  const captureAndProcessFrame = useCallback(async () => {
    // 1. Guard: If already processing a frame, skip this tick completely.
    if (!videoRef.current || isProcessing || !canvasRef.current) return;

    try {
      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (!video.videoWidth || !video.videoHeight) return;

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Draw current video frame to canvas
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // 2. Motion Filter: Check if frame matches previous one to avoid sending duplicates.
      let isMeaningfulChange = true;
      try {
        const diffCanvas = diffCanvasRef.current ?? document.createElement('canvas');
        diffCanvas.width = 64; // Small size for performance
        diffCanvas.height = 48;
        if (!diffCanvasRef.current) diffCanvasRef.current = diffCanvas;

        const dctx = diffCanvas.getContext('2d');
        if (dctx) {
          dctx.drawImage(video, 0, 0, diffCanvas.width, diffCanvas.height);
          const current = dctx.getImageData(0, 0, diffCanvas.width, diffCanvas.height);
          const prev = prevFrameDataRef.current;

          if (prev) {
            let changed = 0;
            const total = current.data.length / 4;
            for (let i = 0; i < current.data.length; i += 4) {
              const dr = Math.abs(current.data[i] - prev.data[i]);
              const dg = Math.abs(current.data[i + 1] - prev.data[i + 1]);
              const db = Math.abs(current.data[i + 2] - prev.data[i + 2]);
              if (dr + dg + db > 45) changed++; // Pixel logic kept similar to before
            }
            const changeRatio = changed / total;
            // Adjustable threshold: >4% pixels changed
            isMeaningfulChange = changeRatio > 0.04;
          }
          prevFrameDataRef.current = current;
        }
      } catch (motionErr) {
        console.warn('Motion check failed, proceeding with frame:', motionErr);
      }

      if (!isMeaningfulChange) {
        // Skip sending this frame, but we are effectively "done" with this tick.
        return;
      }

      // 3. Processing: Send to Local YOLO Model (Use higher resolution)
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = 640;
      tempCanvas.height = 480;
      const tempCtx = tempCanvas.getContext('2d');
      if (tempCtx) {
        tempCtx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);
      }
      const frameData = tempCanvas.toDataURL('image/jpeg', 0.8); // Slightly better quality
      const base64Data = frameData.split(',')[1];

      // Flash effect to indicate *capture*
      setFlash(true);
      setTimeout(() => setFlash(false), 150);

      setIsProcessing(true);
      onProcessingChange?.(true);

      onProcessingChange?.(true);

      // Determine mode dynamically from state
      const currentMode = isOfflineMode ? 'offline' : 'online';

      const { processSignLanguageImage } = await import('../services/signLanguage');

      try {
        const text = await processSignLanguageImage(base64Data, language, currentMode);

        // 4. Response Handling
        if (text && text.trim()) {
          setDetectedText(text);
          setError(null);
          onSignDetected(text, frameData); // Triggers TTS in parent
        }
      } catch (procErr: any) {
        console.error('Error processing frame:', procErr);
        // We do NOT show error usage to user to keep UI clean, just log it.
      } finally {
        // Only NOW strictly allow the next frame to be picked up by the interval ticks
        setIsProcessing(false);
        onProcessingChange?.(false);
      }

    } catch (err) {
      console.error('Error capturing frame:', err);
      setIsProcessing(false);
      onProcessingChange?.(false);
    }
  }, [isProcessing, language, onSignDetected, onProcessingChange, isOfflineMode]);


  // Start Capture Loop
  const startCapturing = useCallback(() => {
    if (!isStreaming) return;

    console.log('Starting continuous sign capture...');
    setIsCapturing(true);
    setDetectedText('');

    // Clear any existing
    if (captureIntervalRef.current) clearInterval(captureIntervalRef.current);

    // Initial capture immediately
    captureAndProcessFrame();

    // Capture every 5 seconds to stay within API rate limits (approx 12 requests/min)
    // Note: detailed logic ensures we skip if isProcessing is true.
    captureIntervalRef.current = window.setInterval(() => {
      captureAndProcessFrame();
    }, 5000);

  }, [isStreaming, captureAndProcessFrame]);


  // Master Toggle Function
  const toggleCameraSystem = useCallback(async () => {
    if (isStreaming) {
      // Turn OFF
      stopEverything();
    } else {
      // Turn ON
      const granted = await requestCameraAccess();
      if (granted) {
        // Automatically start capturing after a brief delay to let video warm up
        setTimeout(() => {
          // We can trigger the capture state, but we need to ensure the streaming state is reflected.
          // Using a small timeout usually works fine for UX here.
          setIsCapturing(true);
        }, 500);
      }
    }
  }, [isStreaming, requestCameraAccess, stopEverything]);

  // Effect to manage the interval based on isCapturing state changes
  // This ensures if we set setIsCapturing(true) elsewhere, it starts the loop.
  useEffect(() => {
    if (isCapturing && isStreaming) {
      if (captureIntervalRef.current) clearInterval(captureIntervalRef.current);

      // Run one immediately? Maybe not, startCapturing usually called it. 
      // But if we just toggled isCapturing from UI:
      // captureAndProcessFrame(); 

      captureIntervalRef.current = window.setInterval(captureAndProcessFrame, 5000);
    } else {
      if (captureIntervalRef.current) clearInterval(captureIntervalRef.current);
      captureIntervalRef.current = null;
    }
    return () => {
      if (captureIntervalRef.current) clearInterval(captureIntervalRef.current);
    }
  }, [isCapturing, isStreaming, captureAndProcessFrame]);


  // Clean up on unmount
  useEffect(() => {
    return () => {
      stopEverything();
    };
  }, [stopEverything]);

  // Keyboard 'B' listener
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'b' && !e.repeat) { // Ignore repeat events
        console.log("'B' Key Pressed");
        toggleCameraSystem();
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => {
      window.removeEventListener('keydown', handleKeyPress);
    };
  }, [toggleCameraSystem]);


  return (
    <div className="fixed left-6 top-24 z-50 transition-all duration-500 ease-in-out">

      {/* Main Container - Glassmorphic high-end look */}
      <div className={`
        relative backdrop-blur-xl rounded-3xl overflow-hidden border border-white/10 shadow-2xl transition-all duration-500
        ${isStreaming
          ? 'w-[420px] bg-[#0a0a0a]/90'
          : 'w-auto bg-black/40 hover:bg-black/60 cursor-pointer group'}
      `}
        onClick={!isStreaming ? toggleCameraSystem : undefined}
      >

        {/* Inactive State - Clean Button */}
        {!isStreaming && (
          <div className="flex items-center gap-4 px-5 py-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-indigo-600 to-violet-600 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform duration-300">
              <Camera size={20} className="text-white" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-bold text-white tracking-wide">Start Camera</span>
              <span className="text-[10px] text-white/50 font-medium tracking-wider uppercase">Press 'B'</span>
            </div>
          </div>
        )}

        {/* Active State - Camera Feed & Controls */}
        {isStreaming && (
          <div className="flex flex-col">

            {/* Header / Status Bar */}
            <div className="absolute top-0 left-0 right-0 z-20 flex justify-between items-center p-3 text-xs bg-gradient-to-b from-black/80 to-transparent">
              <div className="flex items-center gap-2">
                <span className={`flex h-2 w-2 rounded-full ${isCapturing ? 'bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.8)]' : 'bg-emerald-500'}`} />
                <span className="font-bold text-white/90 tracking-wider text-[10px]">
                  {isProcessing ? 'PROCESSING' : isCapturing ? 'LIVE FEED' : 'STANDBY'}
                </span>
              </div>
              <button
                onClick={toggleCameraSystem}
                className="text-white/40 hover:text-white transition-colors"
                title="Close Camera"
              >
                <div className="w-1.5 h-1.5 rounded-full bg-white/50 group-hover:bg-white" />
              </button>
            </div>

            {/* Video Feed */}
            <div className="relative aspect-[4/3] w-full bg-black/50">
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className="w-full h-full object-cover scale-x-[-1] opacity-90"
              /* Added opacity slightly to blend with dark theme */
              />

              {/* Grid Overlay for "Tech" feel */}
              <div className="absolute inset-0 pointer-events-none opacity-20"
                style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)', backgroundSize: '40px 40px' }}>
              </div>

              {/* Corner Brackets */}
              <div className="absolute top-2 left-2 w-4 h-4 border-l-2 border-t-2 border-white/30 rounded-tl-sm pointer-events-none" />
              <div className="absolute top-2 right-2 w-4 h-4 border-r-2 border-t-2 border-white/30 rounded-tr-sm pointer-events-none" />
              <div className="absolute bottom-2 left-2 w-4 h-4 border-l-2 border-b-2 border-white/30 rounded-bl-sm pointer-events-none" />
              <div className="absolute bottom-2 right-2 w-4 h-4 border-r-2 border-b-2 border-white/30 rounded-br-sm pointer-events-none" />

              {/* Flash Overlay */}
              <div className={`absolute inset-0 bg-white pointer-events-none transition-opacity duration-200 ease-out ${flash ? 'opacity-20' : 'opacity-0'}`} />

              {/* Privacy/Off Overlay */}
              {!streamRef.current && (
                <div className="absolute inset-0 flex items-center justify-center text-white/20">
                  <Video size={48} strokeWidth={1} />
                </div>
              )}
            </div>

            {/* Controls Area */}
            <div className="p-3 bg-black/40 backdrop-blur-md border-t border-white/5 space-y-2">

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={startCapturing}
                  disabled={isCapturing}
                  className={`
                    flex-1 py-2.5 rounded-xl font-semibold text-[11px] tracking-wide transition-all duration-200
                    flex items-center justify-center gap-2
                    ${isCapturing
                      ? 'bg-white/5 text-white/30 cursor-default'
                      : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-900/40 translate-y-0 active:translate-y-0.5'}
                  `}
                >
                  <div className={`w-2 h-2 rounded-full ${isCapturing ? 'bg-gray-500' : 'bg-white'}`} />
                  {isCapturing ? 'CAPTURING...' : 'START'}
                </button>

                <button
                  type="button"
                  onClick={() => setIsCapturing(false)}
                  disabled={!isCapturing}
                  className={`
                    px-4 rounded-xl transition-all duration-200 flex items-center justify-center text-white
                    ${isCapturing
                      ? 'bg-red-500/20 hover:bg-red-500/30 text-red-200 border border-red-500/30 cursor-pointer'
                      : 'bg-white/5 text-white/20 border border-transparent cursor-not-allowed'}
                  `}
                >
                  <Square size={12} fill="currentColor" />
                </button>
              </div>

              {/* Mode Toggle */}
              <button
                onClick={() => setIsOfflineMode(prev => !prev)}
                className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors group"
              >
                <span className="text-[10px] text-white/40 font-medium">MODE</span>
                <div className="flex items-center gap-1.5">
                  <span className={`text-[10px] font-bold ${isOfflineMode ? 'text-amber-400' : 'text-blue-400'}`}>
                    {isOfflineMode ? 'OFFLINE (FAST)' : 'ONLINE (ACCURATE)'}
                  </span>
                  <div className={`w-1.5 h-1.5 rounded-full ${isOfflineMode ? 'bg-amber-400' : 'bg-blue-400'}`} />
                </div>
              </button>

            </div>
          </div>
        )}
      </div>

      {/* Hidden processing canvas as before */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
};

export default SignLanguageCamera;

