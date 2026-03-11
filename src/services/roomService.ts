import { collection, doc, setDoc, getDoc, updateDoc, arrayUnion, serverTimestamp, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { User } from 'firebase/auth';

export interface Room {
  id: string;
  createdBy: string;
  createdAt: any;
  participants: string[];
}

export interface Message {
  id: string;
  senderId: string;
  senderName: string;
  senderPhoto: string | null;
  recipientId?: string; // Add recipientId for private messages
  originalText: string;
  translatedText: string | null;
  language: string;
  timestamp: any;
}

export const createOrJoinRoom = async (roomId: string, user: User) => {
  if (!db) return;

  const roomRef = doc(db, 'rooms', roomId);
  const roomSnap = await getDoc(roomRef);

  if (!roomSnap.exists()) {
    // Create new room
    await setDoc(roomRef, {
      id: roomId,
      createdBy: user.uid,
      createdAt: serverTimestamp(),
      participants: [user.uid]
    });
  } else {
    // Join existing room
    await updateDoc(roomRef, {
      participants: arrayUnion(user.uid)
    });
  }
};

export const saveMessage = async (roomId: string, user: User, originalText: string, translatedText: string | null, language: string, recipientId?: string) => {
  if (!db) return;

  const messagesRef = collection(db, 'rooms', roomId, 'messages');
  const newMessageRef = doc(messagesRef);

  const messageData: any = {
    id: newMessageRef.id,
    senderId: user.uid,
    senderName: user.displayName || 'Unknown User',
    senderPhoto: user.photoURL || null,
    originalText,
    translatedText,
    language,
    timestamp: serverTimestamp()
  };

  if (recipientId) {
    messageData.recipientId = recipientId;
  }

  await setDoc(newMessageRef, messageData);
};

export const subscribeToMessages = (roomId: string, currentUserId: string, callback: (messages: Message[]) => void) => {
  if (!db) return () => {};

  const messagesRef = collection(db, 'rooms', roomId, 'messages');
  const q = query(messagesRef, orderBy('timestamp', 'asc'));

  const unsubscribe = onSnapshot(q, (snapshot) => {
    const messages = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as Message[];
    
    // Filter messages: show public messages, or private messages sent by/to the current user
    const filteredMessages = messages.filter(msg => 
      !msg.recipientId || msg.recipientId === currentUserId || msg.senderId === currentUserId
    );
    
    callback(filteredMessages);
  });

  return unsubscribe;
};
