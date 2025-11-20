import React from 'react';
import { Participant } from '../types';
import { MicOffIcon, MonitorUpIcon } from './Icons';

interface VideoTileProps {
  participant: Participant;
  isLocal?: boolean;
  stream?: MediaStream | null;
}

export const VideoTile: React.FC<VideoTileProps> = ({ participant, isLocal, stream }) => {
  const videoRef = React.useRef<HTMLVideoElement>(null);

  React.useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className={`relative w-full h-full bg-gray-800 rounded-lg overflow-hidden border ${participant.isSpeaking ? 'border-green-500 border-2' : 'border-gray-700'} group`}>
      {/* Video Content */}
      {participant.role === 'ai' ? (
        <div className="w-full h-full flex items-center justify-center bg-indigo-900/30 relative">
             <div className={`absolute inset-0 bg-gradient-to-t from-indigo-900/80 to-transparent opacity-50`} />
             <div className={`w-24 h-24 rounded-full bg-gradient-to-r from-blue-400 to-purple-600 flex items-center justify-center shadow-[0_0_30px_rgba(79,70,229,0.5)] ${participant.isSpeaking ? 'animate-pulse scale-110 transition-transform' : ''}`}>
                <span className="text-3xl">✨</span>
             </div>
        </div>
      ) : !participant.isVideoOff || isLocal ? (
        isLocal && stream ? (
          <video 
            ref={videoRef} 
            autoPlay 
            muted 
            playsInline 
            className="w-full h-full object-cover transform scale-x-[-1]" // Mirror local video
          />
        ) : (
          <img 
            src={participant.avatarUrl} 
            alt={participant.name} 
            className="w-full h-full object-cover"
          />
        )
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-gray-700">
          <div className="w-20 h-20 rounded-full bg-gray-600 flex items-center justify-center text-2xl font-semibold">
            {participant.name.charAt(0)}
          </div>
        </div>
      )}

      {/* Status Overlay */}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors pointer-events-none" />

      {/* Bottom Info Bar */}
      <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
          <div className="bg-black/50 px-2 py-1 rounded text-xs flex items-center gap-2 backdrop-blur-sm max-w-[80%]">
            {participant.isMuted && <MicOffIcon className="w-3 h-3 text-red-400 shrink-0" />}
            <span className="text-white font-medium truncate">{participant.name} {isLocal && '(Вы)'}</span>
          </div>
          
          {/* Screen Share Icon Indicator */}
          {participant.isScreenSharing && (
              <div className="bg-green-600/90 p-1 rounded text-white shadow-lg">
                  <MonitorUpIcon className="w-3 h-3" />
              </div>
          )}
      </div>
    </div>
  );
};