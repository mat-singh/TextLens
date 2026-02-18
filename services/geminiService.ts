
import { GoogleGenAI } from "@google/genai";

export async function extractTextFromImage(base64Image: string): Promise<string> {
  // Always use the required initialization pattern.
  // The shim in index.html ensures 'process.env' exists even if not yet populated.
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  // Explicitly check for the key to provide a helpful error in the app UI
  if (!process.env.API_KEY || process.env.API_KEY === "undefined" || process.env.API_KEY === "") {
    throw new Error("Missing API_KEY. Please set the 'API_KEY' environment variable in your Vercel/Zeabur project settings and redeploy.");
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
      throw new Error("Authentication failed. Ensure your API_KEY is valid and has access to Gemini 3 models.");
    }
    
    throw new Error(error.message || "An unexpected error occurred during text extraction.");
  }
}
