
import React, { useState, useEffect, useRef } from 'react';
import { AI_PARTICIPANT } from './constants';
import { Participant, ViewMode } from './types';
import { VideoTile } from './components/VideoTile';
import { 
  MicIcon, MicOffIcon, VideoIcon, VideoOffIcon, 
  ScreenShareIcon, UsersIcon, MessageSquareIcon, 
  PhoneOffIcon, SparklesIcon, LinkIcon, TrashIcon,
  ShieldIcon, MonitorUpIcon, CrownIcon, SettingsIcon,
  XIcon, ChevronDownIcon
} from './components/Icons';
import { LiveClient } from './services/liveClient';
import { db, auth } from './services/firebase';
import { ref, set, onValue, update, remove, onDisconnect, push, child, get } from 'firebase/database';
import { signInAnonymously, onAuthStateChanged } from 'firebase/auth';

// Helper to update URL safely without throwing SecurityError in sandboxed iframes
const safeUpdateUrl = (meetingId: string | null) => {
    try {
        const url = new URL(window.location.href);
        if (meetingId) {
            url.searchParams.set('meetingId', meetingId);
        } else {
            url.searchParams.delete('meetingId');
        }
        // Check if history API is available and not restricted
        if (window.history && typeof window.history.replaceState === 'function') {
            window.history.replaceState({}, '', url.toString());
        }
    } catch (e) {
        // Silently ignore security errors common in CodeSandbox/StackBlitz/Iframes
        // console.debug("URL update skipped due to environment restrictions");
    }
};

export default function App() {
  // --- State ---
  const [step, setStep] = useState<'landing' | 'name' | 'lobby' | 'meeting'>('landing');
  const [userName, setUserName] = useState('');
  const [meetingId, setMeetingId] = useState('');
  const [inputMeetingId, setInputMeetingId] = useState(''); // For manual entry
  const [localRole, setLocalRole] = useState<'host' | 'guest'>('guest'); // Explicit role state
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.GALLERY);
  
  // Participants
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [activeScreenId, setActiveScreenId] = useState<string | null>(null);

  // Local Media
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);

  // Devices
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioId, setSelectedAudioId] = useState<string>('');
  const [selectedVideoId, setSelectedVideoId] = useState<string>('');
  const [showSettings, setShowSettings] = useState(false);
  
  // UI
  const [showSidebar, setShowSidebar] = useState<'chat' | 'participants' | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
  
  // --- Refs & Services ---
  const liveClient = useRef<LiveClient | null>(null);
  // Unique ID for this browser session to track "self" in the database
  const mySessionId = useRef<string>(Math.random().toString(36).substring(2, 15));

  // --- Effects ---
  
  useEffect(() => {
    // 1. Authenticate Anonymously to satisfy Firebase Rules (auth != null)
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (user) {
        setIsAuthReady(true);
        console.log("Authenticated as:", user.uid);
      } else {
        signInAnonymously(auth).catch((error) => {
           // If auth is disabled in console, we proceed assuming DB rules are public (.read: true, .write: true)
           if (error.code === 'auth/admin-restricted-operation' || error.code === 'auth/operation-not-allowed') {
               console.warn("Anonymous Auth disabled. Proceeding in unauthenticated mode. Ensure DB rules are public.");
               setIsAuthReady(true);
           } else {
               console.error("Firebase Auth Error: " + error.message);
               // Try to proceed anyway
               setIsAuthReady(true);
           }
        });
      }
    });

    // 2. Check URL for meeting ID on load
    try {
      const url = new URL(window.location.href);
      const existingMid = url.searchParams.get('meetingId');
      
      if (existingMid) {
        // User joined via link -> GUEST
        setMeetingId(existingMid);
        setLocalRole('guest');
        setStep('name');
      } else {
        // No ID -> LANDING screen
        setStep('landing');
      }
    } catch (e) {
      console.error("URL Parsing failed:", e);
      setStep('landing');
    }

    // 3. Initialize Live Client
    try {
      liveClient.current = new LiveClient();
      liveClient.current.onSpeakingStateChange = (speaking) => {
        // Update AI state in Firebase if I am the host (to avoid conflicts)
        if (localRole === 'host' && meetingId) {
           const aiRef = ref(db, `meetings/${meetingId}/participants/gemini-ai`);
           update(aiRef, { isSpeaking: speaking }).catch(console.error);
        }
      };
    } catch (e) {
      console.error("Failed to initialize LiveClient:", e);
    }

    return () => {
      unsubscribeAuth();
      if (liveClient.current) liveClient.current.disconnect();
      if (localStream) localStream.getTracks().forEach(t => t.stop());
      if (screenStream) screenStream.getTracks().forEach(t => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Firebase Synchronization ---
  useEffect(() => {
    if (step !== 'meeting' || !meetingId || !isAuthReady) return;

    const meetingRef = ref(db, `meetings/${meetingId}/participants`);
    
    // Subscribe to participant changes
    const unsubscribe = onValue(meetingRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const participantList: Participant[] = Object.values(data);
        
        // If I was kicked (my ID is no longer in the list), leave
        const amIStillHere = participantList.some(p => p.id === mySessionId.current);
        if (!amIStillHere) {
             alert("Вы были удалены организатором или встреча завершилась.");
             leaveMeeting();
             return;
        }

        // Update screen share active ID
        const sharer = participantList.find(p => p.isScreenSharing);
        if (sharer && !activeScreenId) {
             // Auto switch logic could go here
        } else if (!sharer && activeScreenId) {
             setActiveScreenId(null);
             setViewMode(ViewMode.GALLERY);
        }

        // Check if I was muted by host
        const myData = participantList.find(p => p.id === mySessionId.current);
        if (myData && myData.isMuted && !isMuted) {
             setIsMuted(true);
             if(localStream) localStream.getAudioTracks().forEach(t => t.enabled = false);
        }

        setParticipants(participantList);
      } else {
        // Meeting deleted or empty
        setParticipants([]);
      }
    }, (error) => {
        if (error.message.includes("PERMISSION_DENIED")) {
            setDbError("PERMISSION_DENIED");
        } else {
            console.error("Firebase Read Error:", error);
        }
    });

    return () => unsubscribe();
  }, [step, meetingId, isAuthReady]);


  // --- Actions ---

  const createNewMeeting = () => {
    const newId = Math.random().toString(36).substring(7);
    setMeetingId(newId);
    setLocalRole('host'); // Creator is HOST
    safeUpdateUrl(newId);
    setStep('name');
  };

  const joinWithCode = () => {
    if (!inputMeetingId.trim()) return alert("Введите ID встречи");
    setMeetingId(inputMeetingId);
    setLocalRole('guest'); // Joiner via code is GUEST
    safeUpdateUrl(inputMeetingId);
    setStep('name');
  };

  const handleNameSubmit = () => {
    if (!userName.trim()) return alert("Пожалуйста, введите ФИО");
    
    // Request permissions early to list devices
    refreshDevices(true).then(() => {
       setStep('lobby');
    });
  };

  const refreshDevices = async (requestPerms = false) => {
      try {
          if (requestPerms) {
              // Request temp stream to get labels
              const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
              setLocalStream(stream); // Show preview in lobby
              stream.getTracks().forEach(t => {
                  // Don't stop immediately if we want preview
              });
          }
          
          const devices = await navigator.mediaDevices.enumerateDevices();
          const audio = devices.filter(d => d.kind === 'audioinput');
          const video = devices.filter(d => d.kind === 'videoinput');
          
          setAudioDevices(audio);
          setVideoDevices(video);

          if (!selectedAudioId && audio.length > 0) setSelectedAudioId(audio[0].deviceId);
          if (!selectedVideoId && video.length > 0) setSelectedVideoId(video[0].deviceId);
      } catch (e) {
          console.warn("Could not enumerate devices", e);
      }
  };

  const handleDeviceChange = async (type: 'audio' | 'video', deviceId: string) => {
      if (type === 'audio') setSelectedAudioId(deviceId);
      if (type === 'video') setSelectedVideoId(deviceId);

      // If in meeting or lobby with stream, restart stream with new device
      if (localStream) {
          const audioId = type === 'audio' ? deviceId : selectedAudioId;
          const videoId = type === 'video' ? deviceId : selectedVideoId;
          
          try {
              const constraints = {
                  audio: audioId ? { deviceId: { exact: audioId } } : true,
                  video: videoId ? { deviceId: { exact: videoId } } : true
              };
              
              const newStream = await navigator.mediaDevices.getUserMedia(constraints);
              
              // Stop old tracks
              localStream.getTracks().forEach(t => t.stop());
              
              // Apply mute/video off states
              newStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
              newStream.getVideoTracks().forEach(t => t.enabled = !isVideoOff);

              setLocalStream(newStream);

          } catch (e) {
              console.error("Failed to switch device", e);
          }
      }
  };

  // --- Meeting Handlers ---

  const startMeeting = async () => {
    if (!isAuthReady) {
        alert("Ожидание подключения к серверу...");
        return;
    }

    // 1. Construct Local User Object
    const localUser: Participant = {
      id: mySessionId.current,
      name: userName,
      avatarUrl: '',
      isMuted: isMuted,
      isVideoOff: isVideoOff,
      isSpeaking: false,
      role: localRole, 
    };

    // 2. Write to Firebase
    const userRef = ref(db, `meetings/${meetingId}/participants/${mySessionId.current}`);
    
    try {
        await set(userRef, localUser);
    } catch (e: any) {
        if (e.code === 'PERMISSION_DENIED') {
             setDbError("PERMISSION_DENIED");
        } else {
             alert("Ошибка подключения к базе данных: " + e.message);
        }
        return;
    }
    
    // 3. Set Disconnect Handler (Remove user if tab closes)
    onDisconnect(userRef).remove().catch(err => console.warn("onDisconnect failed (likely permissions):", err));

    // 4. If Host, also ensure AI participant exists
    if (localRole === 'host') {
        const aiRef = ref(db, `meetings/${meetingId}/participants/gemini-ai`);
        get(aiRef).then((snapshot) => {
            if (!snapshot.exists()) {
                set(aiRef, AI_PARTICIPANT).catch(console.error);
            }
        }).catch(console.error);
    }
    
    // 5. Get stream with selected devices if not already active or correct
    if (!localStream || localStream.getAudioTracks()[0]?.getSettings().deviceId !== selectedAudioId) {
         try {
            const constraints = {
                audio: selectedAudioId ? { deviceId: { exact: selectedAudioId } } : true,
                video: selectedVideoId ? { deviceId: { exact: selectedVideoId } } : true
            };
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
             // Apply states
            stream.getAudioTracks().forEach(t => t.enabled = !isMuted);
            stream.getVideoTracks().forEach(t => t.enabled = !isVideoOff);
            setLocalStream(stream);
         } catch (e) {
             console.error("Error starting meeting stream", e);
         }
    }

    setStep('meeting');
  };

  const leaveMeeting = () => {
    // Remove from Firebase
    if (meetingId && mySessionId.current && isAuthReady) {
        const userRef = ref(db, `meetings/${meetingId}/participants/${mySessionId.current}`);
        remove(userRef).catch(console.error);
    }

    // Reset State
    setStep('landing');
    setMeetingId('');
    setLocalRole('guest');
    setParticipants([]);

    if (localStream) localStream.getTracks().forEach(t => t.stop());
    if (screenStream) screenStream.getTracks().forEach(t => t.stop());
    setLocalStream(null);
    setScreenStream(null);
    setViewMode(ViewMode.GALLERY);
    setActiveScreenId(null);
    if (liveClient.current) liveClient.current.disconnect();

    safeUpdateUrl(null);
  };

  // --- Control Handlers (Sync to Firebase) ---

  const updateMyStatus = (updates: Partial<Participant>) => {
      const userRef = ref(db, `meetings/${meetingId}/participants/${mySessionId.current}`);
      update(userRef, updates).catch(console.error);
  };

  const toggleMute = () => {
    if (localStream) {
      localStream.getAudioTracks().forEach(track => track.enabled = !isMuted);
    }
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    updateMyStatus({ isMuted: newMuted });
  };

  const toggleVideo = () => {
    if (localStream) {
      localStream.getVideoTracks().forEach(track => track.enabled = !isVideoOff);
    }
    const newVideoOff = !isVideoOff;
    setIsVideoOff(newVideoOff);
    updateMyStatus({ isVideoOff: newVideoOff });
  };

  const toggleScreenShare = async () => {
    const isSharing = !!screenStream;

    if (isSharing) {
      screenStream?.getTracks().forEach(t => t.stop());
      setScreenStream(null);
      if (activeScreenId === mySessionId.current) {
        setActiveScreenId(null);
        setViewMode(ViewMode.GALLERY);
      }
      updateMyStatus({ isScreenSharing: false });
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      setScreenStream(stream);
      setActiveScreenId(mySessionId.current);
      setViewMode(ViewMode.SCREEN_SHARE);
      updateMyStatus({ isScreenSharing: true });
      
      stream.getVideoTracks()[0].onended = () => {
        setScreenStream(null);
        setActiveScreenId(prev => prev === mySessionId.current ? null : prev);
        updateMyStatus({ isScreenSharing: false });
      };
    } catch (err) {
      console.error("Screen share cancelled or failed", err);
    }
  };

  const toggleAiAssistant = async () => {
    const aiPart = participants.find(p => p.role === 'ai');
    if (aiPart?.isSpeaking) {
       liveClient.current?.disconnect();
       if (localRole === 'host') {
           const aiRef = ref(db, `meetings/${meetingId}/participants/gemini-ai`);
           update(aiRef, { isSpeaking: false });
       }
    } else {
       await liveClient.current?.connect(selectedAudioId);
    }
  };

  const handleShareInvite = () => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('meetingId', meetingId);
      const inviteUrl = url.toString();
      
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(inviteUrl)
          .then(() => alert(`Ссылка скопирована в буфер обмена:\n${inviteUrl}`))
          .catch(() => prompt("Скопируйте ссылку вручную:", inviteUrl));
      } else {
        prompt("Скопируйте ссылку вручную:", inviteUrl);
      }
    } catch (e) {
      console.error("Error generating invite link:", e);
      alert("Ошибка при создании ссылки: " + meetingId);
    }
  };

  // --- Host Controls ---

  const muteAll = () => {
    participants.forEach(p => {
        if (p.role !== 'host' && p.role !== 'ai' && !p.isMuted) {
             const pRef = ref(db, `meetings/${meetingId}/participants/${p.id}`);
             update(pRef, { isMuted: true });
        }
    });
  };

  const muteParticipant = (id: string) => {
    const p = participants.find(p => p.id === id);
    if (p) {
        const pRef = ref(db, `meetings/${meetingId}/participants/${id}`);
        update(pRef, { isMuted: !p.isMuted });
    }
  };

  const kickParticipant = (id: string) => {
    if(confirm("Вы уверены, что хотите удалить этого участника?")) {
       const pRef = ref(db, `meetings/${meetingId}/participants/${id}`);
       remove(pRef);
    }
  };

  const toggleParticipantRole = (id: string) => {
     const p = participants.find(p => p.id === id);
     if (p) {
         const newRole = p.role === 'host' ? 'guest' : 'host';
         const pRef = ref(db, `meetings/${meetingId}/participants/${id}`);
         update(pRef, { role: newRole });
     }
  };

  const focusScreen = (participantId: string) => {
     setActiveScreenId(participantId);
     setViewMode(ViewMode.SCREEN_SHARE);
  };

  // --- Render Layouts ---

  const renderDbError = () => (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4">
        <div className="bg-gray-800 p-6 rounded-xl max-w-lg w-full border border-red-500/50">
            <h2 className="text-xl font-bold text-red-400 mb-4">Ошибка доступа к базе данных</h2>
            <p className="mb-4 text-gray-300">
                Firebase заблокировал запись данных. Это происходит, когда не настроены правила безопасности или отключена анонимная аутентификация.
            </p>
            <div className="bg-black/50 p-4 rounded-lg mb-4 font-mono text-xs text-green-400 overflow-x-auto">
                <pre className="whitespace-pre-wrap">
{`// Firebase Console -> Realtime Database -> Rules
{
  "rules": {
    ".read": true,
    ".write": true
  }
}`}
                </pre>
            </div>
            <p className="text-sm text-gray-500 mb-6">
                Скопируйте эти правила в консоль Firebase, чтобы разрешить доступ.
            </p>
            <button 
                onClick={() => setDbError(null)}
                className="w-full py-3 bg-gray-700 hover:bg-gray-600 rounded-lg text-white"
            >
                Понятно
            </button>
        </div>
    </div>
  );

  const renderLanding = () => (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-900 text-white p-4 relative overflow-hidden">
        {/* Background effects */}
        <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] bg-blue-600/20 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] bg-purple-600/20 rounded-full blur-[120px]" />

        <div className="max-w-md w-full z-10 text-center space-y-12">
            <div>
                <div className="flex justify-center mb-6">
                    <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-2xl shadow-blue-500/20 transform rotate-3">
                        <SparklesIcon className="w-10 h-10 text-white" />
                    </div>
                </div>
                <h1 className="text-5xl font-bold tracking-tight mb-4 bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">
                    GigaConference
                </h1>
                <p className="text-gray-400 text-lg">
                    Безопасные видеоконференции с ИИ-ассистентом и безлимитной демонстрацией экрана.
                </p>
            </div>

            <div className="space-y-4">
                <button 
                    onClick={createNewMeeting}
                    disabled={!isAuthReady}
                    className={`w-full py-4 rounded-xl font-bold text-lg shadow-lg transition-all flex items-center justify-center gap-3 ${isAuthReady ? 'bg-blue-600 hover:bg-blue-500 shadow-blue-600/25 transform hover:-translate-y-1' : 'bg-gray-700 cursor-not-allowed opacity-50'}`}
                >
                    {isAuthReady ? (
                        <>
                            <VideoIcon className="w-6 h-6" />
                            Создать новую встречу
                        </>
                    ) : (
                        <span>Подключение...</span>
                    )}
                </button>
                
                <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t border-gray-800"></div>
                    </div>
                    <div className="relative flex justify-center text-sm">
                        <span className="px-2 bg-gray-900 text-gray-500">ИЛИ</span>
                    </div>
                </div>

                <div className="flex gap-2">
                    <input 
                        type="text" 
                        placeholder="Введите код встречи"
                        value={inputMeetingId}
                        onChange={(e) => setInputMeetingId(e.target.value)}
                        className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                    />
                    <button 
                        onClick={joinWithCode}
                        disabled={!isAuthReady}
                        className="px-6 py-3 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-xl font-semibold transition-colors"
                    >
                        Войти
                    </button>
                </div>
            </div>
        </div>
    </div>
  );

  // ... (renderJoinScreen, renderLobby, renderGrid, renderSidebar kept exactly as before)
  const renderJoinScreen = () => (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white p-4">
       <div className="bg-gray-800 p-8 rounded-2xl shadow-2xl max-w-md w-full border border-gray-700 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-purple-500"></div>
          
          <div className="flex justify-center mb-6">
             <div className={`w-16 h-16 rounded-full flex items-center justify-center ${localRole === 'host' ? 'bg-blue-600/20 text-blue-400' : 'bg-gray-700 text-gray-400'}`}>
               {localRole === 'host' ? <VideoIcon className="w-8 h-8" /> : <LinkIcon className="w-8 h-8" />}
             </div>
          </div>
          
          <h1 className="text-2xl font-bold text-center mb-2">
              {localRole === 'host' ? 'Создание встречи' : 'Вход во встречу'}
          </h1>
          <div className="flex justify-center mb-6">
            <span className="px-3 py-1 bg-gray-900 rounded-full text-xs font-mono text-gray-500 border border-gray-700 flex items-center gap-2">
                ID: {meetingId}
            </span>
          </div>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Представьтесь</label>
              <input 
                type="text" 
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder="Иванов Иван"
                autoFocus
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <button 
              onClick={handleNameSubmit}
              className="w-full bg-blue-600 hover:bg-blue-500 py-3 rounded-lg font-bold transition-colors"
            >
              {localRole === 'host' ? 'Настроить оборудование' : 'Продолжить'}
            </button>
            <button 
                onClick={() => { setStep('landing'); safeUpdateUrl(null); }}
                className="w-full text-sm text-gray-500 hover:text-gray-300 mt-2"
            >
                Назад
            </button>
          </div>
       </div>
    </div>
  );

  const renderDeviceSelectors = () => (
      <div className="grid grid-cols-1 gap-4 text-left">
          <div>
              <label className="block text-sm text-gray-400 mb-1">Камера</label>
              <div className="relative">
                  <select 
                    value={selectedVideoId} 
                    onChange={(e) => handleDeviceChange('video', e.target.value)}
                    className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 appearance-none focus:outline-none focus:border-blue-500"
                  >
                      {videoDevices.map(d => (
                          <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${d.deviceId.slice(0,5)}...`}</option>
                      ))}
                  </select>
                  <ChevronDownIcon className="w-4 h-4 absolute right-3 top-3 pointer-events-none text-gray-400" />
              </div>
          </div>
          <div>
              <label className="block text-sm text-gray-400 mb-1">Микрофон</label>
              <div className="relative">
                  <select 
                    value={selectedAudioId} 
                    onChange={(e) => handleDeviceChange('audio', e.target.value)}
                    className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 appearance-none focus:outline-none focus:border-blue-500"
                  >
                      {audioDevices.map(d => (
                          <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${d.deviceId.slice(0,5)}...`}</option>
                      ))}
                  </select>
                  <ChevronDownIcon className="w-4 h-4 absolute right-3 top-3 pointer-events-none text-gray-400" />
              </div>
          </div>
      </div>
  );

  const renderLobby = () => (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-black text-white p-6">
      <div className="max-w-5xl w-full grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
        
        <div className="space-y-8 text-center lg:text-left">
            <div className="space-y-4">
            <h1 className="text-5xl lg:text-6xl font-bold tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-500">
                GigaConference
            </h1>
            <p className="text-xl text-gray-400">
                Привет, {userName}! Настройте оборудование перед входом.
            </p>
            {localRole === 'host' && (
                <span className="inline-block px-3 py-1 bg-blue-900/50 text-blue-300 border border-blue-800 rounded-full text-sm">
                    Вы организатор этой встречи
                </span>
            )}
            </div>

            <div className="hidden lg:flex flex-col gap-4">
                {localRole === 'host' && (
                <div className="p-4 rounded-xl bg-gray-800/30 border border-gray-700/50 backdrop-blur-sm flex items-center gap-4">
                    <ShieldIcon className="w-8 h-8 text-blue-400" />
                    <div className="text-left">
                        <h3 className="font-semibold">Полный контроль</h3>
                        <p className="text-xs text-gray-400">Управление участниками для организатора</p>
                    </div>
                </div>
                )}
                <div className="p-4 rounded-xl bg-gray-800/30 border border-gray-700/50 backdrop-blur-sm flex items-center gap-4">
                    <MonitorUpIcon className="w-8 h-8 text-purple-400" />
                    <div className="text-left">
                        <h3 className="font-semibold">Мульти-скрин</h3>
                        <p className="text-xs text-gray-400">Одновременная демонстрация экранов</p>
                    </div>
                </div>
            </div>
        </div>

        <div className="bg-gray-800 p-6 rounded-2xl border border-gray-700 shadow-2xl w-full max-w-lg mx-auto">
            <div className="aspect-video bg-black rounded-xl overflow-hidden mb-6 relative border border-gray-700">
                {localStream ? (
                    <video 
                        ref={ref => { if(ref && localStream) ref.srcObject = localStream }} 
                        autoPlay 
                        muted 
                        playsInline 
                        className={`w-full h-full object-cover transform ${!isVideoOff ? 'scale-x-[-1]' : ''}`}
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-500">
                        Камера отключена
                    </div>
                )}
                
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-4">
                    <button 
                        onClick={toggleMute}
                        className={`p-3 rounded-full transition-colors ${isMuted ? 'bg-red-500 hover:bg-red-600' : 'bg-gray-700 hover:bg-gray-600'}`}
                    >
                        {isMuted ? <MicOffIcon className="w-5 h-5" /> : <MicIcon className="w-5 h-5" />}
                    </button>
                    <button 
                        onClick={toggleVideo}
                        className={`p-3 rounded-full transition-colors ${isVideoOff ? 'bg-red-500 hover:bg-red-600' : 'bg-gray-700 hover:bg-gray-600'}`}
                    >
                        {isVideoOff ? <VideoOffIcon className="w-5 h-5" /> : <VideoIcon className="w-5 h-5" />}
                    </button>
                </div>
            </div>

            <div className="mb-8">
                {renderDeviceSelectors()}
            </div>

            <button 
            onClick={startMeeting}
            className="w-full py-4 bg-blue-600 hover:bg-blue-500 rounded-xl font-bold text-lg shadow-lg shadow-blue-600/20 transition-all transform hover:scale-[1.02]"
            >
            Войти в конференцию
            </button>
        </div>

      </div>
    </div>
  );

  const renderSettingsModal = () => (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-gray-800 rounded-2xl border border-gray-700 w-full max-w-md p-6 shadow-2xl">
              <div className="flex justify-between items-center mb-6">
                  <h2 className="text-xl font-bold flex items-center gap-2">
                      <SettingsIcon className="w-6 h-6 text-blue-400" />
                      Настройки
                  </h2>
                  <button onClick={() => setShowSettings(false)} className="text-gray-400 hover:text-white">
                      <XIcon className="w-6 h-6" />
                  </button>
              </div>
              
              <div className="space-y-6">
                  {renderDeviceSelectors()}
              </div>

              <div className="mt-8 flex justify-end">
                  <button 
                    onClick={() => setShowSettings(false)}
                    className="bg-blue-600 hover:bg-blue-500 px-6 py-2 rounded-lg font-semibold transition-colors"
                  >
                      Готово
                  </button>
              </div>
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
               <span className="text-xs truncate max-w-full">{p.id === mySessionId.current ? 'Ваш экран' : p.name}</span>
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
    if (viewMode === ViewMode.SCREEN_SHARE && activeScreenId) {
      const sharer = participants.find(p => p.id === activeScreenId);
      
      return (
        <div className="flex flex-col h-full w-full">
           {renderScreenShareSelector()}
           
           <div className="flex-1 flex p-4 gap-4 overflow-hidden">
              <div className="flex-1 bg-black rounded-2xl overflow-hidden relative border border-gray-800 flex items-center justify-center">
                 {activeScreenId === mySessionId.current && screenStream ? (
                    <video 
                      ref={ref => ref && (ref.srcObject = screenStream)} 
                      autoPlay 
                      playsInline 
                      className="w-full h-full object-contain"
                    />
                 ) : (
                    <div className="flex flex-col items-center text-gray-500 p-8 text-center">
                       <MonitorUpIcon className="w-24 h-24 mb-4 opacity-20 animate-pulse" />
                       <p className="text-xl font-semibold">Демонстрация экрана: {sharer?.name}</p>
                       <p className="text-sm mt-2 max-w-md text-gray-600">
                           В настоящем приложении здесь был бы видеопоток через WebRTC. 
                           Сейчас мы синхронизируем только статус демонстрации через Firebase.
                       </p>
                    </div>
                 )}
                 
                 <div className="absolute top-4 left-4 bg-blue-600/90 px-3 py-1 rounded text-sm font-bold backdrop-blur-md shadow-lg">
                   {activeScreenId === mySessionId.current ? 'Вы демонстрируете экран' : `Экран: ${sharer?.name}`}
                 </div>
              </div>
              
              <div className="w-56 flex flex-col gap-2 overflow-y-auto pr-2 hidden md:flex">
                 {participants.map(p => (
                    <div key={p.id} className="h-32 shrink-0">
                      <VideoTile 
                        participant={p} 
                        isLocal={p.id === mySessionId.current} 
                        stream={p.id === mySessionId.current ? localStream : undefined} 
                      />
                    </div>
                 ))}
              </div>
           </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col h-full w-full">
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
                    isLocal={p.id === mySessionId.current}
                    stream={p.id === mySessionId.current ? localStream : undefined}
                  />
               </div>
             ))}
          </div>
        </div>
      </div>
    );
  };

  const renderSidebar = () => {
     const localParticipant = participants.find(p => p.id === mySessionId.current);
     const isLocalHost = localParticipant?.role === 'host';

     return (
     <div className="w-80 bg-gray-800 border-l border-gray-700 flex flex-col shadow-2xl z-20 animate-in slide-in-from-right h-full absolute right-0 top-0">
       <div className="p-4 border-b border-gray-700 flex justify-between items-center bg-gray-800">
          <h2 className="font-bold">{showSidebar === 'chat' ? 'Чат встречи' : `Участники (${participants.length})`}</h2>
          <button onClick={() => setShowSidebar(null)} className="text-gray-400 hover:text-white">✕</button>
       </div>
       
       <div className="flex-1 overflow-y-auto">
          {showSidebar === 'participants' ? (
            <div className="p-4 space-y-4">
               {isLocalHost && (
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
               )}

               <div className="space-y-2">
                 {participants.map(p => (
                   <div key={p.id} className="flex items-center justify-between group p-2 hover:bg-gray-700/50 rounded-lg transition-colors">
                      <div className="flex items-center gap-3 overflow-hidden">
                        {p.role === 'ai' ? (
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-xs">AI</div>
                        ) : p.id === mySessionId.current ? (
                            <div className="w-8 h-8 bg-gray-600 rounded-full flex items-center justify-center text-xs font-bold">Вы</div>
                        ) : (
                            <div className="w-8 h-8 bg-gray-600 rounded-full flex items-center justify-center text-xs font-bold">
                                {p.name.charAt(0)}
                            </div>
                        )}
                        <div className="flex flex-col truncate">
                            <span className="text-sm truncate font-medium flex items-center gap-1">
                                {p.name} 
                                {p.role === 'host' && <CrownIcon className="w-3 h-3 text-yellow-400" />}
                            </span>
                            {p.isScreenSharing && <span className="text-[10px] text-green-400 flex items-center gap-1"><MonitorUpIcon className="w-3 h-3"/> Транслирует экран</span>}
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                         {p.role !== 'ai' && p.id !== mySessionId.current && isLocalHost && (
                             <>
                                <button 
                                    onClick={() => toggleParticipantRole(p.id)}
                                    className={`p-1.5 rounded hover:bg-gray-600 transition-colors ${p.role === 'host' ? 'text-yellow-400' : 'text-gray-500 hover:text-yellow-200'}`}
                                    title={p.role === 'host' ? "Снять права организатора" : "Назначить организатором"}
                                >
                                    <CrownIcon className="w-4 h-4" />
                                </button>
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
  };

  if (step === 'landing') return <>{dbError && renderDbError()}{renderLanding()}</>;
  if (step === 'name') return <>{dbError && renderDbError()}{renderJoinScreen()}</>;
  if (step === 'lobby') return <>{dbError && renderDbError()}{renderLobby()}</>;

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-white">
      
      {dbError && renderDbError()}
      {showSettings && renderSettingsModal()}

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
             className={`p-4 rounded-full transition-colors ${screenStream ? 'bg-green-600 hover:bg-green-700 shadow-[0_0_15px_rgba(22,163,74,0.5)]' : 'bg-gray-700 hover:bg-gray-600'}`}
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
             onClick={() => setShowSettings(true)}
             className="p-3 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
             title="Настройки"
           >
              <SettingsIcon className="w-6 h-6" />
           </button>
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
