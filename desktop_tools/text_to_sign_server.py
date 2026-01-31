import os
import re
import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Text to Sign Server (SignASL)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class TextToSignRequest(BaseModel):
    text: str

class TextToSignResponse(BaseModel):
    vidRef: str | None
    videoUrl: str | None # keeping this for compatibility or maybe to return the signasl url
    matchedSentence: str

@app.post("/text-to-sign", response_model=TextToSignResponse)
def text_to_sign(req: TextToSignRequest):
    query = req.text.strip()
    if not query:
        raise HTTPException(status_code=400, detail="Empty query.")

    # Normalize query for URL
    # 1. Lowercase
    # 2. Keep alphanumeric and spaces
    # 3. Replace spaces with hyphens
    clean_query = re.sub(r'[^a-zA-Z0-9\s]', '', query).lower()
    clean_query = re.sub(r'\s+', '-', clean_query.strip())
    
    print(f"Searching for: {query} -> {clean_query}")
    
    # Fetch from signasl.org
    try:
        url = f"https://www.signasl.org/sign/{clean_query}"
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        response = requests.get(url, headers=headers)
        
        if response.status_code != 200:
             raise HTTPException(status_code=500, detail=f"Failed to fetch from SignASL: {response.status_code}")

        # Extract vidref
        # Logic: find the first occurrence of data-videoref
        match = re.search(r'data-videoref="([a-zA-Z0-9]+)"', response.text)
        
        if match:
            vidref = match.group(1)
            return TextToSignResponse(
                vidRef=vidref,
                videoUrl=url, # Return the signasl page URL as videoUrl for now, frontend will use vidRef
                matchedSentence=query
            )
        else:
             # If exact match fails, maybe we can just return empty or error?
             # For now, let's treat it as not found
             raise HTTPException(status_code=404, detail="No sign video found for this text.")

    except Exception as e:
        print(f"Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8002)
