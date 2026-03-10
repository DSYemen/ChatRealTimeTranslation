/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { JoinRoom } from './components/JoinRoom';
import { VideoChat } from './components/VideoChat';

export default function App() {
  const [roomId, setRoomId] = useState<string | null>(null);

  const handleJoin = (id: string) => {
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
