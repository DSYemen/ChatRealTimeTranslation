import { useCallback, useEffect, useState } from 'react';

export function useSpeechSynthesis() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [isWarmedUp, setIsWarmedUp] = useState(false);

  useEffect(() => {
    const loadVoices = () => {
      setVoices(window.speechSynthesis.getVoices());
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;

    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  const warmup = useCallback(() => {
    if (!isWarmedUp && window.speechSynthesis) {
      const utterance = new SpeechSynthesisUtterance('');
      utterance.volume = 0;
      window.speechSynthesis.speak(utterance);
      setIsWarmedUp(true);
    }
  }, [isWarmedUp]);

  const speak = useCallback((text: string, lang: string = 'en-US') => {
    if (!window.speechSynthesis) {
      console.warn("Speech synthesis not supported.");
      return;
    }

    // Cancel any ongoing speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.volume = 1;

    // Try to find a voice that matches the language
    const voice = voices.find(v => v.lang.startsWith(lang) || v.lang.startsWith(lang.split('-')[0]));
    if (voice) {
      utterance.voice = voice;
    }

    window.speechSynthesis.speak(utterance);
  }, [voices]);

  return { speak, voices, warmup };
}
