import React, { useState } from 'react';
import { Video, Users, LogIn, LogOut, Loader2, AlertCircle, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

interface JoinRoomProps {
  onJoin: (roomId: string) => void;
}

export function JoinRoom({ onJoin }: JoinRoomProps) {
  const [roomId, setRoomId] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const { currentUser, loading, error, signInWithGoogle, logout, clearError } = useAuth();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (roomId.trim()) {
      setIsJoining(true);
      onJoin(roomId.trim());
    }
  };

  const generateRoom = () => {
    const randomId = Math.random().toString(36).substring(2, 9);
    setRoomId(randomId);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4 relative">
      {/* User Profile / Auth Header */}
      <div className="absolute top-4 right-4 z-10">
        {currentUser ? (
          <div className="flex items-center gap-3 bg-zinc-900/80 backdrop-blur-sm border border-zinc-800 rounded-full pl-2 pr-4 py-1.5 shadow-lg">
            {currentUser.photoURL ? (
              <img src={currentUser.photoURL} alt={currentUser.displayName || 'User'} className="w-8 h-8 rounded-full border border-zinc-700" referrerPolicy="no-referrer" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-500 font-medium border border-emerald-500/30">
                {currentUser.displayName?.charAt(0) || 'U'}
              </div>
            )}
            <span className="text-sm font-medium text-zinc-300 hidden sm:block">
              {currentUser.displayName}
            </span>
            <button
              onClick={logout}
              className="ml-2 p-1.5 text-zinc-400 hover:text-red-400 hover:bg-red-500/10 rounded-full transition-colors"
              title="Sign Out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={signInWithGoogle}
            className="flex items-center gap-2 bg-white text-zinc-900 hover:bg-zinc-100 font-medium rounded-full px-4 py-2 transition-colors shadow-lg text-sm"
          >
            <LogIn className="w-4 h-4" />
            Sign in with Google
          </button>
        )}
      </div>

      <div className="max-w-md w-full bg-zinc-900 border border-zinc-800 rounded-2xl p-8 shadow-2xl">
        {error && (
          <div className="mb-6 bg-red-500/10 border border-red-500/50 rounded-xl p-4 flex items-start gap-3 relative">
            <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-sm font-medium text-red-500 mb-1">Authentication Error</h3>
              <p className="text-xs text-red-400 leading-relaxed">{error}</p>
            </div>
            <button onClick={clearError} className="text-red-500 hover:text-red-400 absolute top-4 right-4">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

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

        {!currentUser ? (
          <div className="text-center p-6 bg-zinc-950 rounded-xl border border-zinc-800">
            <p className="text-zinc-400 text-sm mb-4">
              Please sign in to create or join rooms. This helps us identify participants and save chat history.
            </p>
            <button
              onClick={signInWithGoogle}
              className="w-full bg-white text-zinc-900 hover:bg-zinc-100 font-medium rounded-xl px-4 py-3 transition-colors flex items-center justify-center gap-2"
            >
              <LogIn className="w-5 h-5" />
              Sign in with Google
            </button>
          </div>
        ) : (
          <>
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
                disabled={isJoining || !roomId.trim()}
                className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-xl px-4 py-3 transition-colors flex items-center justify-center gap-2"
              >
                {isJoining ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Users className="w-5 h-5" />
                )}
                {isJoining ? 'Joining...' : 'Join Room'}
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
          </>
        )}
      </div>
    </div>
  );
}
