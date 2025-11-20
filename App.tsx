
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
import { ref, set, onValue, update, remove, onDisconnect, push, child, get, onChildAdded } from 'firebase/database';
import { signInAnonymously, onAuthStateChanged } from 'firebase/auth';

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }
  ]
};

// Helper to update URL safely without throwing SecurityError in sandboxed iframes
const safeUpdateUrl = (meetingId: string | null) => {
    try {
        const url = new URL(window.location.href);
        if (meetingId) {
            url.searchParams.set('meetingId', meetingId);
        } else {
            url.searchParams.delete('meetingId');
        }
        if (window.history && typeof window.history.replaceState === 'function') {
            window.history.replaceState({}, '', url.toString());
        }
    } catch (e) {
        // Silently ignore security errors common in CodeSandbox/StackBlitz/Iframes
    }
};

export default function App() {
  // --- State ---
  const [step, setStep] = useState<'landing' | 'name' | 'lobby' | 'meeting'>('landing');
  const [userName, setUserName] = useState('');
  const [meetingId, setMeetingId] = useState('');
  const [inputMeetingId, setInputMeetingId] = useState('');
  const [localRole, setLocalRole] = useState<'host' | 'guest'>('guest');
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.GALLERY);
  
  // Participants
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [activeScreenId, setActiveScreenId] = useState<string | null>(null);

  // Local Media
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);

  // WebRTC
  const peersRef = useRef<Record<string, RTCPeerConnection>>({});
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});

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
  
  // AI State
  const [isAiConnected, setIsAiConnected] = useState(false);
  const [isAiSupported, setIsAiSupported] = useState(true);
  
  // --- Refs & Services ---
  const liveClient = useRef<LiveClient | null>(null);
  const mySessionId = useRef<string>(Math.random().toString(36).substring(2, 15));

  // --- Effects ---
  
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (user) {
        setIsAuthReady(true);
      } else {
        signInAnonymously(auth).catch((error) => {
           if (error.code === 'auth/admin-restricted-operation' || error.code === 'auth/operation-not-allowed') {
               console.warn("Anonymous Auth disabled. Proceeding in unauthenticated mode.");
               setIsAuthReady(true);
           } else {
               console.error("Firebase Auth Error: " + error.message);
               setIsAuthReady(true);
           }
        });
      }
    });

    try {
      const url = new URL(window.location.href);
      const existingMid = url.searchParams.get('meetingId');
      if (existingMid) {
        setMeetingId(existingMid);
        setLocalRole('guest');
        setStep('name');
      } else {
        setStep('landing');
      }
    } catch (e) {
      setStep('landing');
    }

    try {
      liveClient.current = new LiveClient();
      liveClient.current.onConnectionStateChange = (connected) => {
        setIsAiConnected(connected);
        if (!connected && localRole === 'host' && meetingId) {
            const aiRef = ref(db, `meetings/${meetingId}/participants/gemini-ai`);
            update(aiRef, { isSpeaking: false }).catch(() => {});
        }
      };
      liveClient.current.onSpeakingStateChange = (speaking) => {
        if (localRole === 'host' && meetingId) {
           const aiRef = ref(db, `meetings/${meetingId}/participants/gemini-ai`);
           update(aiRef, { isSpeaking: speaking }).catch(console.error);
        }
      };
      if (!process.env.API_KEY) setIsAiSupported(false);
    } catch (e) {
      setIsAiSupported(false);
    }

    return () => {
      unsubscribeAuth();
      if (liveClient.current) liveClient.current.disconnect();
      if (localStream) localStream.getTracks().forEach(t => t.stop());
      if (screenStream) screenStream.getTracks().forEach(t => t.stop());
      Object.values(peersRef.current).forEach((pc: RTCPeerConnection) => pc.close());
    };
  }, []);

  // --- WebRTC Signaling & Peer Management ---

  // 1. Handle Signals (Offer/Answer/Candidate)
  useEffect(() => {
    if (step !== 'meeting' || !meetingId || !mySessionId.current) return;

    const signalsRef = ref(db, `meetings/${meetingId}/signals/${mySessionId.current}`);
    const unsubscribe = onChildAdded(signalsRef, async (snapshot) => {
        const signal = snapshot.val();
        const key = snapshot.key;
        if (!signal) return;

        const senderId = signal.sender;
        const peerId = senderId;

        // Ensure PC exists
        if (!peersRef.current[peerId]) {
            createPeerConnection(peerId);
        }
        const pc = peersRef.current[peerId];

        try {
            if (signal.type === 'offer') {
                await pc.setRemoteDescription(new RTCSessionDescription(signal.data));
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                sendSignal(peerId, 'answer', answer);
            } else if (signal.type === 'answer') {
                await pc.setRemoteDescription(new RTCSessionDescription(signal.data));
            } else if (signal.type === 'candidate') {
                await pc.addIceCandidate(new RTCIceCandidate(signal.data));
            }
        } catch (e) {
            console.error("WebRTC Signal Error", e);
        }

        if (key) remove(ref(db, `meetings/${meetingId}/signals/${mySessionId.current}/${key}`));
    });

    return () => unsubscribe();
  }, [step, meetingId]);

  // 2. Manage Peers based on Participants list
  useEffect(() => {
     if (step !== 'meeting' || !meetingId) return;

     // Create connections for new participants
     participants.forEach(p => {
         if (p.id === mySessionId.current || p.role === 'ai') return;
         if (!peersRef.current[p.id]) {
             const pc = createPeerConnection(p.id);
             // Mesh Logic: Larger ID offers to Smaller ID to prevent collision
             if (mySessionId.current > p.id) {
                 createOffer(pc, p.id);
             }
         }
     });

     // Cleanup disconnected peers
     Object.keys(peersRef.current).forEach(id => {
         if (!participants.find(p => p.id === id)) {
             peersRef.current[id].close();
             delete peersRef.current[id];
             setRemoteStreams(prev => {
                 const newS = { ...prev };
                 delete newS[id];
                 return newS;
             });
         }
     });
  }, [participants, step, meetingId]);

  // --- WebRTC Functions ---

  const createPeerConnection = (targetId: string) => {
      const pc = new RTCPeerConnection(RTC_CONFIG);
      peersRef.current[targetId] = pc;

      pc.onicecandidate = (event) => {
          if (event.candidate) {
              sendSignal(targetId, 'candidate', event.candidate);
          }
      };

      pc.ontrack = (event) => {
          const stream = event.streams[0];
          setRemoteStreams(prev => ({ ...prev, [targetId]: stream }));
      };

      // Add local tracks
      if (localStream) {
          localStream.getTracks().forEach(track => {
              pc.addTrack(track, localStream);
          });
      }

      return pc;
  };

  const createOffer = async (pc: RTCPeerConnection, targetId: string) => {
      try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          sendSignal(targetId, 'offer', offer);
      } catch (e) {
          console.error("Error creating offer", e);
      }
  };

  const sendSignal = (targetId: string, type: string, data: any) => {
      const signalRef = push(ref(db, `meetings/${meetingId}/signals/${targetId}`));
      set(signalRef, {
          sender: mySessionId.current,
          type,
          data: JSON.parse(JSON.stringify(data)) // sanitize
      });
  };

  const updatePeersTracks = () => {
      // When switching devices, replace tracks in all active connections
      Object.values(peersRef.current).forEach((pc: RTCPeerConnection) => {
          if (!localStream) return;
          const senders = pc.getSenders();
          localStream.getTracks().forEach(track => {
             const sender = senders.find(s => s.track?.kind === track.kind);
             if (sender) {
                 sender.replaceTrack(track);
             }
          });
      });
  };

  // --- Firebase Main Sync ---
  useEffect(() => {
    if (step !== 'meeting' || !meetingId || !isAuthReady) return;

    const meetingRef = ref(db, `meetings/${meetingId}/participants`);
    const unsubscribe = onValue(meetingRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const participantList: Participant[] = Object.values(data);
        
        const amIStillHere = participantList.some(p => p.id === mySessionId.current);
        if (!amIStillHere) {
             alert("Вы были удалены организатором или встреча завершилась.");
             leaveMeeting();
             return;
        }

        const sharer = participantList.find(p => p.isScreenSharing);
        if (sharer && !activeScreenId) {
             // Auto notification could go here
        } else if (!sharer && activeScreenId) {
             setActiveScreenId(null);
             setViewMode(ViewMode.GALLERY);
        }

        const myData = participantList.find(p => p.id === mySessionId.current);
        if (myData && myData.isMuted && !isMuted) {
             setIsMuted(true);
             if(localStream) localStream.getAudioTracks().forEach(t => t.enabled = false);
        }

        setParticipants(participantList);
      } else {
        setParticipants([]);
      }
    }, (error) => {
        if (error.message.includes("PERMISSION_DENIED")) {
            setDbError("PERMISSION_DENIED");
        }
    });

    return () => unsubscribe();
  }, [step, meetingId, isAuthReady]);


  // --- Actions ---

  const createNewMeeting = () => {
    const newId = Math.random().toString(36).substring(7);
    setMeetingId(newId);
    setLocalRole('host');
    safeUpdateUrl(newId);
    setStep('name');
  };

  const joinWithCode = () => {
    if (!inputMeetingId.trim()) return alert("Введите ID встречи");
    setMeetingId(inputMeetingId);
    setLocalRole('guest');
    safeUpdateUrl(inputMeetingId);
    setStep('name');
  };

  const handleNameSubmit = () => {
    if (!userName.trim()) return alert("Пожалуйста, введите ФИО");
    refreshDevices(true).then(() => {
       setStep('lobby');
    });
  };

  const refreshDevices = async (requestPerms = false) => {
      try {
          if (requestPerms) {
              const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
              setLocalStream(stream);
          }
          const devices = await navigator.mediaDevices.enumerateDevices();
          setAudioDevices(devices.filter(d => d.kind === 'audioinput'));
          setVideoDevices(devices.filter(d => d.kind === 'videoinput'));
      } catch (e) {
          console.warn("Could not enumerate devices", e);
      }
  };

  const handleDeviceChange = async (type: 'audio' | 'video', deviceId: string) => {
      if (type === 'audio') setSelectedAudioId(deviceId);
      if (type === 'video') setSelectedVideoId(deviceId);

      if (localStream) {
          const audioId = type === 'audio' ? deviceId : selectedAudioId;
          const videoId = type === 'video' ? deviceId : selectedVideoId;
          try {
              const constraints = {
                  audio: audioId ? { deviceId: { exact: audioId } } : true,
                  video: videoId ? { deviceId: { exact: videoId } } : true
              };
              const newStream = await navigator.mediaDevices.getUserMedia(constraints);
              // Stop old
              localStream.getTracks().forEach(t => t.stop());
              // Apply state
              newStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
              newStream.getVideoTracks().forEach(t => t.enabled = !isVideoOff);
              setLocalStream(newStream);
              // Note: Ideally we call updatePeersTracks() here, but simplified for now:
              // Replace track in current peers
              Object.values(peersRef.current).forEach((pc: RTCPeerConnection) => {
                  const senders = pc.getSenders();
                  newStream.getTracks().forEach(track => {
                      const sender = senders.find(s => s.track?.kind === track.kind);
                      if (sender) sender.replaceTrack(track);
                  });
              });

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

    const localUser: Participant = {
      id: mySessionId.current,
      name: userName,
      avatarUrl: '',
      isMuted: isMuted,
      isVideoOff: isVideoOff,
      isSpeaking: false,
      role: localRole, 
    };

    const userRef = ref(db, `meetings/${meetingId}/participants/${mySessionId.current}`);
    try {
        await set(userRef, localUser);
    } catch (e: any) {
        if (e.code === 'PERMISSION_DENIED') setDbError("PERMISSION_DENIED");
        return;
    }
    
    onDisconnect(userRef).remove();

    if (localRole === 'host') {
        const aiRef = ref(db, `meetings/${meetingId}/participants/gemini-ai`);
        get(aiRef).then((snapshot) => {
            if (!snapshot.exists()) set(aiRef, AI_PARTICIPANT).catch(console.error);
        }).catch(console.error);
    }
    
    if (!localStream) {
         try {
            const constraints = { audio: true, video: true };
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            stream.getAudioTracks().forEach(t => t.enabled = !isMuted);
            stream.getVideoTracks().forEach(t => t.enabled = !isVideoOff);
            setLocalStream(stream);
         } catch (e) { console.error("Error starting stream", e); }
    }

    setStep('meeting');
  };

  const leaveMeeting = () => {
    if (meetingId && mySessionId.current && isAuthReady) {
        remove(ref(db, `meetings/${meetingId}/participants/${mySessionId.current}`));
    }
    setStep('landing');
    setMeetingId('');
    setLocalRole('guest');
    setParticipants([]);
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    if (screenStream) screenStream.getTracks().forEach(t => t.stop());
    setLocalStream(null);
    setScreenStream(null);
    setRemoteStreams({});
    Object.values(peersRef.current).forEach((pc: RTCPeerConnection) => pc.close());
    peersRef.current = {};
    setViewMode(ViewMode.GALLERY);
    setActiveScreenId(null);
    if (liveClient.current) liveClient.current.disconnect();
    safeUpdateUrl(null);
  };

  // --- Control Handlers ---

  const updateMyStatus = (updates: Partial<Participant>) => {
      update(ref(db, `meetings/${meetingId}/participants/${mySessionId.current}`), updates);
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
      // Stop Sharing
      screenStream?.getTracks().forEach(t => t.stop());
      setScreenStream(null);
      
      // Revert tracks for all peers to Camera
      if (localStream) {
          const videoTrack = localStream.getVideoTracks()[0];
          Object.values(peersRef.current).forEach((pc: RTCPeerConnection) => {
              const sender = pc.getSenders().find(s => s.track?.kind === 'video');
              if (sender && videoTrack) sender.replaceTrack(videoTrack);
          });
      }

      if (activeScreenId === mySessionId.current) {
        setActiveScreenId(null);
        setViewMode(ViewMode.GALLERY);
      }
      updateMyStatus({ isScreenSharing: false });
      return;
    }

    try {
      // Start Sharing
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      setScreenStream(stream);
      setActiveScreenId(mySessionId.current);
      setViewMode(ViewMode.SCREEN_SHARE);
      updateMyStatus({ isScreenSharing: true });
      
      // Replace tracks for all peers to Screen
      const screenTrack = stream.getVideoTracks()[0];
      Object.values(peersRef.current).forEach((pc: RTCPeerConnection) => {
          const sender = pc.getSenders().find(s => s.track?.kind === 'video');
          if (sender) sender.replaceTrack(screenTrack);
      });
      
      screenTrack.onended = () => {
        setScreenStream(null);
        // Revert on end
        if (localStream) {
            const videoTrack = localStream.getVideoTracks()[0];
            Object.values(peersRef.current).forEach((pc: RTCPeerConnection) => {
                const sender = pc.getSenders().find(s => s.track?.kind === 'video');
                if (sender && videoTrack) sender.replaceTrack(videoTrack);
            });
        }
        setActiveScreenId(prev => prev === mySessionId.current ? null : prev);
        updateMyStatus({ isScreenSharing: false });
      };
    } catch (err) {
      console.error("Screen share cancelled", err);
    }
  };

  const toggleAiAssistant = async () => {
    if (isAiConnected) {
       liveClient.current?.disconnect();
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
        navigator.clipboard.writeText(inviteUrl).then(() => alert(`Ссылка скопирована:\n${inviteUrl}`));
      } else {
        prompt("Ссылка:", inviteUrl);
      }
    } catch (e) {}
  };

  // --- Host Controls ---

  const muteAll = () => {
    participants.forEach(p => {
        if (p.role !== 'host' && p.role !== 'ai' && !p.isMuted) {
             update(ref(db, `meetings/${meetingId}/participants/${p.id}`), { isMuted: true });
        }
    });
  };

  const muteParticipant = (id: string) => {
    const p = participants.find(p => p.id === id);
    if (p) update(ref(db, `meetings/${meetingId}/participants/${id}`), { isMuted: !p.isMuted });
  };

  const kickParticipant = (id: string) => {
    if(confirm("Удалить участника?")) remove(ref(db, `meetings/${meetingId}/participants/${id}`));
  };

  const toggleParticipantRole = (id: string) => {
     const p = participants.find(p => p.id === id);
     if (p) update(ref(db, `meetings/${meetingId}/participants/${id}`), { role: p.role === 'host' ? 'guest' : 'host' });
  };

  const focusScreen = (participantId: string) => {
     setActiveScreenId(participantId);
     setViewMode(ViewMode.SCREEN_SHARE);
  };

  // --- Render Helpers ---
  const renderDbError = () => (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4">
        <div className="bg-gray-800 p-6 rounded-xl max-w-lg w-full border border-red-500">
            <h2 className="text-xl font-bold text-red-400 mb-4">Ошибка доступа к БД</h2>
            <p className="mb-4 text-gray-300">Необходимо настроить правила доступа в Firebase Console.</p>
            <div className="bg-black/50 p-4 rounded font-mono text-xs text-green-400 overflow-x-auto">
                {`{ "rules": { ".read": true, ".write": true } }`}
            </div>
            <button onClick={() => setDbError(null)} className="w-full py-3 mt-6 bg-gray-700 rounded">Закрыть</button>
        </div>
    </div>
  );

  const renderLanding = () => (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white p-4 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 opacity-20 pointer-events-none">
           <div className="absolute top-[20%] left-[10%] w-64 h-64 bg-blue-500 rounded-full blur-[100px]"></div>
           <div className="absolute bottom-[20%] right-[10%] w-64 h-64 bg-purple-500 rounded-full blur-[100px]"></div>
        </div>
        <div className="max-w-md w-full z-10 text-center space-y-8">
            <div>
                <h1 className="text-5xl font-bold mb-2 bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">GigaConf</h1>
                <p className="text-gray-400">Видеоконференции с AI и демонстрацией экрана</p>
            </div>
            <div className="space-y-3">
                <button onClick={createNewMeeting} disabled={!isAuthReady} className="w-full py-4 bg-blue-600 hover:bg-blue-500 rounded-xl font-bold text-lg shadow-lg transition-all flex items-center justify-center gap-3">
                    <VideoIcon className="w-6 h-6" /> Создать встречу
                </button>
                <div className="flex gap-2">
                    <input type="text" placeholder="Код встречи" value={inputMeetingId} onChange={(e) => setInputMeetingId(e.target.value)} className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4" />
                    <button onClick={joinWithCode} disabled={!isAuthReady} className="px-6 py-3 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-xl font-semibold">Войти</button>
                </div>
            </div>
        </div>
    </div>
  );

  const renderJoinScreen = () => (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white p-4">
       <div className="bg-gray-800 p-8 rounded-2xl max-w-md w-full border border-gray-700">
          <h1 className="text-2xl font-bold text-center mb-6">{localRole === 'host' ? 'Создание' : 'Вход'}</h1>
          <input type="text" value={userName} onChange={(e) => setUserName(e.target.value)} placeholder="Ваше имя" className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-3 mb-4" />
          <button onClick={handleNameSubmit} className="w-full bg-blue-600 hover:bg-blue-500 py-3 rounded-lg font-bold">Продолжить</button>
       </div>
    </div>
  );

  const renderLobby = () => (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-4xl w-full grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
        <div className="space-y-4">
            <h1 className="text-4xl font-bold">Готовы?</h1>
            <p className="text-gray-400">Проверьте камеру и микрофон.</p>
        </div>
        <div className="bg-gray-800 p-6 rounded-2xl border border-gray-700">
            <div className="aspect-video bg-black rounded-xl overflow-hidden mb-6 relative">
                {localStream ? (
                    <video ref={ref => { if(ref && localStream) ref.srcObject = localStream }} autoPlay muted playsInline className={`w-full h-full object-cover ${!isVideoOff ? 'scale-x-[-1]' : ''}`} />
                ) : <div className="w-full h-full flex items-center justify-center text-gray-500">Камера выкл.</div>}
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-4">
                    <button onClick={toggleMute} className={`p-3 rounded-full ${isMuted ? 'bg-red-500' : 'bg-gray-700'}`}>{isMuted ? <MicOffIcon /> : <MicIcon />}</button>
                    <button onClick={toggleVideo} className={`p-3 rounded-full ${isVideoOff ? 'bg-red-500' : 'bg-gray-700'}`}>{isVideoOff ? <VideoOffIcon /> : <VideoIcon />}</button>
                </div>
            </div>
            <button onClick={startMeeting} className="w-full py-4 bg-blue-600 hover:bg-blue-500 rounded-xl font-bold">Войти</button>
        </div>
      </div>
    </div>
  );

  const renderGrid = () => {
    // Screen Share View
    if (viewMode === ViewMode.SCREEN_SHARE && activeScreenId) {
      const sharer = participants.find(p => p.id === activeScreenId);
      // Determine stream to show: Local Screen OR Remote User Stream (which is now their screen track)
      const streamToShow = activeScreenId === mySessionId.current ? screenStream : remoteStreams[activeScreenId];

      return (
        <div className="flex flex-col h-full w-full">
           {participants.filter(p => p.isScreenSharing).length > 0 && (
             <div className="h-14 bg-gray-900 flex items-center px-4 gap-4 overflow-x-auto border-b border-gray-800">
                <span className="text-xs font-bold text-gray-500 uppercase">Экраны:</span>
                {participants.filter(p => p.isScreenSharing).map(p => (
                    <button key={p.id} onClick={() => focusScreen(p.id)} className={`px-3 py-1 rounded text-sm ${activeScreenId === p.id ? 'bg-blue-600' : 'bg-gray-800 hover:bg-gray-700'}`}>
                        {p.id === mySessionId.current ? 'Вы' : p.name}
                    </button>
                ))}
                <button onClick={() => { setViewMode(ViewMode.GALLERY); setActiveScreenId(null); }} className="ml-auto text-blue-400 text-sm hover:underline">Закрыть</button>
             </div>
           )}
           
           <div className="flex-1 bg-black relative flex items-center justify-center">
               {streamToShow ? (
                  <video 
                    ref={ref => ref && (ref.srcObject = streamToShow)} 
                    autoPlay 
                    playsInline 
                    className="w-full h-full object-contain"
                  />
               ) : (
                  <div className="text-gray-500">Ожидание видеопотока...</div>
               )}
               <div className="absolute top-4 left-4 bg-black/50 px-3 py-1 rounded text-white text-sm">
                   Демонстрация: {sharer?.name}
               </div>
           </div>
        </div>
      );
    }

    // Gallery View
    return (
      <div className="flex flex-col h-full w-full">
         {participants.some(p => p.isScreenSharing) && (
             <div className="bg-indigo-900/50 px-4 py-2 flex items-center justify-between">
                <span className="text-sm text-indigo-200">Есть активные демонстрации экрана</span>
                <button onClick={() => focusScreen(participants.find(p => p.isScreenSharing)!.id)} className="text-xs bg-indigo-600 px-3 py-1 rounded">Смотреть</button>
             </div>
         )}
         <div className="h-full w-full p-4 overflow-y-auto">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
             {participants.map(p => (
               <div key={p.id} className="aspect-video">
                  <VideoTile 
                    participant={p} 
                    isLocal={p.id === mySessionId.current}
                    stream={p.id === mySessionId.current ? localStream : remoteStreams[p.id]}
                  />
               </div>
             ))}
          </div>
        </div>
      </div>
    );
  };

  if (step === 'landing') return <>{dbError && renderDbError()}{renderLanding()}</>;
  if (step === 'name') return <>{dbError && renderDbError()}{renderJoinScreen()}</>;
  if (step === 'lobby') return <>{dbError && renderDbError()}{renderLobby()}</>;

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-white">
      {dbError && renderDbError()}
      {showSettings && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
              <div className="bg-gray-800 p-6 rounded-xl w-96">
                  <div className="flex justify-between mb-4"><h3 className="font-bold">Настройки</h3><button onClick={() => setShowSettings(false)}><XIcon/></button></div>
                  <div className="space-y-4">
                      <div><label className="block text-sm text-gray-400">Камера</label><select className="w-full bg-gray-900 p-2 rounded" value={selectedVideoId} onChange={(e) => handleDeviceChange('video', e.target.value)}>{videoDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}</select></div>
                      <div><label className="block text-sm text-gray-400">Микрофон</label><select className="w-full bg-gray-900 p-2 rounded" value={selectedAudioId} onChange={(e) => handleDeviceChange('audio', e.target.value)}>{audioDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}</select></div>
                  </div>
              </div>
          </div>
      )}

      <div className="flex-1 flex overflow-hidden relative">
        {renderGrid()}
        {showSidebar && (
            <div className="w-80 bg-gray-800 border-l border-gray-700 flex flex-col h-full absolute right-0 top-0 z-20 shadow-xl">
                <div className="p-4 border-b border-gray-700 flex justify-between"><h2 className="font-bold">{showSidebar === 'chat' ? 'Чат' : 'Участники'}</h2><button onClick={() => setShowSidebar(null)}>✕</button></div>
                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                    {showSidebar === 'participants' && participants.map(p => (
                        <div key={p.id} className="flex items-center justify-between p-2 hover:bg-gray-700 rounded">
                            <span className="truncate w-32 text-sm">{p.name} {p.role === 'host' && '👑'}</span>
                            {localRole === 'host' && p.id !== mySessionId.current && (
                                <div className="flex gap-1">
                                    <button onClick={() => muteParticipant(p.id)} className="text-gray-400 hover:text-white"><MicOffIcon className="w-4 h-4"/></button>
                                    <button onClick={() => kickParticipant(p.id)} className="text-red-400 hover:text-red-300"><TrashIcon className="w-4 h-4"/></button>
                                </div>
                            )}
                        </div>
                    ))}
                    {showSidebar === 'chat' && <div className="text-gray-500 text-sm text-center mt-10">Чат скоро будет доступен</div>}
                </div>
            </div>
        )}
      </div>

      <div className="h-20 bg-gray-900 border-t border-gray-800 flex items-center justify-between px-4 shrink-0 z-20">
        <div className="hidden md:block"><span className="font-bold">ID: {meetingId}</span></div>
        <div className="flex items-center gap-3">
           <button onClick={toggleMute} className={`p-3 rounded-full ${isMuted ? 'bg-red-600' : 'bg-gray-700'}`}>{isMuted ? <MicOffIcon/> : <MicIcon/>}</button>
           <button onClick={toggleVideo} className={`p-3 rounded-full ${isVideoOff ? 'bg-red-600' : 'bg-gray-700'}`}>{isVideoOff ? <VideoOffIcon/> : <VideoIcon/>}</button>
           <button onClick={toggleScreenShare} className={`p-3 rounded-full ${screenStream ? 'bg-green-600' : 'bg-gray-700'}`}><ScreenShareIcon/></button>
           <div className="w-px h-8 bg-gray-700 mx-2"></div>
           <button onClick={toggleAiAssistant} disabled={!isAiSupported} className={`px-4 py-2 rounded-full flex items-center gap-2 ${isAiConnected ? 'bg-red-500 animate-pulse' : 'bg-blue-600'}`}><SparklesIcon className="w-4 h-4"/> AI</button>
           <div className="w-px h-8 bg-gray-700 mx-2"></div>
           <button onClick={leaveMeeting} className="px-4 py-2 rounded-full bg-red-600">Выйти</button>
        </div>
        <div className="flex gap-2">
            <button onClick={() => setShowSettings(true)} className="p-2 hover:bg-gray-800 rounded"><SettingsIcon/></button>
            <button onClick={() => setShowSidebar(showSidebar === 'participants' ? null : 'participants')} className="p-2 hover:bg-gray-800 rounded relative"><UsersIcon/><span className="absolute top-0 right-0 bg-red-500 text-[10px] w-4 h-4 rounded-full flex items-center justify-center">{participants.length}</span></button>
            <button onClick={() => setShowSidebar(showSidebar === 'chat' ? null : 'chat')} className="p-2 hover:bg-gray-800 rounded"><MessageSquareIcon/></button>
        </div>
      </div>
    </div>
  );
}
