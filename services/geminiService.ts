
import { GoogleGenAI } from "@google/genai";

// Using gemini-3-flash-preview as per standard text task guidelines.
const MODEL_NAME = 'gemini-3-flash-preview';

export async function extractTextFromImage(base64Image: string): Promise<string> {
  const apiKey = process.env.API_KEY;
  
  if (!apiKey) {
    throw new Error("API_KEY is missing. Ensure it is set in your environment variables.");
  }

  const ai = new GoogleGenAI({ apiKey });
  
  // Ensure we only have the base64 data part
  const base64Data = base64Image.includes(',') ? base64Image.split(',')[1] : base64Image;

  const prompt = "Extract all text from this image exactly as it appears. Preserve layout, lists, and formatting. Output ONLY the extracted text with no conversational filler.";

  try {
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
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

    if (!response.text) {
      throw new Error("The AI returned an empty response. The image might be too blurry or contain no readable text.");
    }

    return response.text;
  } catch (error: any) {
    console.error("Gemini API Error Detail:", error);
    
    // Provide a more descriptive error message based on common API failures
    if (error.message?.includes('403')) {
      throw new Error("Permission denied (403). Check if your API key is valid and has billing enabled.");
    } else if (error.message?.includes('404')) {
      throw new Error(`Model '${MODEL_NAME}' not found. Your API key may not have access to this preview model yet.`);
    } else if (error.message?.includes('429')) {
      throw new Error("Rate limit exceeded. Please wait a moment before scanning again.");
    }
    
    throw new Error(error.message || "An unexpected error occurred during text extraction.");
  }
}
