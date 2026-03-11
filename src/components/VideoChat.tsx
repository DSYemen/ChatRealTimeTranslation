import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Mic, MicOff, Video, VideoOff, PhoneOff, Languages, Users, Bot, Settings, X, Wifi, WifiOff, Loader2, AlertCircle, MonitorUp, MonitorOff, MessageSquare, Send, Maximize, Minimize } from 'lucide-react';
import { useWebRTC } from '../hooks/useWebRTC';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { translateText } from '../services/geminiService';
import { useAuth } from '../contexts/AuthContext';
import { saveMessage, subscribeToMessages, Message } from '../services/roomService';
import { getUserPreferences, updateUserPreferences } from '../services/userService';

interface VideoChatProps {
  roomId: string;
  onLeave: () => void;
}

function RemoteVideo({ stream, isDubbingEnabled }: { stream: MediaStream, isDubbingEnabled: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted={isDubbingEnabled}
      className="w-full h-full object-cover"
    />
  );
}

export function VideoChat({ roomId, onLeave }: VideoChatProps) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const { currentUser } = useAuth();
  
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isTranslationEnabled, setIsTranslationEnabled] = useState(false);
  const [isDubbingEnabled, setIsDubbingEnabled] = useState(false);
  const [usersRequestingTranscription, setUsersRequestingTranscription] = useState<string[]>([]);
  const [selectedLanguage, setSelectedLanguage] = useState('ar-SA');
  const [myLanguage, setMyLanguage] = useState('en-US');
  
  const [subtitles, setSubtitles] = useState<Record<string, { original: string, translated?: string }>>({});
  const [remoteStatuses, setRemoteStatuses] = useState<Record<string, { audio: boolean, video: boolean }>>({});
  
  const [showParticipants, setShowParticipants] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [subtitleSize, setSubtitleSize] = useState<'text-sm' | 'text-base' | 'text-lg'>('text-base');
  const [subtitlePosition, setSubtitlePosition] = useState<'top-4' | 'bottom-4'>('bottom-4');
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageTranslations, setMessageTranslations] = useState<Record<string, { text?: string, isLoading: boolean }>>({});
  const [chatInput, setChatInput] = useState('');
  const [chatRecipient, setChatRecipient] = useState<string | null>(null);
  const [pinnedUserId, setPinnedUserId] = useState<string | null>(null);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const { speak, voices, warmup } = useSpeechSynthesis();

  // Load user preferences
  useEffect(() => {
    if (currentUser) {
      getUserPreferences(currentUser.uid).then((prefs) => {
        setSelectedLanguage(prefs.language);
        setSubtitleSize(prefs.subtitleSize);
        setSubtitlePosition(prefs.subtitlePosition);
        setPrefsLoaded(true);
      });
    }
  }, [currentUser]);

  // Save user preferences when they change
  useEffect(() => {
    if (currentUser && prefsLoaded) {
      updateUserPreferences(currentUser.uid, {
        language: selectedLanguage,
        subtitleSize,
        subtitlePosition
      });
    }
  }, [selectedLanguage, subtitleSize, subtitlePosition, currentUser, prefsLoaded]);

  const handleTranslateMessage = async (messageId: string, text: string) => {
    setMessageTranslations(prev => ({ ...prev, [messageId]: { isLoading: true } }));
    try {
      const translated = await translateText(text, selectedLanguage);
      setMessageTranslations(prev => ({ ...prev, [messageId]: { text: translated, isLoading: false } }));
    } catch (error) {
      console.error("Translation failed:", error);
      setMessageTranslations(prev => ({ ...prev, [messageId]: { text: 'Translation failed', isLoading: false } }));
    }
  };

  const handleDataReceived = useCallback(async (data: any, userId: string) => {
    if (data.type === 'control') {
      if (data.action === 'enable_transcription') {
        setUsersRequestingTranscription(prev => prev.includes(userId) ? prev : [...prev, userId]);
      } else if (data.action === 'disable_transcription') {
        setUsersRequestingTranscription(prev => prev.filter(id => id !== userId));
      }
    } else if (data.type === 'speech') {
      const { text, lang } = data;
      
      // Always show the original text as subtitle immediately
      setSubtitles(prev => ({ 
        ...prev, 
        [userId]: { 
          original: text, 
          translated: (isTranslationEnabled || isDubbingEnabled) ? 'Translating...' : undefined 
        } 
      }));
      
      if (isTranslationEnabled || isDubbingEnabled) {
        // Perform translation asynchronously without blocking the UI
        translateText(text, selectedLanguage)
          .then(translated => {
            setSubtitles(prev => ({ ...prev, [userId]: { original: text, translated } }));
            
            if (isDubbingEnabled) {
              speak(translated, selectedLanguage);
            }
          })
          .catch(error => {
            console.error("Translation failed:", error);
            setSubtitles(prev => ({ ...prev, [userId]: { original: text, translated: 'Translation failed' } }));
          });
      }
    } else if (data.type === 'status') {
      setRemoteStatuses(prev => ({
        ...prev,
        [userId]: { audio: data.audio, video: data.video }
      }));
    }
  }, [isTranslationEnabled, isDubbingEnabled, selectedLanguage, speak]);

  const {
    localStream,
    remoteStreams,
    connectedPeers,
    peerStates,
    peerProfiles,
    mediaError,
    socketConnected,
    isScreenSharing,
    startLocalStream,
    sendData,
    toggleAudio,
    toggleVideo,
    toggleScreenShare
  } = useWebRTC(
    roomId, 
    currentUser?.uid || '', 
    currentUser?.displayName || 'Unknown User', 
    currentUser?.photoURL || '', 
    handleDataReceived
  );

  const knownPeers = Object.keys(peerStates);
  const isConnected = knownPeers.length > 0;
  const isRemoteRequestingTranscription = usersRequestingTranscription.length > 0;

  const handleSpeechResult = useCallback(async (text: string) => {
    sendData({ type: 'speech', text, lang: myLanguage }, chatRecipient || undefined);
    
    // Save to Firestore if authenticated
    if (currentUser) {
      try {
        // We save the original text. The translated text can be saved by the receiver, 
        // or we can just save the original and translate on read for chat history.
        await saveMessage(roomId, currentUser, text, null, myLanguage, chatRecipient || undefined);
      } catch (error) {
        console.error("Error saving message to Firestore:", error);
      }
    }
  }, [sendData, myLanguage, currentUser, roomId, chatRecipient]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !currentUser) return;

    const text = chatInput.trim();
    setChatInput('');

    // Send via WebRTC for real-time translation/subtitles
    sendData({ type: 'speech', text, lang: myLanguage }, chatRecipient || undefined);

    // Save to Firestore
    try {
      await saveMessage(roomId, currentUser, text, null, myLanguage, chatRecipient || undefined);
    } catch (error) {
      console.error("Error saving message to Firestore:", error);
    }
  };

  const { isListening, startListening, stopListening } = useSpeechRecognition(handleSpeechResult);

  useEffect(() => {
    startLocalStream();
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    const unsubscribe = subscribeToMessages(roomId, currentUser.uid, (newMessages) => {
      setMessages(newMessages);
    });
    return () => unsubscribe();
  }, [roomId, currentUser]);

  useEffect(() => {
    if (showChat && chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, showChat]);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (!isConnected) {
      setUsersRequestingTranscription([]);
      setSubtitles({});
      setRemoteStatuses({});
    }
  }, [isConnected]);

  useEffect(() => {
    if (isRemoteRequestingTranscription && isAudioEnabled) {
      startListening(myLanguage);
    } else {
      stopListening();
    }
  }, [isRemoteRequestingTranscription, isAudioEnabled, myLanguage, startListening, stopListening]);

  useEffect(() => {
    if (connectedPeers.length > 0 && (isTranslationEnabled || isDubbingEnabled)) {
      sendData({
        type: 'control',
        action: 'enable_transcription'
      });
    }
  }, [connectedPeers, isTranslationEnabled, isDubbingEnabled, sendData]);

  useEffect(() => {
    if (connectedPeers.length > 0) {
      sendData({ type: 'status', audio: isAudioEnabled, video: isVideoEnabled });
    }
  }, [connectedPeers, isAudioEnabled, isVideoEnabled, sendData]);

  const handleToggleAudio = () => {
    const newState = toggleAudio();
    setIsAudioEnabled(newState);
  };

  const handleToggleVideo = () => {
    if (isScreenSharing) return; // Prevent toggling camera while screen sharing
    const newState = toggleVideo();
    setIsVideoEnabled(newState);
  };

  const handleToggleTranslation = () => {
    const newState = !isTranslationEnabled;
    setIsTranslationEnabled(newState);
    if (!newState && !isDubbingEnabled) {
      setSubtitles({});
    }
    sendData({
      type: 'control',
      action: (newState || isDubbingEnabled) ? 'enable_transcription' : 'disable_transcription'
    });
  };

  const handleToggleDubbing = () => {
    warmup();
    const newState = !isDubbingEnabled;
    setIsDubbingEnabled(newState);
    if (!newState && !isTranslationEnabled) {
      setSubtitles({});
    }
    sendData({
      type: 'control',
      action: (isTranslationEnabled || newState) ? 'enable_transcription' : 'disable_transcription'
    });
  };

  const languages = [
    { code: 'en-US', name: 'English' },
    { code: 'ar-SA', name: 'Arabic' },
    { code: 'es-ES', name: 'Spanish' },
    { code: 'fr-FR', name: 'French' },
    { code: 'de-DE', name: 'German' },
    { code: 'zh-CN', name: 'Chinese' },
    { code: 'ja-JP', name: 'Japanese' },
    { code: 'hi-IN', name: 'Hindi' },
  ];

  const activePeers = knownPeers.filter(userId => {
    const state = peerStates[userId];
    return state !== 'disconnected' && state !== 'failed' && state !== 'closed';
  });
  const remoteUsersCount = activePeers.length;

  const renderVideoCell = (userId: string, index: number, isPinned: boolean = false) => {
    const stream = remoteStreams[userId];
    const state = peerStates[userId];
    const profile = peerProfiles[userId] || { name: `Peer ${index + 1}`, photo: '' };
    
    return (
      <div key={userId} className={`relative w-full h-full bg-black flex items-center justify-center ${isPinned ? '' : 'rounded-lg overflow-hidden'}`}>
        {stream ? (
          <RemoteVideo stream={stream} isDubbingEnabled={isDubbingEnabled} />
        ) : (
          <div className="flex flex-col items-center justify-center text-zinc-500">
            {state === 'connecting' || state === 'new' ? (
              <>
                <Loader2 className="w-12 h-12 mb-3 animate-spin text-emerald-500/50" />
                <p className="text-sm">Connecting...</p>
              </>
            ) : (
              <>
                <div className="w-16 h-16 bg-zinc-800 rounded-full flex items-center justify-center mb-3">
                  <Users className="w-8 h-8 text-zinc-600" />
                </div>
                <p className="text-sm">No Video</p>
              </>
            )}
          </div>
        )}
        
        {/* User Name Overlay */}
        <div className="absolute bottom-4 left-4 bg-black/50 backdrop-blur-sm px-3 py-1.5 rounded-lg flex items-center gap-2 z-10">
          {profile.photo ? (
            <img src={profile.photo} alt={profile.name} className="w-5 h-5 rounded-full" referrerPolicy="no-referrer" />
          ) : (
            <div className="w-5 h-5 bg-blue-500/20 rounded-full flex items-center justify-center text-[10px] text-blue-500 font-medium">
              {profile.name.charAt(0).toUpperCase()}
            </div>
          )}
          <span className="text-white text-sm font-medium">{profile.name}</span>
        </div>

        {/* Subtitles for this user */}
        {subtitles[userId] && stream && (
          <div className={`absolute ${subtitlePosition} left-1/2 -translate-x-1/2 max-w-[90%] w-max px-4 z-20 text-center transition-all duration-300`}>
            <div className="bg-black/60 backdrop-blur-md rounded-2xl p-3 inline-block border border-white/10 shadow-xl">
              <p className="text-zinc-300 text-xs mb-1">{subtitles[userId].original}</p>
              {subtitles[userId].translated && (
                <p className={`text-emerald-400 font-medium ${subtitleSize}`}>{subtitles[userId].translated}</p>
              )}
            </div>
          </div>
        )}
        
        {/* User Status Overlay */}
        <div className="absolute top-4 right-4 flex gap-2">
          <button 
            onClick={() => setPinnedUserId(pinnedUserId === userId ? null : userId)}
            className="bg-black/50 hover:bg-black/70 transition-colors backdrop-blur-sm p-1.5 rounded-lg text-white"
            title={pinnedUserId === userId ? "Minimize" : "Maximize"}
          >
            {pinnedUserId === userId ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
          </button>
          {stream && remoteStatuses[userId] && !remoteStatuses[userId].audio && (
            <div className="bg-black/50 backdrop-blur-sm p-1.5 rounded-lg">
              <MicOff className="w-4 h-4 text-red-500" />
            </div>
          )}
          {stream && remoteStatuses[userId] && !remoteStatuses[userId].video && (
            <div className="bg-black/50 backdrop-blur-sm p-1.5 rounded-lg">
              <VideoOff className="w-4 h-4 text-red-500" />
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col relative">
      {/* Header */}
      <header className="bg-zinc-900 border-b border-zinc-800 px-6 py-4 flex items-center justify-between z-10">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-emerald-500/10 rounded-xl flex items-center justify-center">
            <Video className="w-5 h-5 text-emerald-500" />
          </div>
          <div>
            <h1 className="text-white font-medium">Room: {roomId}</h1>
            <div className="flex items-center gap-4">
              <p className="text-zinc-400 text-xs flex items-center gap-1.5">
                {socketConnected ? (
                  <Wifi className="w-3.5 h-3.5 text-emerald-500" />
                ) : (
                  <WifiOff className="w-3.5 h-3.5 text-red-500" />
                )}
                {socketConnected ? 'Server Connected' : 'Connecting to Server...'}
              </p>
              <p className="text-zinc-400 text-xs flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
                {isConnected ? `${remoteUsersCount} peer(s) found` : 'Waiting for peers...'}
              </p>
              {mediaError && (
                <p className="text-red-400 text-xs flex items-center gap-1 bg-red-500/10 px-2 py-0.5 rounded">
                  {mediaError}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex flex-col items-end">
            <label className="text-xs text-zinc-500 mb-1">I speak:</label>
            <select 
              value={myLanguage}
              onChange={(e) => setMyLanguage(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              {languages.map(l => (
                <option key={l.code} value={l.code}>{l.name}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col items-end">
            <label className="text-xs text-zinc-500 mb-1">Translate to:</label>
            <select 
              value={selectedLanguage}
              onChange={(e) => setSelectedLanguage(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              {languages.map(l => (
                <option key={l.code} value={l.code}>{l.name}</option>
              ))}
            </select>
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Main Video Area */}
        <main className="flex-1 relative p-4 flex items-center justify-center overflow-hidden">
          {/* Remote Videos Grid */}
          <div className="absolute inset-4 bg-zinc-900 rounded-2xl overflow-hidden border border-zinc-800 shadow-2xl">
            {remoteUsersCount > 0 ? (
              pinnedUserId && pinnedUserId !== 'local' && activePeers.includes(pinnedUserId) ? (
                <div className="w-full h-full flex flex-col md:flex-row bg-zinc-950">
                  {/* Pinned Video */}
                  <div className="flex-1 relative bg-black">
                    {renderVideoCell(pinnedUserId, activePeers.indexOf(pinnedUserId), true)}
                  </div>
                  {/* Sidebar/Bottom bar for others */}
                  <div className="w-full md:w-64 h-48 md:h-full flex md:flex-col gap-1 p-1 overflow-auto bg-zinc-900 border-t md:border-t-0 md:border-l border-zinc-800">
                    {activePeers.filter(id => id !== pinnedUserId).map((userId, index) => (
                      <div key={userId} className="w-48 md:w-full h-32 md:h-40 flex-shrink-0 relative">
                        {renderVideoCell(userId, index)}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className={`w-full h-full grid gap-1 ${
                  remoteUsersCount === 1 ? 'grid-cols-1' : 
                  remoteUsersCount === 2 ? 'grid-cols-2' : 
                  remoteUsersCount <= 4 ? 'grid-cols-2 grid-rows-2' : 
                  'grid-cols-3 grid-rows-3'
                }`}>
                  {activePeers.map((userId, index) => renderVideoCell(userId, index))}
                </div>
              )
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-zinc-500">
                <Users className="w-16 h-16 mb-4 opacity-20" />
                <p>Waiting for someone to join...</p>
              </div>
            )}
          </div>

          {/* Local Video (PiP) */}
          <div className="absolute bottom-8 right-8 w-48 aspect-video bg-zinc-800 rounded-xl overflow-hidden border-2 border-zinc-700 shadow-xl z-20 transition-all duration-300 hover:scale-105">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-cover ${isScreenSharing ? 'object-contain bg-black' : ''}`}
            />
            {!isVideoEnabled && !isScreenSharing && (
              <div className="absolute inset-0 bg-zinc-900 flex items-center justify-center">
                <VideoOff className="w-6 h-6 text-zinc-500" />
              </div>
            )}
            {!isAudioEnabled && (
              <div className="absolute top-2 right-2 bg-black/50 backdrop-blur-sm p-1 rounded-md">
                <MicOff className="w-3 h-3 text-red-500" />
              </div>
            )}
            {isScreenSharing && (
              <div className="absolute top-2 left-2 bg-blue-500/80 backdrop-blur-sm px-2 py-1 rounded-md flex items-center gap-1">
                <MonitorUp className="w-3 h-3 text-white" />
                <span className="text-[10px] font-medium text-white uppercase tracking-wider">Sharing</span>
              </div>
            )}
            <div className="absolute bottom-2 left-2 bg-black/50 backdrop-blur-sm px-2 py-1 rounded-md flex items-center gap-1.5 z-10">
              <span className="text-white text-[10px] font-medium">{currentUser?.displayName || 'You'} (You)</span>
            </div>
          </div>
        </main>

        {/* Participants Sidebar */}
        {showParticipants && (
          <aside className="w-80 bg-zinc-900 border-l border-zinc-800 flex flex-col z-20 shadow-2xl">
            <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
              <h2 className="text-white font-medium flex items-center gap-2">
                <Users className="w-5 h-5 text-emerald-500" />
                Participants ({remoteUsersCount + 1})
              </h2>
              <button onClick={() => setShowParticipants(false)} className="text-zinc-400 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {/* Local User */}
              <div className="flex items-center justify-between bg-zinc-800/50 p-3 rounded-xl border border-zinc-700/50">
                <div className="flex items-center gap-3">
                  {currentUser?.photoURL ? (
                    <img src={currentUser.photoURL} alt="You" className="w-10 h-10 rounded-full border border-emerald-500/30" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-10 h-10 bg-emerald-500/20 rounded-full flex items-center justify-center text-emerald-500 font-medium">
                      {currentUser?.displayName?.charAt(0) || 'Y'}
                    </div>
                  )}
                  <span className="text-white text-sm font-medium">{currentUser?.displayName || 'You'} (You)</span>
                </div>
                <div className="flex items-center gap-2 text-zinc-400">
                  {isAudioEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4 text-red-400" />}
                  {isScreenSharing ? <MonitorUp className="w-4 h-4 text-blue-400" /> : (isVideoEnabled ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4 text-red-400" />)}
                </div>
              </div>

              {/* Remote Users */}
              {knownPeers.map((userId, index) => {
                const status = remoteStatuses[userId] || { audio: true, video: true };
                const state = peerStates[userId];
                const profile = peerProfiles[userId] || { name: `Peer ${index + 1}`, photo: '' };
                
                return (
                  <div key={userId} className="flex items-center justify-between bg-zinc-800/50 p-3 rounded-xl border border-zinc-700/50">
                    <div className="flex items-center gap-3">
                      {profile.photo ? (
                        <img src={profile.photo} alt={profile.name} className="w-10 h-10 rounded-full border border-blue-500/30" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="w-10 h-10 bg-blue-500/20 rounded-full flex items-center justify-center text-blue-500 font-medium">
                          {profile.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="flex flex-col">
                        <span className="text-white text-sm font-medium">{profile.name}</span>
                        <span className={`text-xs ${state === 'connected' ? 'text-emerald-500' : state === 'failed' ? 'text-red-500' : 'text-amber-500'}`}>
                          {state}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-zinc-400">
                      {status.audio ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4 text-red-400" />}
                      {status.video ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4 text-red-400" />}
                    </div>
                  </div>
                );
              })}
            </div>
          </aside>
        )}

        {/* Chat History Sidebar */}
        {showChat && (
          <aside className="w-80 bg-zinc-900 border-l border-zinc-800 flex flex-col z-20 shadow-2xl">
            <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
              <h2 className="text-white font-medium flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-emerald-500" />
                Chat History
              </h2>
              <button onClick={() => setShowChat(false)} className="text-zinc-400 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-zinc-500">
                  <MessageSquare className="w-12 h-12 mb-3 opacity-20" />
                  <p className="text-sm text-center">No messages yet.<br/>Start speaking to see transcript.</p>
                </div>
              ) : (
                messages.map((msg) => {
                  const isMe = msg.senderId === currentUser?.uid;
                  return (
                    <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                      <div className="flex items-center gap-2 mb-1">
                        {!isMe && (
                          msg.senderPhoto ? (
                            <img src={msg.senderPhoto} alt={msg.senderName} className="w-5 h-5 rounded-full" referrerPolicy="no-referrer" />
                          ) : (
                            <div className="w-5 h-5 rounded-full bg-blue-500/20 flex items-center justify-center text-[10px] text-blue-500 font-medium">
                              {msg.senderName.charAt(0)}
                            </div>
                          )
                        )}
                        <span className="text-xs text-zinc-500">
                          {isMe ? 'You' : msg.senderName}
                          {msg.recipientId && <span className="text-amber-500 ml-1">(Private)</span>}
                        </span>
                      </div>
                      <div className={`px-3 py-2 rounded-2xl max-w-[85%] ${
                        isMe 
                          ? 'bg-emerald-500 text-white rounded-tr-sm' 
                          : 'bg-zinc-800 text-zinc-200 rounded-tl-sm border border-zinc-700/50'
                      }`}>
                        <p className="text-sm">{msg.originalText}</p>
                        {messageTranslations[msg.id] && (
                          <div className={`mt-2 pt-2 border-t ${isMe ? 'border-white/20' : 'border-zinc-700'}`}>
                            {messageTranslations[msg.id].isLoading ? (
                              <div className="flex items-center gap-1 text-xs opacity-70">
                                <Loader2 className="w-3 h-3 animate-spin" /> Translating...
                              </div>
                            ) : (
                              <p className={`text-sm ${isMe ? 'text-emerald-100' : 'text-emerald-400'}`}>
                                {messageTranslations[msg.id].text}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                      {!isMe && !messageTranslations[msg.id] && (
                        <button 
                          onClick={() => handleTranslateMessage(msg.id, msg.originalText)}
                          className="text-[10px] text-zinc-500 hover:text-emerald-400 mt-1 ml-8 transition-colors flex items-center gap-1"
                        >
                          <Languages className="w-3 h-3" /> Translate
                        </button>
                      )}
                    </div>
                  );
                })
              )}
              <div ref={chatEndRef} />
            </div>
            <div className="p-4 border-t border-zinc-800 bg-zinc-900/50 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-400">To:</span>
                <select
                  value={chatRecipient || ''}
                  onChange={(e) => setChatRecipient(e.target.value || null)}
                  className="bg-zinc-800 border border-zinc-700 text-white text-xs rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500 flex-1"
                >
                  <option value="">Everyone</option>
                  {activePeers.map(userId => {
                    const profile = peerProfiles[userId] || { name: 'Unknown' };
                    return <option key={userId} value={userId}>{profile.name}</option>;
                  })}
                </select>
              </div>
              <form onSubmit={handleSendMessage} className="flex gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Type a message..."
                  className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-colors"
                />
                <button
                  type="submit"
                  disabled={!chatInput.trim()}
                  className="bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl px-3 py-2 transition-colors flex items-center justify-center"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </div>
          </aside>
        )}
      </div>

      {/* Controls */}
      <footer className="bg-zinc-900 border-t border-zinc-800 p-6 flex justify-center gap-4 z-10">
        <button
          onClick={handleToggleAudio}
          className={`w-14 h-14 rounded-full flex items-center justify-center transition-all relative group ${
            isAudioEnabled ? 'bg-zinc-800 hover:bg-zinc-700 text-white' : 'bg-red-500/20 text-red-500 hover:bg-red-500/30'
          }`}
        >
          {isAudioEnabled ? <Mic className="w-6 h-6" /> : <MicOff className="w-6 h-6" />}
          <span className="absolute -top-10 bg-zinc-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
            {isAudioEnabled ? "Mute Microphone" : "Unmute Microphone"}
          </span>
        </button>

        <button
          onClick={handleToggleVideo}
          disabled={isScreenSharing}
          className={`w-14 h-14 rounded-full flex items-center justify-center transition-all relative group ${
            isScreenSharing ? 'bg-zinc-800/50 text-zinc-600 cursor-not-allowed' :
            isVideoEnabled ? 'bg-zinc-800 hover:bg-zinc-700 text-white' : 'bg-red-500/20 text-red-500 hover:bg-red-500/30'
          }`}
        >
          {isVideoEnabled ? <Video className="w-6 h-6" /> : <VideoOff className="w-6 h-6" />}
          <span className="absolute -top-10 bg-zinc-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
            {isScreenSharing ? "Camera disabled while sharing" : isVideoEnabled ? "Turn Off Camera" : "Turn On Camera"}
          </span>
        </button>

        <button
          onClick={toggleScreenShare}
          className={`w-14 h-14 rounded-full flex items-center justify-center transition-all relative group ${
            isScreenSharing 
              ? 'bg-blue-500 text-white shadow-[0_0_20px_rgba(59,130,246,0.4)]' 
              : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400'
          }`}
        >
          {isScreenSharing ? <MonitorOff className="w-6 h-6" /> : <MonitorUp className="w-6 h-6" />}
          <span className="absolute -top-10 bg-zinc-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
            {isScreenSharing ? "Stop Sharing" : "Share Screen"}
          </span>
        </button>

        <div className="w-px h-14 bg-zinc-800 mx-2"></div>

        <button
          onClick={handleToggleTranslation}
          className={`w-14 h-14 rounded-full flex items-center justify-center transition-all relative group ${
            isTranslationEnabled 
              ? 'bg-blue-500 text-white shadow-[0_0_20px_rgba(59,130,246,0.4)]' 
              : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400'
          }`}
        >
          <Languages className="w-6 h-6" />
          <span className="absolute -top-10 bg-zinc-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
            {isTranslationEnabled ? "Disable Subtitles" : "Enable Subtitles"}
          </span>
        </button>

        <button
          onClick={handleToggleDubbing}
          className={`w-14 h-14 rounded-full flex items-center justify-center transition-all relative group ${
            isDubbingEnabled 
              ? 'bg-emerald-500 text-white shadow-[0_0_20px_rgba(16,185,129,0.4)]' 
              : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400'
          }`}
        >
          <Bot className="w-6 h-6" />
          <span className="absolute -top-10 bg-zinc-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
            {isDubbingEnabled ? "Disable AI Voice (Unmute Peer)" : "Enable AI Voice (Mute Peer)"}
          </span>
        </button>

        <div className="w-px h-14 bg-zinc-800 mx-2"></div>

        <button
          onClick={() => {
            setShowParticipants(!showParticipants);
            if (!showParticipants) setShowChat(false);
          }}
          className={`w-14 h-14 rounded-full flex items-center justify-center transition-all relative group ${
            showParticipants 
              ? 'bg-zinc-700 text-white' 
              : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400'
          }`}
        >
          <Users className="w-6 h-6" />
          <span className="absolute -top-10 bg-zinc-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
            Participants
          </span>
        </button>

        <button
          onClick={() => {
            setShowChat(!showChat);
            if (!showChat) setShowParticipants(false);
          }}
          className={`w-14 h-14 rounded-full flex items-center justify-center transition-all relative group ${
            showChat 
              ? 'bg-zinc-700 text-white' 
              : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400'
          }`}
        >
          <MessageSquare className="w-6 h-6" />
          <span className="absolute -top-10 bg-zinc-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
            Chat History
          </span>
        </button>

        <button
          onClick={() => setShowSettings(true)}
          className="w-14 h-14 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-400 flex items-center justify-center transition-all relative group"
        >
          <Settings className="w-6 h-6" />
          <span className="absolute -top-10 bg-zinc-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
            Settings
          </span>
        </button>

        <div className="w-px h-14 bg-zinc-800 mx-2"></div>

        <button
          onClick={onLeave}
          className="w-14 h-14 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center transition-all shadow-[0_0_20px_rgba(239,68,68,0.4)] relative group"
        >
          <PhoneOff className="w-6 h-6" />
          <span className="absolute -top-10 bg-zinc-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
            End Call
          </span>
        </button>
      </footer>

      {/* Settings Modal */}
      {showSettings && (
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-medium text-white flex items-center gap-2">
                <Settings className="w-5 h-5 text-emerald-500" />
                Subtitle Settings
              </h2>
              <button onClick={() => setShowSettings(false)} className="text-zinc-400 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-medium text-zinc-300 mb-3">Font Size</h3>
                <div className="flex gap-2">
                  {(['text-sm', 'text-base', 'text-lg'] as const).map(size => (
                    <button
                      key={size}
                      onClick={() => setSubtitleSize(size)}
                      className={`flex-1 py-2 rounded-lg border transition-colors ${
                        subtitleSize === size 
                          ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400' 
                          : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700'
                      }`}
                    >
                      {size === 'text-sm' ? 'Small' : size === 'text-base' ? 'Medium' : 'Large'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium text-zinc-300 mb-3">Position</h3>
                <div className="flex gap-2">
                  {(['top-4', 'bottom-4'] as const).map(pos => (
                    <button
                      key={pos}
                      onClick={() => setSubtitlePosition(pos)}
                      className={`flex-1 py-2 rounded-lg border transition-colors ${
                        subtitlePosition === pos 
                          ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400' 
                          : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700'
                      }`}
                    >
                      {pos === 'top-4' ? 'Top' : 'Bottom'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
