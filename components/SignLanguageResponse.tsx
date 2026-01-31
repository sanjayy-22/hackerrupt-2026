import React from 'react';
import { Hand } from 'lucide-react';

interface SignLanguageResponseProps {
  detectedText: string;
}

const SignLanguageResponse: React.FC<SignLanguageResponseProps> = ({ detectedText }) => {
  if (!detectedText) {
    return (
      <div className="fixed right-6 top-24 z-50">
        <div className="bg-black/40 backdrop-blur-xl rounded-2xl p-6 border border-white/10 shadow-2xl w-[320px] flex flex-col items-center justify-center gap-4 transition-opacity duration-300">
          <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center">
            <Hand size={20} className="text-white/30" />
          </div>
          <div className="text-center">
            <p className="text-white/60 text-sm font-medium tracking-wide">Waiting for signs...</p>
            <p className="text-white/20 text-xs mt-1 capitalize">Camera must be active</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed right-6 top-24 z-50 animate-in slide-in-from-right-4 fade-in duration-300">
      <div className="bg-[#0a0a0a]/80 backdrop-blur-xl rounded-3xl p-1 border border-white/10 shadow-[0_0_30px_rgba(79,70,229,0.15)] w-[440px]">
        {/* Header */}
        <div className="px-4 py-3 flex items-center justify-between border-b border-white/5">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
            <h3 className="text-white text-xs font-bold tracking-wider uppercase">Detected Sign</h3>
          </div>
          <Hand size={14} className="text-indigo-400" />
        </div>

        {/* Content */}
        <div className="p-6 flex flex-col gap-3">
          <div className="bg-gradient-to-br from-indigo-900/30 to-violet-900/10 rounded-2xl p-6 border border-indigo-500/20 shadow-inner min-h-[100px] flex items-center justify-center">
            <p className="text-3xl md:text-4xl text-transparent bg-clip-text bg-gradient-to-r from-white to-indigo-200 font-bold text-center leading-tight break-words filter drop-shadow-md">
              "{detectedText}"
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-2 bg-white/2 rounded-b-2xl border-t border-white/5 flex justify-between items-center">
          <span className="text-[9px] text-white/30 font-mono tracking-widest">BRIDGE.TALK.AI</span>
          <span className="text-[9px] text-indigo-400 font-medium">Synced</span>
        </div>
      </div>
    </div>
  );
};

export default SignLanguageResponse;

