import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function translateText(text: string, targetLanguage: string): Promise<string> {
  if (!text.trim()) return "";
  
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite-preview",
      contents: `Translate the following text to ${targetLanguage}. Only return the translated text, nothing else.\n\nText: ${text}`,
      config: {
        systemInstruction: "You are a professional real-time translator. Provide accurate and natural-sounding translations. Do not include any conversational filler, just the translation.",
        temperature: 0.3,
      }
    });
    return response.text || "";
  } catch (error) {
    console.error("Translation error:", error);
    return "";
  }
}
