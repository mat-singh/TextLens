
import { GoogleGenAI } from "@google/genai";

export async function extractTextFromImage(base64Image: string): Promise<string> {
  // Directly use the required initialization pattern.
  // Note: process.env.API_KEY must be injected by your build tool (e.g. Zeabur/Vite/Vercel)
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  // Basic validation to provide a clear error message before the SDK throws
  if (!process.env.API_KEY) {
    throw new Error("API_KEY is undefined in the browser. Ensure you have added 'API_KEY' to your Environment Variables and redeployed.");
  }

  // Ensure we only have the base64 data part
  const base64Data = base64Image.includes(',') ? base64Image.split(',')[1] : base64Image;

  const prompt = "Extract all text from this image exactly as it appears. Preserve layout, lists, and formatting. Output ONLY the extracted text with no conversational filler.";

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: 'image/jpeg',
              data: base64Data,
            },
          },
          { text: prompt },
        ],
      },
    });

    const text = response.text;
    if (!text) {
      throw new Error("The AI returned an empty response. The image might be too blurry or contain no readable text.");
    }

    return text;
  } catch (error: any) {
    console.error("Gemini API Error Detail:", error);
    
    if (error.message?.includes('API key') || error.message?.includes('403')) {
      throw new Error("Invalid API Key. Please check your environment variables and ensure the key is correct and has access to Gemini 3 models.");
    }
    
    throw new Error(error.message || "An unexpected error occurred during text extraction.");
  }
}
