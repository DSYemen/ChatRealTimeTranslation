import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

export function useWebRTC(
  roomId: string, 
  onDataReceived: (data: any, userId: string) => void
) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [connectedPeers, setConnectedPeers] = useState<string[]>([]);
  const [peerStates, setPeerStates] = useState<Record<string, RTCPeerConnectionState>>({});
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [mediaInitialized, setMediaInitialized] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  
  const socketRef = useRef<Socket | null>(null);
  const peersRef = useRef<Record<string, RTCPeerConnection>>({});
  const dataChannelsRef = useRef<Record<string, RTCDataChannel>>({});
  const localStreamRef = useRef<MediaStream | null>(null);
  const cameraVideoTrackRef = useRef<MediaStreamTrack | null>(null);
  const screenVideoTrackRef = useRef<MediaStreamTrack | null>(null);
  const iceCandidateQueueRef = useRef<Record<string, RTCIceCandidateInit[]>>({});
  const onDataReceivedRef = useRef(onDataReceived);

  useEffect(() => {
    onDataReceivedRef.current = onDataReceived;
  }, [onDataReceived]);

  useEffect(() => {
    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  useEffect(() => {
    if (!roomId || !mediaInitialized) return;

    socketRef.current = io({
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    socketRef.current.on('connect', () => {
      console.log('Connected to signaling server with ID:', socketRef.current?.id);
      setSocketConnected(true);
      socketRef.current?.emit('join-room', roomId);
    });

    socketRef.current.on('disconnect', () => {
      console.log('Disconnected from signaling server');
      setSocketConnected(false);
    });

    socketRef.current.on('connect_error', (err) => {
      // Socket.io will automatically try to reconnect
      // Downgrade to warn to avoid cluttering the console with expected network blips
      console.warn('Socket connection warning:', err.message);
      setSocketConnected(false);
    });

    socketRef.current.on('room-users', async (users: string[]) => {
      console.log('Existing users in room:', users);
      for (const userId of users) {
        if (userId !== socketRef.current?.id) {
          await createPeerConnection(userId, true);
        }
      }
    });

    socketRef.current.on('user-connected', (userId) => {
      console.log('User connected:', userId);
      // We don't initiate here anymore. We wait for their offer.
      // But we can set their initial state so the UI knows they are here.
      setPeerStates(prev => ({ ...prev, [userId]: 'new' }));
    });

    socketRef.current.on('user-disconnected', (userId) => {
      console.log('User disconnected:', userId);
      if (peersRef.current[userId]) {
        peersRef.current[userId].close();
        delete peersRef.current[userId];
      }
      if (dataChannelsRef.current[userId]) {
        delete dataChannelsRef.current[userId];
      }
      if (iceCandidateQueueRef.current[userId]) {
        delete iceCandidateQueueRef.current[userId];
      }
      setRemoteStreams(prev => {
        const newStreams = { ...prev };
        delete newStreams[userId];
        return newStreams;
      });
      setPeerStates(prev => {
        const newStates = { ...prev };
        delete newStates[userId];
        return newStates;
      });
      setConnectedPeers(prev => prev.filter(id => id !== userId));
    });

    socketRef.current.on('offer', async (payload) => {
      console.log('Received offer from', payload.caller);
      if (!peersRef.current[payload.caller]) {
        await createPeerConnection(payload.caller, false);
      }
      const pc = peersRef.current[payload.caller];
      if (pc) {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          
          // Process queued ICE candidates
          if (iceCandidateQueueRef.current[payload.caller]) {
            for (const candidate of iceCandidateQueueRef.current[payload.caller]) {
              try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
              } catch (e) {
                console.error('Error adding queued ice candidate', e);
              }
            }
            iceCandidateQueueRef.current[payload.caller] = [];
          }

          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socketRef.current?.emit('answer', {
            target: payload.caller,
            caller: socketRef.current?.id,
            sdp: pc.localDescription
          });
        } catch (err) {
          console.error('Error handling offer:', err);
        }
      }
    });

    socketRef.current.on('answer', async (payload) => {
      console.log('Received answer from', payload.caller);
      const pc = peersRef.current[payload.caller];
      if (pc) {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          
          // Process queued ICE candidates
          if (iceCandidateQueueRef.current[payload.caller]) {
            for (const candidate of iceCandidateQueueRef.current[payload.caller]) {
              try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
              } catch (e) {
                console.error('Error adding queued ice candidate', e);
              }
            }
            iceCandidateQueueRef.current[payload.caller] = [];
          }
        } catch (err) {
          console.error('Error handling answer:', err);
        }
      }
    });

    socketRef.current.on('ice-candidate', async (incoming) => {
      try {
        const pc = peersRef.current[incoming.caller];
        if (pc) {
          if (pc.remoteDescription) {
            await pc.addIceCandidate(new RTCIceCandidate(incoming.candidate));
          } else {
            if (!iceCandidateQueueRef.current[incoming.caller]) {
              iceCandidateQueueRef.current[incoming.caller] = [];
            }
            iceCandidateQueueRef.current[incoming.caller].push(incoming.candidate);
          }
        }
      } catch (e) {
        console.error('Error adding received ice candidate', e);
      }
    });

    return () => {
      socketRef.current?.disconnect();
      Object.values(peersRef.current).forEach(pc => pc.close());
      peersRef.current = {};
    };
  }, [roomId, mediaInitialized]);

  const createPeerConnection = async (targetUserId: string, isInitiator: boolean) => {
    if (peersRef.current[targetUserId]) {
      console.log('Peer connection already exists for', targetUserId);
      return;
    }

    const configuration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' }
      ]
    };

    const pc = new RTCPeerConnection(configuration);
    peersRef.current[targetUserId] = pc;
    iceCandidateQueueRef.current[targetUserId] = [];
    setPeerStates(prev => ({ ...prev, [targetUserId]: pc.connectionState }));

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current?.emit('ice-candidate', {
          target: targetUserId,
          caller: socketRef.current?.id,
          candidate: event.candidate
        });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`Connection state with ${targetUserId}:`, pc.connectionState);
      setPeerStates(prev => ({ ...prev, [targetUserId]: pc.connectionState }));
      
      if (pc.connectionState === 'connected') {
        setConnectedPeers(prev => prev.includes(targetUserId) ? prev : [...prev, targetUserId]);
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        setConnectedPeers(prev => prev.filter(id => id !== targetUserId));
        if (pc.connectionState === 'closed') {
          setRemoteStreams(prev => {
            const newStreams = { ...prev };
            delete newStreams[targetUserId];
            return newStreams;
          });
        }
      }
    };

    pc.ontrack = (event) => {
      console.log('Received remote track from', targetUserId, event.track.kind);
      setRemoteStreams(prev => ({
        ...prev,
        [targetUserId]: event.streams[0]
      }));
    };

    if (isInitiator) {
      const dc = pc.createDataChannel('chat');
      setupDataChannel(dc, targetUserId);
    } else {
      pc.ondatachannel = (event) => {
        setupDataChannel(event.channel, targetUserId);
      };
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    if (isInitiator) {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socketRef.current?.emit('offer', {
          target: targetUserId,
          caller: socketRef.current?.id,
          sdp: pc.localDescription
        });
      } catch (err) {
        console.error('Error creating offer:', err);
      }
    }
  };

  const setupDataChannel = (dc: RTCDataChannel, targetUserId: string) => {
    dataChannelsRef.current[targetUserId] = dc;
    dc.onopen = () => {
      console.log('Data channel opened with', targetUserId);
      setConnectedPeers(prev => {
        if (!prev.includes(targetUserId)) return [...prev, targetUserId];
        return prev;
      });
    };
    dc.onclose = () => {
      console.log('Data channel closed with', targetUserId);
      setConnectedPeers(prev => prev.filter(id => id !== targetUserId));
      delete dataChannelsRef.current[targetUserId];
    };
    dc.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onDataReceivedRef.current(data, targetUserId);
      } catch (e) {
        console.error('Error parsing data channel message', e);
      }
    };
  };

  const startLocalStream = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setLocalStream(stream);
      localStreamRef.current = stream;
      cameraVideoTrackRef.current = stream.getVideoTracks()[0] || null;
      setMediaError(null);
    } catch (err: any) {
      console.error('Error accessing media devices.', err);
      setMediaError(err.message || 'Could not access camera/microphone.');
      
      // Fallback to audio only
      try {
        const audioStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
        setLocalStream(audioStream);
        localStreamRef.current = audioStream;
        setMediaError('Camera not available. Using microphone only.');
      } catch (audioErr: any) {
        console.error('Error accessing audio device.', audioErr);
        setMediaError('Could not access camera or microphone. Please check permissions.');
      }
    } finally {
      setMediaInitialized(true);
    }
  };

  const sendData = useCallback((data: any, targetUserId?: string) => {
    const message = JSON.stringify(data);
    if (targetUserId) {
      const dc = dataChannelsRef.current[targetUserId];
      if (dc && dc.readyState === 'open') {
        dc.send(message);
      }
    } else {
      Object.values(dataChannelsRef.current).forEach(dc => {
        if (dc.readyState === 'open') {
          dc.send(message);
        }
      });
    }
  }, []);

  const toggleAudio = useCallback(() => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        return audioTrack.enabled;
      }
    }
    return false;
  }, []);

  const toggleVideo = useCallback(() => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        return videoTrack.enabled;
      }
    }
    return false;
  }, []);

  const stopScreenShare = useCallback(() => {
    if (screenVideoTrackRef.current) {
      screenVideoTrackRef.current.stop();
      screenVideoTrackRef.current = null;
    }
    
    const cameraTrack = cameraVideoTrackRef.current;
    if (cameraTrack && localStreamRef.current) {
      Object.values(peersRef.current).forEach(pc => {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (sender) {
          sender.replaceTrack(cameraTrack);
        }
      });
      
      const currentVideoTrack = localStreamRef.current.getVideoTracks()[0];
      if (currentVideoTrack) {
        localStreamRef.current.removeTrack(currentVideoTrack);
      }
      localStreamRef.current.addTrack(cameraTrack);
      
      setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
    }
    setIsScreenSharing(false);
  }, []);

  const toggleScreenShare = useCallback(async () => {
    if (isScreenSharing) {
      stopScreenShare();
    } else {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = screenStream.getVideoTracks()[0];
        screenVideoTrackRef.current = screenTrack;
        
        screenTrack.onended = () => {
          stopScreenShare();
        };
        
        if (localStreamRef.current) {
          Object.values(peersRef.current).forEach(pc => {
            const sender = pc.getSenders().find(s => s.track?.kind === 'video');
            if (sender) {
              sender.replaceTrack(screenTrack);
            }
          });
          
          const currentVideoTrack = localStreamRef.current.getVideoTracks()[0];
          if (currentVideoTrack) {
            localStreamRef.current.removeTrack(currentVideoTrack);
          }
          localStreamRef.current.addTrack(screenTrack);
          
          setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
        }
        
        setIsScreenSharing(true);
      } catch (err) {
        console.error('Error sharing screen:', err);
      }
    }
  }, [isScreenSharing, stopScreenShare]);

  return { 
    localStream, 
    remoteStreams, 
    connectedPeers,
    peerStates,
    mediaError,
    socketConnected,
    isScreenSharing,
    startLocalStream, 
    sendData,
    toggleAudio,
    toggleVideo,
    toggleScreenShare
  };
}
