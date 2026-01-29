import React, { useRef, useEffect, useState } from 'react';
import * as tf from '@tensorflow/tfjs';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import { Camera, AlertCircle, Volume2 } from 'lucide-react';

const CameraObjectDetection: React.FC = () => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [model, setModel] = useState<cocoSsd.ObjectDetection | null>(null);
    const [isCameraReady, setIsCameraReady] = useState(false);
    const [detectedObjects, setDetectedObjects] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const animationFrameRef = useRef<number>(0);
    const lastSpokenRef = useRef<{ [key: string]: number }>({});

    // Load Model
    useEffect(() => {
        const loadModel = async () => {
            try {
                // Determine backend (webgl is faster)
                await tf.setBackend('webgl');
                await tf.ready();
                const loadedModel = await cocoSsd.load();
                setModel(loadedModel);
                setIsLoading(false);
            } catch (err) {
                console.error("Failed to load COCO-SSD model", err);
                setIsLoading(false);
            }
        };
        loadModel();
    }, []);

    // Start Camera
    useEffect(() => {
        if (!isLoading && model) {
            setupCamera();
        }
        return () => {
            if (videoRef.current && videoRef.current.srcObject) {
                const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
                tracks.forEach(track => track.stop());
            }
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, [isLoading, model]);

    const setupCamera = async () => {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: 'environment' }, // Use rear camera if available
                    audio: false,
                });

                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    videoRef.current.onloadedmetadata = () => {
                        setIsCameraReady(true);
                        detectFrame();
                    };
                }
            } catch (error) {
                console.error("Camera access denied:", error);
            }
        }
    };

    const speakWarning = (text: string) => {
        const now = Date.now();
        // Don't repeat same object warning within 5 seconds
        if (lastSpokenRef.current[text] && now - lastSpokenRef.current[text] < 5000) {
            return;
        }

        lastSpokenRef.current[text] = now;

        const utterance = new SpeechSynthesisUtterance(`Caution: ${text}`);
        utterance.rate = 1.2; // Speak slightly faster
        window.speechSynthesis.speak(utterance);
    };

    const detectFrame = async () => {
        if (!videoRef.current || !model || !canvasRef.current) return;

        // Ensure video is playing and has data
        if (videoRef.current.readyState === 4) {
            const video = videoRef.current;
            const canvas = canvasRef.current;
            const context = canvas.getContext('2d');

            if (context) {
                // Match canvas size to video
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;

                // Clear previous drawings
                context.clearRect(0, 0, canvas.width, canvas.height);

                // Run detection
                const predictions = await model.detect(video);

                const currentObjects: string[] = [];

                predictions.forEach(prediction => {
                    if (prediction.score > 0.6) { // High confidence only
                        const [x, y, width, height] = prediction.bbox;
                        const label = prediction.class;

                        // Add to list for UI
                        currentObjects.push(label);

                        // Draw bounding box
                        context.strokeStyle = '#EF4444'; // Red-500
                        context.lineWidth = 4;
                        context.strokeRect(x, y, width, height);

                        // Draw Label background
                        context.fillStyle = '#EF4444';
                        const textWidth = context.measureText(label).width;
                        context.fillRect(x, y > 10 ? y - 25 : 0, textWidth + 10, 25);

                        // Draw Label text
                        context.fillStyle = '#FFFFFF';
                        context.font = '18px Arial';
                        context.fillText(label, x + 5, y > 10 ? y - 7 : 18);

                        // Prioritize dangerous objects for audio warning
                        if (['car', 'truck', 'bus', 'motorcycle', 'bicycle', 'person'].includes(label)) {
                            speakWarning(label);
                        }
                    }
                });

                // Update specific UI state (deduplicated)
                setDetectedObjects([...new Set(currentObjects)]);
            }
        }

        animationFrameRef.current = requestAnimationFrame(detectFrame);
    };

    return (
        <div className="w-full bg-black rounded-2xl overflow-hidden relative shadow-lg ring-1 ring-white/10">
            {/* Header */}
            <div className="bg-red-900/80 p-3 flex items-center justify-between backdrop-blur-sm absolute top-0 w-full z-10 border-b border-white/10">
                <div className="flex items-center gap-2 text-white">
                    <AlertCircle size={20} className="text-red-400 animate-pulse" />
                    <span className="font-semibold text-sm">Obstacle Detection Active</span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="w-2 h-2 bg-red-500 rounded-full animate-ping"></span>
                    <Camera size={16} className="text-white/70" />
                </div>
            </div>

            {/* Video Feed */}
            <div className="relative aspect-video bg-black/50">
                {isLoading && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-white/50 gap-2">
                        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                        <span className="text-xs">Loading AI Model...</span>
                    </div>
                )}

                <video
                    ref={videoRef}
                    className="w-full h-full object-cover"
                    autoPlay
                    muted
                    playsInline
                />

                <canvas
                    ref={canvasRef}
                    className="absolute inset-0 w-full h-full pointer-events-none"
                />
            </div>

            {/* Live Object List */}
            <div className="p-3 bg-zinc-900/90 border-t border-white/10 min-h-[60px]">
                {detectedObjects.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                        {detectedObjects.map((obj, i) => (
                            <span key={i} className="flex items-center gap-1 bg-red-500/20 border border-red-500/40 text-red-200 text-xs font-bold px-2 py-1 rounded-full capitalize">
                                <Volume2 size={10} />
                                {obj}
                            </span>
                        ))}
                    </div>
                ) : (
                    <p className="text-xs text-white/30 text-center italic">Path clear...</p>
                )}
            </div>
        </div>
    );
};

export default CameraObjectDetection;
