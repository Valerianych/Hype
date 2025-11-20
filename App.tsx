import React, { useState, useEffect, useRef } from 'react';
import { MOCK_PARTICIPANTS, AI_PARTICIPANT } from './constants';
import { Participant, ViewMode } from './types';
import { VideoTile } from './components/VideoTile';
import { 
  MicIcon, MicOffIcon, VideoIcon, VideoOffIcon, 
  ScreenShareIcon, UsersIcon, MessageSquareIcon, 
  PhoneOffIcon, SparklesIcon, LinkIcon, TrashIcon,
  ShieldIcon, MonitorUpIcon
} from './components/Icons';
import { LiveClient } from './services/liveClient';

export default function App() {
  // --- State ---
  const [step, setStep] = useState<'name' | 'lobby' | 'meeting'>('name');
  const [userName, setUserName] = useState('');
  const [meetingId, setMeetingId] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.GALLERY);
  
  // Participants
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [activeScreenId, setActiveScreenId] = useState<string | null>(null);

  // Local Media
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  
  // UI
  const [showSidebar, setShowSidebar] = useState<'chat' | 'participants' | null>(null);
  
  // --- Refs & Services ---
  const liveClient = useRef<LiveClient | null>(null);

  // --- Effects ---
  
  useEffect(() => {
    // Parse meeting ID from URL or generate new
    const params = new URLSearchParams(window.location.search);
    const mid = params.get('meetingId') || Math.random().toString(36).substring(7);
    setMeetingId(mid);

    // Initialize Live Client
    liveClient.current = new LiveClient();
    liveClient.current.onSpeakingStateChange = (speaking) => {
      setParticipants(prev => prev.map(p => 
        p.id === 'gemini-ai' ? { ...p, isSpeaking: speaking } : p
      ));
    };

    return () => {
      if (liveClient.current) liveClient.current.disconnect();
      if (localStream) localStream.getTracks().forEach(t => t.stop());
      if (screenStream) screenStream.getTracks().forEach(t => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle name submission
  const handleJoinStep = () => {
    if (!userName.trim()) return alert("Пожалуйста, введите ФИО");
    
    // Init participants with Local User + Mock data
    const localUser: Participant = {
      id: 'local',
      name: userName, // Use entered name
      avatarUrl: '',
      isMuted: false,
      isVideoOff: false,
      isSpeaking: false,
      role: 'host', // User creating/joining is host for this demo
    };
    
    setParticipants([AI_PARTICIPANT, localUser, ...MOCK_PARTICIPANTS]);
    setStep('lobby');
  };

  // --- Meeting Handlers ---

  const startMeeting = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setLocalStream(stream);
      setStep('meeting');
    } catch (err) {
      alert("Для работы конференции требуется доступ к камере и микрофону.");
      console.error(err);
    }
  };

  const leaveMeeting = () => {
    setStep('lobby');
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    if (screenStream) screenStream.getTracks().forEach(t => t.stop());
    setLocalStream(null);
    setScreenStream(null);
    setViewMode(ViewMode.GALLERY);
    setActiveScreenId(null);
    if (liveClient.current) liveClient.current.disconnect();
  };

  const toggleMute = () => {
    if (localStream) {
      localStream.getAudioTracks().forEach(track => track.enabled = !isMuted);
      setIsMuted(!isMuted);
      setParticipants(prev => prev.map(p => p.id === 'local' ? {...p, isMuted: !isMuted} : p));
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      localStream.getVideoTracks().forEach(track => track.enabled = !isVideoOff);
      setIsVideoOff(!isVideoOff);
      setParticipants(prev => prev.map(p => p.id === 'local' ? {...p, isVideoOff: !isVideoOff} : p));
    }
  };

  const toggleScreenShare = async () => {
    // If local user is currently sharing, stop it
    if (activeScreenId === 'local') {
      screenStream?.getTracks().forEach(t => t.stop());
      setScreenStream(null);
      setActiveScreenId(null);
      setViewMode(ViewMode.GALLERY);
      
      setParticipants(prev => prev.map(p => p.id === 'local' ? {...p, isScreenSharing: false} : p));
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      setScreenStream(stream);
      setActiveScreenId('local'); // Focus local screen
      setViewMode(ViewMode.SCREEN_SHARE);
      
      setParticipants(prev => prev.map(p => p.id === 'local' ? {...p, isScreenSharing: true} : p));
      
      // Handle user stopping sharing via browser UI
      stream.getVideoTracks()[0].onended = () => {
        setScreenStream(null);
        if (activeScreenId === 'local') {
           setActiveScreenId(null);
           setViewMode(ViewMode.GALLERY);
        }
        setParticipants(prev => prev.map(p => p.id === 'local' ? {...p, isScreenSharing: false} : p));
      };
    } catch (err) {
      console.error("Screen share cancelled or failed", err);
    }
  };

  const toggleAiAssistant = async () => {
    const aiPart = participants.find(p => p.role === 'ai');
    if (aiPart?.isSpeaking) {
       liveClient.current?.disconnect();
    } else {
       await liveClient.current?.connect();
    }
  };

  const handleShareInvite = () => {
    const url = `${window.location.origin}?meetingId=${meetingId}`;
    navigator.clipboard.writeText(url);
    alert(`Ссылка скопирована: ${url}`);
  };

  // --- Host Controls ---

  const muteAll = () => {
    // Mute everyone except Host (local) and AI
    setParticipants(prev => prev.map(p => {
      if (p.role === 'host' || p.role === 'ai') return p;
      return { ...p, isMuted: true };
    }));
  };

  const muteParticipant = (id: string) => {
    setParticipants(prev => prev.map(p => p.id === id ? { ...p, isMuted: !p.isMuted } : p));
  };

  const kickParticipant = (id: string) => {
    if(confirm("Вы уверены, что хотите удалить этого участника?")) {
      setParticipants(prev => prev.filter(p => p.id !== id));
    }
  };

  const focusScreen = (participantId: string) => {
     setActiveScreenId(participantId);
     setViewMode(ViewMode.SCREEN_SHARE);
  };

  // --- Render Layouts ---

  const renderJoinScreen = () => (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white p-4">
       <div className="bg-gray-800 p-8 rounded-2xl shadow-2xl max-w-md w-full border border-gray-700">
          <div className="flex justify-center mb-6">
             <div className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center">
               <SparklesIcon className="w-8 h-8 text-white" />
             </div>
          </div>
          <h1 className="text-2xl font-bold text-center mb-2">Присоединиться к встрече</h1>
          <p className="text-center text-gray-400 mb-6">ID: {meetingId}</p>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Ваше ФИО</label>
              <input 
                type="text" 
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder="Иванов Иван Иванович"
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <button 
              onClick={handleJoinStep}
              className="w-full bg-blue-600 hover:bg-blue-500 py-3 rounded-lg font-bold transition-colors"
            >
              Продолжить
            </button>
          </div>
       </div>
    </div>
  );

  const renderLobby = () => (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-black text-white p-6">
      <div className="max-w-3xl w-full text-center space-y-8">
        <div className="space-y-4">
          <h1 className="text-6xl font-bold tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-500">
            GigaConference
          </h1>
          <p className="text-xl text-gray-400">
             Привет, {userName}! Готовы начать конференцию?
          </p>
        </div>

        <div className="flex justify-center gap-6 mt-12">
           <div className="p-6 rounded-2xl bg-gray-800/50 border border-gray-700 backdrop-blur-sm w-64">
              <UsersIcon className="w-10 h-10 text-blue-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold">Панель Организатора</h3>
              <p className="text-sm text-gray-400 mt-2">Полный контроль над участниками.</p>
           </div>
           <div className="p-6 rounded-2xl bg-gray-800/50 border border-gray-700 backdrop-blur-sm w-64">
              <MonitorUpIcon className="w-10 h-10 text-purple-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold">Мульти-демонстрация</h3>
              <p className="text-sm text-gray-400 mt-2">Несколько экранов одновременно.</p>
           </div>
        </div>

        <button 
          onClick={startMeeting}
          className="px-8 py-4 bg-blue-600 hover:bg-blue-500 rounded-full font-bold text-lg shadow-[0_0_40px_rgba(37,99,235,0.5)] transition-all transform hover:scale-105"
        >
          Войти в конференцию
        </button>
      </div>
    </div>
  );

  const renderScreenShareSelector = () => {
    const sharers = participants.filter(p => p.isScreenSharing);
    if (sharers.length === 0) return null;

    return (
       <div className="h-24 bg-gray-900/90 border-b border-gray-700 flex items-center px-4 gap-4 overflow-x-auto shrink-0">
          <span className="text-xs font-bold text-gray-400 uppercase tracking-wider shrink-0">Демонстрации:</span>
          {sharers.map(p => (
            <button
              key={p.id}
              onClick={() => focusScreen(p.id)}
              className={`flex flex-col items-center gap-2 min-w-[120px] p-2 rounded-lg border transition-all ${activeScreenId === p.id ? 'border-blue-500 bg-blue-900/30' : 'border-gray-700 hover:bg-gray-800'}`}
            >
               <div className="w-8 h-5 rounded bg-gray-600 flex items-center justify-center">
                  <MonitorUpIcon className="w-3 h-3 text-white" />
               </div>
               <span className="text-xs truncate max-w-full">{p.id === 'local' ? 'Ваш экран' : p.name}</span>
            </button>
          ))}
          <button 
            onClick={() => { setViewMode(ViewMode.GALLERY); setActiveScreenId(null); }}
            className="ml-auto text-xs text-blue-400 hover:underline whitespace-nowrap"
          >
            Вернуться к сетке
          </button>
       </div>
    );
  };

  const renderGrid = () => {
    // Screen Share Mode
    if (viewMode === ViewMode.SCREEN_SHARE && activeScreenId) {
      const sharer = participants.find(p => p.id === activeScreenId);
      
      return (
        <div className="flex flex-col h-full w-full">
           {renderScreenShareSelector()}
           
           <div className="flex-1 flex p-4 gap-4 overflow-hidden">
              {/* Main Stage */}
              <div className="flex-1 bg-black rounded-2xl overflow-hidden relative border border-gray-800 flex items-center justify-center">
                 {activeScreenId === 'local' && screenStream ? (
                    <video 
                      ref={ref => ref && (ref.srcObject = screenStream)} 
                      autoPlay 
                      playsInline 
                      className="w-full h-full object-contain"
                    />
                 ) : (
                    // Mock for remote screen share
                    <div className="flex flex-col items-center text-gray-500">
                       <MonitorUpIcon className="w-24 h-24 mb-4 opacity-20 animate-pulse" />
                       <p className="text-xl font-semibold">Демонстрация экрана: {sharer?.name}</p>
                       <p className="text-sm">(Симуляция контента)</p>
                    </div>
                 )}
                 
                 <div className="absolute top-4 left-4 bg-blue-600/90 px-3 py-1 rounded text-sm font-bold backdrop-blur-md shadow-lg">
                   {activeScreenId === 'local' ? 'Вы демонстрируете экран' : `Экран: ${sharer?.name}`}
                 </div>
              </div>
              
              {/* Sidebar strip */}
              <div className="w-56 flex flex-col gap-2 overflow-y-auto pr-2 hidden md:flex">
                 {participants.map(p => (
                    <div key={p.id} className="h-32 shrink-0">
                      <VideoTile 
                        participant={p} 
                        isLocal={p.id === 'local'} 
                        stream={p.id === 'local' ? localStream : undefined} 
                      />
                    </div>
                 ))}
              </div>
           </div>
        </div>
      );
    }

    // Gallery View
    return (
      <div className="flex flex-col h-full w-full">
         {/* Show screen share notifications if any, allowing to switch */}
         {participants.some(p => p.isScreenSharing) && (
             <div className="bg-indigo-900/50 border-b border-indigo-700/50 px-4 py-2 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-indigo-200">
                   <MonitorUpIcon className="w-4 h-4" />
                   <span>Есть активные демонстрации экрана ({participants.filter(p => p.isScreenSharing).length})</span>
                </div>
                <button 
                  onClick={() => focusScreen(participants.find(p => p.isScreenSharing)!.id)}
                  className="text-xs bg-indigo-600 hover:bg-indigo-500 px-3 py-1 rounded text-white transition-colors"
                >
                  Смотреть
                </button>
             </div>
         )}
         
         <div className="h-full w-full p-4 overflow-y-auto">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 auto-rows-fr">
             {participants.map(p => (
               <div key={p.id} className="aspect-video">
                  <VideoTile 
                    participant={p} 
                    isLocal={p.id === 'local'}
                    stream={p.id === 'local' ? localStream : undefined}
                  />
               </div>
             ))}
          </div>
        </div>
      </div>
    );
  };

  const renderSidebar = () => (
     <div className="w-80 bg-gray-800 border-l border-gray-700 flex flex-col shadow-2xl z-20 animate-in slide-in-from-right h-full absolute right-0 top-0">
       <div className="p-4 border-b border-gray-700 flex justify-between items-center bg-gray-800">
          <h2 className="font-bold">{showSidebar === 'chat' ? 'Чат встречи' : `Участники (${participants.length})`}</h2>
          <button onClick={() => setShowSidebar(null)} className="text-gray-400 hover:text-white">✕</button>
       </div>
       
       <div className="flex-1 overflow-y-auto">
          {showSidebar === 'participants' ? (
            <div className="p-4 space-y-4">
               {/* Host Controls */}
               <div className="bg-gray-900/50 p-3 rounded-lg border border-gray-700 mb-4">
                  <div className="flex items-center gap-2 mb-3 text-gray-300 text-xs font-semibold uppercase tracking-wider">
                     <ShieldIcon className="w-4 h-4 text-blue-500" />
                     Панель Организатора
                  </div>
                  <div className="flex gap-2">
                     <button 
                       onClick={muteAll}
                       className="flex-1 bg-red-900/30 hover:bg-red-900/50 text-red-400 border border-red-900/50 text-xs py-2 rounded flex items-center justify-center gap-2 transition-colors"
                     >
                        <MicOffIcon className="w-3 h-3" />
                        Выкл. всем звук
                     </button>
                     <button 
                       onClick={handleShareInvite}
                       className="flex-1 bg-blue-900/30 hover:bg-blue-900/50 text-blue-400 border border-blue-900/50 text-xs py-2 rounded flex items-center justify-center gap-2 transition-colors"
                     >
                        <LinkIcon className="w-3 h-3" />
                        Пригласить
                     </button>
                  </div>
               </div>

               <div className="space-y-2">
                 {participants.map(p => (
                   <div key={p.id} className="flex items-center justify-between group p-2 hover:bg-gray-700/50 rounded-lg transition-colors">
                      <div className="flex items-center gap-3 overflow-hidden">
                        {p.role === 'ai' ? (
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-xs">AI</div>
                        ) : p.id === 'local' ? (
                            <div className="w-8 h-8 bg-gray-600 rounded-full flex items-center justify-center text-xs font-bold">Вы</div>
                        ) : (
                            <img src={p.avatarUrl} className="w-8 h-8 rounded-full" alt="" />
                        )}
                        <div className="flex flex-col truncate">
                            <span className="text-sm truncate font-medium">
                                {p.name} 
                                {p.role === 'host' && <span className="ml-2 text-[10px] bg-yellow-600/50 text-yellow-200 px-1 rounded">HOST</span>}
                            </span>
                            {p.isScreenSharing && <span className="text-[10px] text-green-400 flex items-center gap-1"><MonitorUpIcon className="w-3 h-3"/> Транслирует экран</span>}
                        </div>
                      </div>

                      {/* Controls */}
                      <div className="flex items-center gap-1">
                         {p.role !== 'ai' && p.id !== 'local' && (
                             <>
                                <button 
                                    onClick={() => muteParticipant(p.id)}
                                    className={`p-1.5 rounded hover:bg-gray-600 ${p.isMuted ? 'text-red-400' : 'text-gray-400'}`}
                                    title={p.isMuted ? "Включить микрофон" : "Выключить микрофон"}
                                >
                                    {p.isMuted ? <MicOffIcon className="w-4 h-4"/> : <MicIcon className="w-4 h-4"/>}
                                </button>
                                <button 
                                    onClick={() => kickParticipant(p.id)}
                                    className="p-1.5 rounded hover:bg-red-900/50 text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                                    title="Исключить"
                                >
                                    <TrashIcon className="w-4 h-4" />
                                </button>
                             </>
                         )}
                      </div>
                   </div>
                 ))}
               </div>
            </div>
          ) : (
            <div className="p-4 space-y-4 text-sm">
              <div className="bg-gray-700/50 p-3 rounded-lg">
                <span className="text-blue-400 font-bold text-xs block mb-1">Gemini AI</span>
                Я готов помогать с модерацией!
              </div>
            </div>
          )}
       </div>
       
       {showSidebar === 'chat' && (
          <div className="p-4 border-t border-gray-700 bg-gray-800">
             <input type="text" placeholder="Написать сообщение..." className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
          </div>
       )}
    </div>
  );

  if (step === 'name') return renderJoinScreen();
  if (step === 'lobby') return renderLobby();

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-white">
      
      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden relative">
        {renderGrid()}
        {showSidebar && renderSidebar()}
      </div>

      {/* Bottom Control Bar */}
      <div className="h-20 bg-gray-900 border-t border-gray-800 flex items-center justify-between px-6 z-20 shrink-0">
        
        {/* Left Info */}
        <div className="flex flex-col">
           <div className="flex items-center gap-2">
               <span className="font-bold text-lg">Конференция</span>
               <span className="text-xs bg-gray-800 px-2 py-0.5 rounded text-gray-400 border border-gray-700 font-mono">{meetingId}</span>
           </div>
           <span className="text-xs text-gray-400">{participants.length} Участник(ов) • 00:12:30</span>
        </div>

        {/* Center Controls */}
        <div className="flex items-center gap-4">
           <button 
             onClick={toggleMute}
             className={`p-4 rounded-full transition-colors ${isMuted ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-700 hover:bg-gray-600'}`}
           >
             {isMuted ? <MicOffIcon className="w-6 h-6" /> : <MicIcon className="w-6 h-6" />}
           </button>

           <button 
             onClick={toggleVideo}
             className={`p-4 rounded-full transition-colors ${isVideoOff ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-700 hover:bg-gray-600'}`}
           >
             {isVideoOff ? <VideoOffIcon className="w-6 h-6" /> : <VideoIcon className="w-6 h-6" />}
           </button>

           <button 
             onClick={toggleScreenShare}
             className={`p-4 rounded-full transition-colors ${activeScreenId === 'local' ? 'bg-green-600 hover:bg-green-700 shadow-[0_0_15px_rgba(22,163,74,0.5)]' : 'bg-gray-700 hover:bg-gray-600'}`}
             title="Демонстрация экрана"
           >
             <ScreenShareIcon className="w-6 h-6" />
           </button>
           
           <div className="w-px h-8 bg-gray-700 mx-2"></div>

           <button 
             onClick={toggleAiAssistant}
             className="px-6 py-3 rounded-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 flex items-center gap-2 transition-all hover:scale-105 shadow-lg"
           >
             <SparklesIcon className="w-5 h-5" />
             <span className="font-semibold hidden md:inline">AI Ассистент</span>
           </button>

           <div className="w-px h-8 bg-gray-700 mx-2"></div>

           <button 
             onClick={leaveMeeting}
             className="px-6 py-3 rounded-full bg-red-600 hover:bg-red-700 font-semibold flex items-center gap-2"
           >
             <PhoneOffIcon className="w-5 h-5" />
             <span className="hidden md:inline">Выйти</span>
           </button>
        </div>

        {/* Right Toggles */}
        <div className="flex items-center gap-3">
           <button 
             onClick={() => setShowSidebar(showSidebar === 'participants' ? null : 'participants')}
             className={`relative p-3 rounded-lg transition-colors ${showSidebar === 'participants' ? 'bg-blue-600' : 'hover:bg-gray-800 text-gray-400 hover:text-white'}`}
           >
              <UsersIcon className="w-6 h-6" />
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center">
                  {participants.length}
              </span>
           </button>
           <button 
             onClick={() => setShowSidebar(showSidebar === 'chat' ? null : 'chat')}
             className={`p-3 rounded-lg transition-colors ${showSidebar === 'chat' ? 'bg-blue-600' : 'hover:bg-gray-800 text-gray-400 hover:text-white'}`}
           >
              <MessageSquareIcon className="w-6 h-6" />
           </button>
        </div>
      </div>

    </div>
  );
}