import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';

export interface UserPreferences {
  language: string;
  subtitleSize: 'text-sm' | 'text-base' | 'text-lg';
  subtitlePosition: 'top-4' | 'bottom-4';
}

const DEFAULT_PREFS: UserPreferences = {
  language: 'en',
  subtitleSize: 'text-base',
  subtitlePosition: 'bottom-4'
};

export const getUserPreferences = async (userId: string): Promise<UserPreferences> => {
  if (!db) return DEFAULT_PREFS;
  
  try {
    const userRef = doc(db, 'users', userId);
    const userSnap = await getDoc(userRef);
    
    if (userSnap.exists() && userSnap.data().preferences) {
      return { ...DEFAULT_PREFS, ...userSnap.data().preferences };
    }
    
    // Create default preferences if they don't exist
    await setDoc(userRef, { preferences: DEFAULT_PREFS }, { merge: true });
    return DEFAULT_PREFS;
  } catch (error) {
    console.error('Error fetching user preferences:', error);
    return DEFAULT_PREFS;
  }
};

export const updateUserPreferences = async (userId: string, preferences: Partial<UserPreferences>) => {
  if (!db) return;
  
  try {
    const userRef = doc(db, 'users', userId);
    await setDoc(userRef, { preferences }, { merge: true });
  } catch (error) {
    console.error('Error updating user preferences:', error);
  }
};
