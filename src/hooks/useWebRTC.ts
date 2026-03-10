import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

export function useWebRTC(roomId: string, onDataReceived: (data: any) => void) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isDataChannelOpen, setIsDataChannelOpen] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  
  const socketRef = useRef<Socket | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const onDataReceivedRef = useRef(onDataReceived);

  useEffect(() => {
    onDataReceivedRef.current = onDataReceived;
  }, [onDataReceived]);

  useEffect(() => {
    if (!roomId) return;

    socketRef.current = io();

    socketRef.current.on('connect', () => {
      console.log('Connected to signaling server');
      socketRef.current?.emit('join-room', roomId);
    });

    socketRef.current.on('user-connected', async (userId) => {
      console.log('User connected:', userId);
      setIsConnected(true);
      await createPeerConnection(userId, true);
    });

    socketRef.current.on('user-disconnected', (userId) => {
      console.log('User disconnected:', userId);
      setIsConnected(false);
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
      setRemoteStream(null);
    });

    socketRef.current.on('offer', async (payload) => {
      console.log('Received offer');
      setIsConnected(true);
      await createPeerConnection(payload.caller, false);
      await peerConnectionRef.current?.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      const answer = await peerConnectionRef.current?.createAnswer();
      await peerConnectionRef.current?.setLocalDescription(answer);
      socketRef.current?.emit('answer', {
        target: payload.caller,
        caller: socketRef.current?.id,
        sdp: peerConnectionRef.current?.localDescription
      });
    });

    socketRef.current.on('answer', async (payload) => {
      console.log('Received answer');
      await peerConnectionRef.current?.setRemoteDescription(new RTCSessionDescription(payload.sdp));
    });

    socketRef.current.on('ice-candidate', async (incoming) => {
      try {
        if (peerConnectionRef.current) {
          await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(incoming.candidate));
        }
      } catch (e) {
        console.error('Error adding received ice candidate', e);
      }
    });

    return () => {
      socketRef.current?.disconnect();
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, [roomId]);

  const createPeerConnection = async (targetUserId: string, isInitiator: boolean) => {
    const configuration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    };

    const pc = new RTCPeerConnection(configuration);
    peerConnectionRef.current = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current?.emit('ice-candidate', {
          target: targetUserId,
          candidate: event.candidate
        });
      }
    };

    pc.ontrack = (event) => {
      console.log('Received remote track');
      setRemoteStream(event.streams[0]);
    };

    if (isInitiator) {
      const dc = pc.createDataChannel('chat');
      setupDataChannel(dc);
    } else {
      pc.ondatachannel = (event) => {
        setupDataChannel(event.channel);
      };
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    if (isInitiator) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socketRef.current?.emit('offer', {
        target: targetUserId,
        caller: socketRef.current?.id,
        sdp: pc.localDescription
      });
    }
  };

  const setupDataChannel = (dc: RTCDataChannel) => {
    dataChannelRef.current = dc;
    dc.onopen = () => {
      console.log('Data channel opened');
      setIsDataChannelOpen(true);
    };
    dc.onclose = () => {
      console.log('Data channel closed');
      setIsDataChannelOpen(false);
    };
    dc.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onDataReceivedRef.current(data);
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
    }
  };

  const sendData = useCallback((data: any) => {
    if (dataChannelRef.current && dataChannelRef.current.readyState === 'open') {
      dataChannelRef.current.send(JSON.stringify(data));
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

  return { 
    localStream, 
    remoteStream, 
    isConnected, 
    isDataChannelOpen,
    mediaError,
    startLocalStream, 
    sendData,
    toggleAudio,
    toggleVideo
  };
}
