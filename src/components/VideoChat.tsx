import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Mic, MicOff, Video, VideoOff, PhoneOff, Languages, Volume2, VolumeX, Users } from 'lucide-react';
import { useWebRTC } from '../hooks/useWebRTC';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { translateText } from '../services/geminiService';

interface VideoChatProps {
  roomId: string;
  onLeave: () => void;
}

export function VideoChat({ roomId, onLeave }: VideoChatProps) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isTranslationEnabled, setIsTranslationEnabled] = useState(false);
  const [isRemoteRequestingTranscription, setIsRemoteRequestingTranscription] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState('ar-SA');
  const [myLanguage, setMyLanguage] = useState('en-US');
  
  const [subtitles, setSubtitles] = useState<{ original: string, translated?: string } | null>(null);

  const { speak, voices } = useSpeechSynthesis();

  const handleDataReceived = useCallback(async (data: any) => {
    if (data.type === 'control') {
      if (data.action === 'enable_transcription') {
        setIsRemoteRequestingTranscription(true);
      } else if (data.action === 'disable_transcription') {
        setIsRemoteRequestingTranscription(false);
      }
    } else if (data.type === 'speech') {
      const { text, lang } = data;
      
      if (isTranslationEnabled) {
        setSubtitles({ original: text, translated: 'Translating...' });
        const translated = await translateText(text, selectedLanguage);
        setSubtitles({ original: text, translated });
        speak(translated, selectedLanguage);
      } else {
        setSubtitles({ original: text });
      }
    }
  }, [isTranslationEnabled, selectedLanguage, speak]);

  const {
    localStream,
    remoteStream,
    isConnected,
    isDataChannelOpen,
    mediaError,
    startLocalStream,
    sendData,
    toggleAudio,
    toggleVideo
  } = useWebRTC(roomId, handleDataReceived);

  const handleSpeechResult = useCallback((text: string) => {
    // Send my speech to the other peer
    sendData({ type: 'speech', text, lang: myLanguage });
  }, [sendData, myLanguage]);

  const { isListening, startListening, stopListening } = useSpeechRecognition(handleSpeechResult);

  useEffect(() => {
    startLocalStream();
  }, []);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  useEffect(() => {
    if (isRemoteRequestingTranscription && isAudioEnabled) {
      startListening(myLanguage);
    } else {
      stopListening();
    }
  }, [isRemoteRequestingTranscription, isAudioEnabled, myLanguage, startListening, stopListening]);

  useEffect(() => {
    if (isDataChannelOpen && isTranslationEnabled) {
      sendData({
        type: 'control',
        action: 'enable_transcription'
      });
    }
  }, [isDataChannelOpen, isTranslationEnabled, sendData]);

  const handleToggleAudio = () => {
    const newState = toggleAudio();
    setIsAudioEnabled(newState);
  };

  const handleToggleVideo = () => {
    const newState = toggleVideo();
    setIsVideoEnabled(newState);
  };

  const handleToggleTranslation = () => {
    const newState = !isTranslationEnabled;
    setIsTranslationEnabled(newState);
    sendData({
      type: 'control',
      action: newState ? 'enable_transcription' : 'disable_transcription'
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

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col">
      {/* Header */}
      <header className="bg-zinc-900 border-b border-zinc-800 px-6 py-4 flex items-center justify-between z-10">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-emerald-500/10 rounded-xl flex items-center justify-center">
            <Video className="w-5 h-5 text-emerald-500" />
          </div>
          <div>
            <h1 className="text-white font-medium">Room: {roomId}</h1>
            <div className="flex items-center gap-2">
              <p className="text-zinc-400 text-xs flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
                {isConnected ? 'Connected' : 'Waiting for peer...'}
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

      {/* Main Video Area */}
      <main className="flex-1 relative p-4 flex items-center justify-center overflow-hidden">
        {/* Remote Video (Full Screen) */}
        <div className="absolute inset-4 bg-zinc-900 rounded-2xl overflow-hidden border border-zinc-800 shadow-2xl">
          {remoteStream ? (
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-zinc-500">
              <Users className="w-16 h-16 mb-4 opacity-20" />
              <p>Waiting for someone to join...</p>
            </div>
          )}
        </div>

        {/* Local Video (PiP) */}
        <div className="absolute bottom-8 right-8 w-48 aspect-video bg-zinc-800 rounded-xl overflow-hidden border-2 border-zinc-700 shadow-xl z-20">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
          {!isVideoEnabled && (
            <div className="absolute inset-0 bg-zinc-900 flex items-center justify-center">
              <VideoOff className="w-6 h-6 text-zinc-500" />
            </div>
          )}
        </div>

        {/* Subtitles Overlay */}
        {subtitles && (
          <div className="absolute bottom-24 left-1/2 -translate-x-1/2 max-w-2xl w-full px-4 z-20 text-center">
            <div className="bg-black/60 backdrop-blur-md rounded-2xl p-4 inline-block border border-white/10 shadow-2xl">
              <p className="text-zinc-300 text-sm mb-1">{subtitles.original}</p>
              {subtitles.translated && (
                <p className="text-emerald-400 text-lg font-medium">{subtitles.translated}</p>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Controls */}
      <footer className="bg-zinc-900 border-t border-zinc-800 p-6 flex justify-center gap-4 z-10">
        <button
          onClick={handleToggleAudio}
          className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${
            isAudioEnabled ? 'bg-zinc-800 hover:bg-zinc-700 text-white' : 'bg-red-500/20 text-red-500 hover:bg-red-500/30'
          }`}
        >
          {isAudioEnabled ? <Mic className="w-6 h-6" /> : <MicOff className="w-6 h-6" />}
        </button>

        <button
          onClick={handleToggleVideo}
          className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${
            isVideoEnabled ? 'bg-zinc-800 hover:bg-zinc-700 text-white' : 'bg-red-500/20 text-red-500 hover:bg-red-500/30'
          }`}
        >
          {isVideoEnabled ? <Video className="w-6 h-6" /> : <VideoOff className="w-6 h-6" />}
        </button>

        <button
          onClick={handleToggleTranslation}
          className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${
            isTranslationEnabled 
              ? 'bg-emerald-500 text-white shadow-[0_0_20px_rgba(16,185,129,0.4)]' 
              : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400'
          }`}
          title={isTranslationEnabled ? "Disable Dubbing" : "Enable Dubbing"}
        >
          <Languages className="w-6 h-6" />
        </button>

        <div className="w-px h-14 bg-zinc-800 mx-2"></div>

        <button
          onClick={onLeave}
          className="w-14 h-14 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center transition-all shadow-[0_0_20px_rgba(239,68,68,0.4)]"
        >
          <PhoneOff className="w-6 h-6" />
        </button>
      </footer>
    </div>
  );
}
