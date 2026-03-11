import { useState, useEffect, useCallback, useRef } from 'react';

export function useSpeechRecognition(onResult: (text: string) => void) {
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const isListeningRef = useRef(false);

  const onResultRef = useRef(onResult);

  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn("Speech recognition not supported in this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onresult = (event: any) => {
      let finalTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        }
      }
      if (finalTranscript.trim()) {
        onResultRef.current(finalTranscript.trim());
      }
    };

    recognition.onerror = (event: any) => {
      // Handle specific errors
      if (event.error === 'not-allowed') {
        console.error("Speech recognition error:", event.error);
        // User denied permission, we must stop trying
        setIsListening(false);
        isListeningRef.current = false;
      } else if (event.error === 'no-speech' || event.error === 'aborted' || event.error === 'network') {
        // These are common, non-fatal errors. 
        // We don't change isListeningRef so the onend handler will restart it.
        // We intentionally do not console.error here to avoid console spam.
      } else {
        // For other unknown errors, we might want to stop to be safe, 
        // but for now let's try to keep it alive unless it's a permission issue.
        console.error("Speech recognition error:", event.error);
      }
    };

    recognition.onend = () => {
      if (isListeningRef.current) {
        // If we are supposed to be listening, try to restart
        try {
          recognition.start();
        } catch (e) {
          // Fallback: try again after a short delay
          setTimeout(() => {
            if (isListeningRef.current && recognitionRef.current) {
              try {
                recognitionRef.current.start();
              } catch (err) {
                // Silently fail if we still can't restart
              }
            }
          }, 1000);
        }
      } else {
        // We intentionally stopped
        setIsListening(false);
      }
    };

    recognitionRef.current = recognition;

    return () => {
      isListeningRef.current = false;
      setIsListening(false);
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {}
      }
    };
  }, []);

  const startListening = useCallback((lang: string = 'en-US') => {
    if (recognitionRef.current) {
      if (isListeningRef.current && recognitionRef.current.lang !== lang) {
        // Language changed while listening, need to restart
        recognitionRef.current.stop();
        recognitionRef.current.lang = lang;
        // The onend handler will automatically restart it because isListeningRef is still true
      } else if (!isListeningRef.current) {
        recognitionRef.current.lang = lang;
        try {
          recognitionRef.current.start();
          isListeningRef.current = true;
          setIsListening(true);
        } catch (e) {
          console.error("Already started", e);
        }
      }
    }
  }, []);

  const stopListening = useCallback(() => {
    if (recognitionRef.current && isListeningRef.current) {
      isListeningRef.current = false;
      setIsListening(false);
      try {
        recognitionRef.current.stop();
      } catch (e) {}
    }
  }, []);

  return { isListening, startListening, stopListening };
}
