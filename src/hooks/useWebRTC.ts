import { useEffect, useRef, useState, useCallback } from 'react';
import { collection, doc, setDoc, deleteDoc, onSnapshot, query, where, addDoc, serverTimestamp, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';

export function useWebRTC(
  roomId: string, 
  userId: string,
  userName: string,
  userPhoto: string,
  onDataReceived: (data: any, userId: string) => void
) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [connectedPeers, setConnectedPeers] = useState<string[]>([]);
  const [peerStates, setPeerStates] = useState<Record<string, RTCPeerConnectionState>>({});
  const [peerProfiles, setPeerProfiles] = useState<Record<string, { name: string, photo: string }>>({});
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [mediaInitialized, setMediaInitialized] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  
  const peersRef = useRef<Record<string, RTCPeerConnection>>({});
  const dataChannelsRef = useRef<Record<string, RTCDataChannel>>({});
  const localStreamRef = useRef<MediaStream | null>(null);
  const cameraVideoTrackRef = useRef<MediaStreamTrack | null>(null);
  const screenVideoTrackRef = useRef<MediaStreamTrack | null>(null);
  const iceCandidateQueueRef = useRef<Record<string, RTCIceCandidateInit[]>>({});
  const onDataReceivedRef = useRef(onDataReceived);
  const joinedAtRef = useRef<number>(Date.now());

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
    if (!roomId || !userId || !mediaInitialized || !db) return;

    const setupSignaling = async () => {
      setSocketConnected(true);
      joinedAtRef.current = Date.now();

      // 1. Add self to participants
      const participantRef = doc(db, 'rooms', roomId, 'participants', userId);
      await setDoc(participantRef, { 
        joinedAt: joinedAtRef.current,
        name: userName,
        photo: userPhoto
      });

      // 2. Get existing participants and connect to them (we are the initiator)
      const participantsSnap = await getDocs(collection(db, 'rooms', roomId, 'participants'));
      participantsSnap.forEach(async (docSnap) => {
        const peerId = docSnap.id;
        if (peerId !== userId) {
          const peerData = docSnap.data();
          setPeerProfiles(prev => ({ ...prev, [peerId]: { name: peerData.name || 'Unknown', photo: peerData.photo || '' } }));
          // If they joined before us, we initiate the connection to them
          if (peerData.joinedAt < joinedAtRef.current) {
            await createPeerConnection(peerId, true);
          }
        }
      });

      // 3. Listen for new participants joining after us
      const unsubscribeParticipants = onSnapshot(collection(db, 'rooms', roomId, 'participants'), (snapshot) => {
        snapshot.docChanges().forEach(async (change) => {
          const peerId = change.doc.id;
          if (peerId === userId) return;

          if (change.type === 'added') {
            const peerData = change.doc.data();
            setPeerProfiles(prev => ({ ...prev, [peerId]: { name: peerData.name || 'Unknown', photo: peerData.photo || '' } }));
            // If they joined after us, they will initiate, but we set their state to 'new'
            if (peerData.joinedAt > joinedAtRef.current) {
              setPeerStates(prev => ({ ...prev, [peerId]: 'new' }));
            }
          } else if (change.type === 'removed') {
            handlePeerDisconnected(peerId);
          }
        });
      });

      // 4. Listen for incoming signals
      const signalsQuery = query(collection(db, 'rooms', roomId, 'signals'), where('target', '==', userId));
      const unsubscribeSignals = onSnapshot(signalsQuery, async (snapshot) => {
        snapshot.docChanges().forEach(async (change) => {
          if (change.type === 'added') {
            const signal = change.doc.data();
            const senderId = signal.sender;
            
            // Delete the signal after processing to keep the collection clean
            deleteDoc(change.doc.ref).catch(console.error);

            if (signal.type === 'offer') {
              if (!peersRef.current[senderId]) {
                await createPeerConnection(senderId, false);
              }
              const pc = peersRef.current[senderId];
              if (pc) {
                try {
                  if (pc.signalingState !== 'stable') {
                    console.warn(`Ignoring offer from ${senderId} because state is ${pc.signalingState}`);
                    return;
                  }
                  await pc.setRemoteDescription(new RTCSessionDescription(signal.data));
                  
                  if (iceCandidateQueueRef.current[senderId]) {
                    for (const candidate of iceCandidateQueueRef.current[senderId]) {
                      try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) {}
                    }
                    iceCandidateQueueRef.current[senderId] = [];
                  }

                  const answer = await pc.createAnswer();
                  await pc.setLocalDescription(answer);
                  sendSignal(senderId, 'answer', pc.localDescription);
                } catch (err) {
                  console.error('Error handling offer:', err);
                }
              }
            } else if (signal.type === 'answer') {
              const pc = peersRef.current[senderId];
              if (pc) {
                try {
                  if (pc.signalingState !== 'have-local-offer') {
                    console.warn(`Ignoring answer from ${senderId} because state is ${pc.signalingState}`);
                    return;
                  }
                  await pc.setRemoteDescription(new RTCSessionDescription(signal.data));
                  if (iceCandidateQueueRef.current[senderId]) {
                    for (const candidate of iceCandidateQueueRef.current[senderId]) {
                      try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) {}
                    }
                    iceCandidateQueueRef.current[senderId] = [];
                  }
                } catch (err) {
                  console.error('Error handling answer:', err);
                }
              }
            } else if (signal.type === 'ice-candidate') {
              const pc = peersRef.current[senderId];
              if (pc) {
                if (pc.remoteDescription) {
                  try { await pc.addIceCandidate(new RTCIceCandidate(signal.data)); } catch (e) {}
                } else {
                  if (!iceCandidateQueueRef.current[senderId]) iceCandidateQueueRef.current[senderId] = [];
                  iceCandidateQueueRef.current[senderId].push(signal.data);
                }
              }
            }
          }
        });
      });

      return () => {
        unsubscribeParticipants();
        unsubscribeSignals();
        deleteDoc(participantRef).catch(console.error);
      };
    };

    const cleanup = setupSignaling();

    return () => {
      cleanup.then(unsub => unsub && unsub());
      Object.values(peersRef.current).forEach(pc => pc.close());
      peersRef.current = {};
      setSocketConnected(false);
    };
  }, [roomId, userId, mediaInitialized]);

  const sendSignal = async (targetId: string, type: string, data: any) => {
    if (!db) return;
    try {
      await addDoc(collection(db, 'rooms', roomId, 'signals'), {
        sender: userId,
        target: targetId,
        type,
        data: JSON.parse(JSON.stringify(data)), // Ensure it's a plain object
        timestamp: serverTimestamp()
      });
    } catch (err) {
      console.error('Error sending signal:', err);
    }
  };

  const handlePeerDisconnected = (peerId: string) => {
    if (peersRef.current[peerId]) {
      peersRef.current[peerId].close();
      delete peersRef.current[peerId];
    }
    if (dataChannelsRef.current[peerId]) delete dataChannelsRef.current[peerId];
    if (iceCandidateQueueRef.current[peerId]) delete iceCandidateQueueRef.current[peerId];
    
    setRemoteStreams(prev => {
      const newStreams = { ...prev };
      delete newStreams[peerId];
      return newStreams;
    });
    setPeerStates(prev => {
      const newStates = { ...prev };
      delete newStates[peerId];
      return newStates;
    });
    setConnectedPeers(prev => prev.filter(id => id !== peerId));
  };

  const createPeerConnection = async (targetUserId: string, isInitiator: boolean) => {
    if (peersRef.current[targetUserId]) return;

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
        sendSignal(targetUserId, 'ice-candidate', event.candidate);
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      setPeerStates(prev => ({ ...prev, [targetUserId]: state }));
      
      if (state === 'connected') {
        setConnectedPeers(prev => prev.includes(targetUserId) ? prev : [...prev, targetUserId]);
      } else if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        handlePeerDisconnected(targetUserId);
      }
    };

    pc.ontrack = (event) => {
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
        sendSignal(targetUserId, 'offer', pc.localDescription);
      } catch (err) {
        console.error('Error creating offer:', err);
      }
    }
  };

  const setupDataChannel = (dc: RTCDataChannel, targetUserId: string) => {
    dataChannelsRef.current[targetUserId] = dc;
    dc.onopen = () => {
      setConnectedPeers(prev => prev.includes(targetUserId) ? prev : [...prev, targetUserId]);
    };
    dc.onclose = () => {
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
    peerProfiles,
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
