
import requests
import time

url = "http://127.0.0.1:8002/text-to-sign"
data = {"text": "Hello world"}
print(f"Sending request to {url} with data {data}")

try:
    response = requests.post(url, json=data)
    print("Status Code:", response.status_code)
    try:
        print("Response JSON:", response.json())
    except:
        print("Response Content:", response.text)
except Exception as e:
    print(f"Request failed: {e}")
