import React, { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { Mic, Activity, Power, AlertCircle, Languages, Loader2 } from 'lucide-react';

const VideoMeetLivePage: React.FC = () => {
    // We'll track the running state locally, but also poll the server to verify.
    const [runningProcess, setRunningProcess] = useState<'voice_to_sign' | 'sign_translator' | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [message, setMessage] = useState('');
    const [serverError, setServerError] = useState(false);

    // Poll status every 3 seconds
    useEffect(() => {
        let isMounted = true;

        const checkStatus = async () => {
            try {
                const response = await fetch('http://localhost:5000/status');
                if (response.ok) {
                    const data = await response.json();
                    if (isMounted) {
                        setServerError(false);
                        if (data.voice_to_sign) {
                            setRunningProcess('voice_to_sign');
                        } else if (data.sign_translator) {
                            setRunningProcess('sign_translator');
                        } else {
                            setRunningProcess(null);
                        }
                    }
                } else {
                    if (isMounted) setServerError(true);
                }
            } catch (error) {
                // If checking status fails, assume server is down
                console.error("Server poll failed", error);
                if (isMounted) setServerError(true);
            }
        };

        const interval = setInterval(checkStatus, 3000);
        checkStatus(); // Initial check

        return () => {
            isMounted = false;
            clearInterval(interval);
        };
    }, []);

    const toggleAssistant = async (target: 'voice_to_sign' | 'sign_translator') => {
        setIsLoading(true);
        setMessage('');

        // If the clicked one is already running, stop it.
        if (runningProcess === target) {
            try {
                const response = await fetch(`http://localhost:5000/stop/${target}`, { method: 'POST' });
                const data = await response.json();
                if (response.ok) {
                    setRunningProcess(null);
                    setMessage(`${target === 'voice_to_sign' ? 'Voice Assistant' : 'Translator'} stopped.`);
                } else {
                    setMessage(`Error stopping: ${data.message}`);
                }
            } catch (error) {
                setMessage('Failed to communicate with server.');
            }
        }
        // If something else is running, or nothing is running, start the target.
        // The backend handles stopping the other process if we start a new one, 
        // but we can manually handle UI state here.
        else {
            const endpoint = target === 'voice_to_sign' ? 'run-voice-to-sign' : 'run-sign-translator';
            try {
                const response = await fetch(`http://localhost:5000/${endpoint}`);
                const data = await response.json();

                if (response.ok) {
                    setRunningProcess(target);
                    setMessage(`${target === 'voice_to_sign' ? 'Voice Assistant' : 'Translator'} Active!`);
                } else {
                    setMessage(data.message || 'Failed to start.');
                }
            } catch (error) {
                setMessage('Connection failed. Ensure server is running.');
                setServerError(true);
            }
        }
        setIsLoading(false);
    };

    return (
        <Layout>
            <div className={`w-full h-full p-8 text-white flex flex-col items-center justify-center relative overflow-hidden overflow-y-auto transition-colors duration-1000 ${runningProcess ? 'bg-black/90' : ''}`}>

                {/* Dynamic Background */}
                <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none opacity-20">
                    <div className={`absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500 rounded-full blur-3xl filter mix-blend-screen transition-all duration-1000 ${runningProcess === 'voice_to_sign' ? 'scale-150 opacity-50 animate-pulse' : 'scale-100'}`}></div>
                    <div className={`absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500 rounded-full blur-3xl filter mix-blend-screen transition-all duration-1000 ${runningProcess === 'sign_translator' ? 'scale-150 opacity-50 animate-pulse' : 'scale-100'}`} style={{ animationDelay: '1s' }}></div>
                </div>

                {/* Status Bar */}
                {(message || serverError) && (
                    <div className="absolute top-8 z-50 animate-fade-in-down w-full flex justify-center">
                        <div className={`px-6 py-3 rounded-xl backdrop-blur-md border shadow-2xl flex items-center gap-3 ${serverError ? 'bg-red-500/10 border-red-500/50 text-red-200' : 'bg-white/10 border-white/20 text-white'}`}>
                            {serverError ? <AlertCircle size={22} className="text-red-400" /> : <Activity size={22} className="text-blue-400" />}
                            <span className="font-semibold text-lg">{serverError ? "Backend Connection Lost" : message}</span>
                        </div>
                    </div>
                )}

                <div className="w-full max-w-6xl grid grid-cols-1 md:grid-cols-2 gap-8 relative z-10 mt-12">

                    {/* Card 1: Voice to Sign */}
                    <div className={`
                        relative bg-white/5 backdrop-blur-xl rounded-2xl p-8 border shadow-2xl flex flex-col items-center text-center space-y-8 transition-all duration-500 group
                        ${runningProcess === 'voice_to_sign' ? 'border-cyan-400/50 bg-cyan-900/10 scale-[1.02] shadow-[0_0_50px_rgba(34,211,238,0.2)]' : 'border-white/10 hover:border-white/20 hover:bg-white/10 hover:scale-[1.01]'}
                        ${runningProcess === 'sign_translator' ? 'opacity-30 blur-[2px] pointer-events-none' : 'opacity-100'}
                    `}>
                        {runningProcess === 'voice_to_sign' && (
                            <span className="absolute top-6 right-6 flex h-4 w-4">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-4 w-4 bg-cyan-500"></span>
                            </span>
                        )}

                        <div className={`p-6 rounded-full shadow-lg transition-transform duration-500 group-hover:scale-110 ${runningProcess === 'voice_to_sign' ? 'bg-cyan-500 text-white shadow-cyan-500/50' : 'bg-white/10 text-white/80 group-hover:bg-cyan-500 group-hover:text-white'}`}>
                            <Mic size={56} />
                        </div>

                        <div className="space-y-2">
                            <h2 className={`text-4xl font-bold transition-colors ${runningProcess === 'voice_to_sign' ? 'text-cyan-300' : 'text-white'}`}>
                                Voice to Sign
                            </h2>
                            <p className="text-white/60 text-lg">
                                Real-time speech conversion
                            </p>
                        </div>

                        {/* Toggle Button */}
                        <div className="w-full pt-4">
                            <button
                                onClick={() => toggleAssistant('voice_to_sign')}
                                disabled={isLoading || (runningProcess !== null && runningProcess !== 'voice_to_sign')}
                                className={`
                                    w-full py-5 rounded-xl font-bold text-xl shadow-lg transition-all flex items-center justify-center gap-3 relative overflow-hidden
                                    ${runningProcess === 'voice_to_sign'
                                        ? 'bg-red-500 hover:bg-red-600 text-white ring-4 ring-red-500/20'
                                        : 'bg-white/10 hover:bg-cyan-600 text-white hover:shadow-cyan-500/30'}
                                    ${isLoading || (runningProcess !== null && runningProcess !== 'voice_to_sign') ? 'opacity-50 cursor-not-allowed' : ''}
                                `}
                            >
                                {isLoading && runningProcess === 'voice_to_sign' ? (
                                    <Loader2 size={24} className="animate-spin" />
                                ) : (
                                    <Power size={24} className={runningProcess === 'voice_to_sign' ? '' : 'text-cyan-300'} />
                                )}
                                <span>
                                    {runningProcess === 'voice_to_sign' ? 'STOP SESSION' : 'TURN ON'}
                                </span>
                            </button>
                        </div>
                    </div>

                    {/* Card 2: Sign Language Translator */}
                    <div className={`
                        relative bg-white/5 backdrop-blur-xl rounded-2xl p-8 border shadow-2xl flex flex-col items-center text-center space-y-8 transition-all duration-500 group
                        ${runningProcess === 'sign_translator' ? 'border-pink-400/50 bg-pink-900/10 scale-[1.02] shadow-[0_0_50px_rgba(244,114,182,0.2)]' : 'border-white/10 hover:border-white/20 hover:bg-white/10 hover:scale-[1.01]'}
                        ${runningProcess === 'voice_to_sign' ? 'opacity-30 blur-[2px] pointer-events-none' : 'opacity-100'}
                    `}>
                        {runningProcess === 'sign_translator' && (
                            <span className="absolute top-6 right-6 flex h-4 w-4">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pink-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-4 w-4 bg-pink-500"></span>
                            </span>
                        )}

                        <div className={`p-6 rounded-full shadow-lg transition-transform duration-500 group-hover:scale-110 ${runningProcess === 'sign_translator' ? 'bg-pink-500 text-white shadow-pink-500/50' : 'bg-white/10 text-white/80 group-hover:bg-pink-500 group-hover:text-white'}`}>
                            <Languages size={56} />
                        </div>

                        <div className="space-y-2">
                            <h2 className={`text-4xl font-bold transition-colors ${runningProcess === 'sign_translator' ? 'text-pink-300' : 'text-white'}`}>
                                Sign Translator
                            </h2>
                            <p className="text-white/60 text-lg">
                                Text & Voice Multi-tool
                            </p>
                        </div>

                        {/* Toggle Button */}
                        <div className="w-full pt-4">
                            <button
                                onClick={() => toggleAssistant('sign_translator')}
                                disabled={isLoading || (runningProcess !== null && runningProcess !== 'sign_translator')}
                                className={`
                                    w-full py-5 rounded-xl font-bold text-xl shadow-lg transition-all flex items-center justify-center gap-3 relative overflow-hidden
                                    ${runningProcess === 'sign_translator'
                                        ? 'bg-red-500 hover:bg-red-600 text-white ring-4 ring-red-500/20'
                                        : 'bg-white/10 hover:bg-pink-600 text-white hover:shadow-pink-500/30'}
                                    ${isLoading || (runningProcess !== null && runningProcess !== 'sign_translator') ? 'opacity-50 cursor-not-allowed' : ''}
                                `}
                            >
                                {isLoading && runningProcess === 'sign_translator' ? (
                                    <Loader2 size={24} className="animate-spin" />
                                ) : (
                                    <Power size={24} className={runningProcess === 'sign_translator' ? '' : 'text-pink-300'} />
                                )}
                                <span>
                                    {runningProcess === 'sign_translator' ? 'STOP SESSION' : 'TURN ON'}
                                </span>
                            </button>
                        </div>
                    </div>

                </div>

                <div className="mt-12 text-center text-white/40 text-sm max-w-2xl relative z-10">
                    <p>Both tools run locally for privacy.</p>

                    {serverError && (
                        <div className="bg-red-500/10 border border-red-500/30 p-6 rounded-xl mt-6 font-mono text-left animate-pulse">
                            <div className="flex items-center gap-3 mb-3">
                                <AlertCircle className="text-red-400" />
                                <p className="text-red-200 font-bold text-lg">Backend Offline</p>
                            </div>
                            <p className="text-gray-300 mb-2">The Python backend is required for these features.</p>
                            <div className="bg-black/50 p-3 rounded-lg border border-white/10">
                                <code className="text-green-400 select-all">python vivo_project/server.py</code>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </Layout>
    );
};

export default VideoMeetLivePage;
