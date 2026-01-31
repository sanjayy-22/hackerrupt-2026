import base64
import io
import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from ultralytics import YOLO
from PIL import Image
import uvicorn

app = FastAPI(title="Sign Detection Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load Model
# best.pt is expected to be in the project root (parent of desktop_tools)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL_PATH = os.path.join(BASE_DIR, 'best.pt')

print(f"Looking for model at: {MODEL_PATH}")

model = None
try:
    if os.path.exists(MODEL_PATH):
        model = YOLO(MODEL_PATH)
        print("YOLO model loaded successfully!")
    else:
        print("Error: best.pt not found!")
except Exception as e:
    print(f"Failed to load model: {e}")

class ImageRequest(BaseModel):
    image: str

@app.post("/predict")
async def predict(req: ImageRequest):
    if not model:
        raise HTTPException(status_code=500, detail="Model not loaded or found")
    
    try:
        # Decode image
        image_bytes = base64.b64decode(req.image)
        image = Image.open(io.BytesIO(image_bytes))
        
        # Run inference
        # conf=0.25 is a reasonable default threshold
        results = model(image, conf=0.25)
        
        detected_text = ""
        
        if results and len(results) > 0:
            r = results[0]
            
            # Check for Detection Output (boxes)
            if hasattr(r, 'boxes') and r.boxes and len(r.boxes) > 0:
                # Get the box with the highest confidence
                # r.boxes is a boxes object, we can iterate or take max
                # Sort by confidence
                best_box = None
                max_conf = -1.0
                
                for box in r.boxes:
                    conf = float(box.conf[0])
                    if conf > max_conf:
                        max_conf = conf
                        best_box = box
                
                if best_box:
                    cls_id = int(best_box.cls[0])
                    detected_text = r.names[cls_id]
            
            # Check for Classification Output (probs)
            elif hasattr(r, 'probs') and r.probs:
                top1 = r.probs.top1
                detected_text = r.names[top1]

        return {"text": detected_text}

    except Exception as e:
        print(f"Prediction error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=5000)
