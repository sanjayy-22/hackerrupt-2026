
import requests
import json

url = "http://127.0.0.1:8002/text-to-sign"
data = {"text": "hi"}

print(f"Sending request: {data}")
try:
    response = requests.post(url, json=data)
    print("Status:", response.status_code)
    print("Response:", response.json())
except Exception as e:
    print("Error:", e)
