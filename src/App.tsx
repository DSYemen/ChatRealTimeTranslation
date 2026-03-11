/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { JoinRoom } from './components/JoinRoom';
import { VideoChat } from './components/VideoChat';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { createOrJoinRoom } from './services/roomService';

function AppContent() {
  const [roomId, setRoomId] = useState<string | null>(null);
  const { currentUser } = useAuth();

  const handleJoin = async (id: string) => {
    if (currentUser) {
      try {
        await createOrJoinRoom(id, currentUser);
      } catch (error) {
        console.error("Error creating/joining room in Firestore:", error);
        // Continue anyway so the WebRTC part still works even if DB fails
      }
    }
    setRoomId(id);
  };

  const handleLeave = () => {
    setRoomId(null);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white font-sans">
      {roomId ? (
        <VideoChat roomId={roomId} onLeave={handleLeave} />
      ) : (
        <JoinRoom onJoin={handleJoin} />
      )}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
