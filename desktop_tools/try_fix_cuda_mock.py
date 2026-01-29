
import torch
import os
import pickle

# Mock cuda availability to bypass validation check
torch.cuda.is_available = lambda: True

# Also patch _cuda_deserialize to be safe, though map_location should handle it
def _force_cpu_deserialize(obj, location):
    return obj
torch.serialization._cuda_deserialize = _force_cpu_deserialize

pkl_path = r"c:\Users\user\Downloads\agentathon\how2sign_pkls_cropTrue_shapeTrue\--7E2sU6zP4_10-5-rgb_front.pkl"

print(f"Attempting to load: {pkl_path}")
try:
    data = torch.load(pkl_path, map_location='cpu')
    print("Success!")
    print("Keys:", data.keys())
    if "smplx" in data:
        print("smplx type:", type(data["smplx"]))
except Exception as e:
    print(f"Error loading: {e}")
