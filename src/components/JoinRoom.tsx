import React, { useState } from 'react';
import { Video, Users } from 'lucide-react';

interface JoinRoomProps {
  onJoin: (roomId: string) => void;
}

export function JoinRoom({ onJoin }: JoinRoomProps) {
  const [roomId, setRoomId] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (roomId.trim()) {
      onJoin(roomId.trim());
    }
  };

  const generateRoom = () => {
    const randomId = Math.random().toString(36).substring(2, 9);
    setRoomId(randomId);
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-zinc-900 border border-zinc-800 rounded-2xl p-8 shadow-2xl">
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 bg-emerald-500/10 rounded-2xl flex items-center justify-center">
            <Video className="w-8 h-8 text-emerald-500" />
          </div>
        </div>
        
        <h1 className="text-2xl font-semibold text-white text-center mb-2">
          Real-time Dubbing Chat
        </h1>
        <p className="text-zinc-400 text-center mb-8 text-sm">
          Join a room to start a video call with live voice translation.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="roomId" className="block text-sm font-medium text-zinc-400 mb-1">
              Room ID
            </label>
            <input
              type="text"
              id="roomId"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-colors"
              placeholder="Enter room ID"
              required
            />
          </div>

          <button
            type="submit"
            className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-medium rounded-xl px-4 py-3 transition-colors flex items-center justify-center gap-2"
          >
            <Users className="w-5 h-5" />
            Join Room
          </button>
        </form>

        <div className="mt-6 text-center">
          <button
            onClick={generateRoom}
            className="text-sm text-emerald-500 hover:text-emerald-400 transition-colors"
          >
            Generate random room ID
          </button>
        </div>
      </div>
    </div>
  );
}
