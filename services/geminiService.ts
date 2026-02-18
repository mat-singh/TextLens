
import { GoogleGenAI } from "@google/genai";

export async function extractTextFromImage(base64Image: string): Promise<string> {
  // Directly access the key from the environment.
  // Note: On Vercel, you must add 'API_KEY' to your Environment Variables.
  const apiKey = process.env.API_KEY;
  
  // Validation check before initializing the SDK to prevent constructor-level errors
  if (!apiKey || apiKey === "undefined" || apiKey === "") {
    console.error("Gemini API Key missing in process.env.API_KEY");
    throw new Error("Missing Gemini API Key. Please ensure the 'API_KEY' environment variable is correctly set in your project's deployment settings (Vercel/Zeabur/etc) and redeploy.");
  }

  // Use the required initialization pattern.
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  // Ensure we only have the base64 data part for the API request
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
      throw new Error("Authentication failed. Check if your API_KEY is valid and has permission for Gemini 3 models.");
    }
    
    throw new Error(error.message || "An unexpected error occurred during text extraction.");
  }
}
