// Sign Language Processing Service
// Uses Local YOLO Model (via Python Server) to analyze sign language images

type SupportedLanguage = 'en' | 'ta';

export const processSignLanguageImage = async (
  imageBase64: string,
  language: SupportedLanguage = 'en',
  mode: 'online' | 'offline' = 'online'
): Promise<string> => {
  // We are bypassing the 'mode' and 'language' for detection logic 
  // because the user explicitly requested to use the YOLO model (best.pt)
  // which is hosted on the local Python server.
  
  return processLocalYoloImage(imageBase64);
};

const processLocalYoloImage = async (imageBase64: string): Promise<string> => {
  try {
    // Expected to run on port 5000 as per desktop_tools/sign_detection_server.py
    const response = await fetch('http://localhost:5000/predict', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ image: imageBase64 }),
    });

    if (!response.ok) {
      // If server is not running, we might get connection refused or similar which is a fetch error usually.
      // But if we get a status code:
      throw new Error(`Local Server Error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.text || '';
  } catch (error) {
    console.error("Local YOLO processing failed:", error);
    // Provide a helpful error message to the user/developer console
    throw new Error("Failed to connect to local YOLO server. Please run 'python desktop_tools/sign_detection_server.py'.");
  }
};
