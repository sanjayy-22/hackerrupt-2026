
import pickle
import os
import torch
import numpy as np
import io

# Monkey-patch to force CPU load for cuda-tagged tensors
def _force_cpu_deserialize(obj, location):
    if hasattr(obj, 'cpu'):
        return obj.cpu()
    return obj

torch.serialization._cuda_deserialize = _force_cpu_deserialize

if hasattr(torch.serialization, '_package_registry'):
    new_registry = []
    for tag, val_fn, des_fn in torch.serialization._package_registry:
        if "cuda" in val_fn.__name__ or "cuda" in des_fn.__name__:
            new_registry.append((tag, val_fn, _force_cpu_deserialize))
        else:
            new_registry.append((tag, val_fn, des_fn))
    torch.serialization._package_registry = new_registry

if hasattr(torch.serialization, 'validate_cuda_device'):
    torch.serialization.validate_cuda_device = lambda location: 0

if hasattr(torch, '_utils') and hasattr(torch._utils, '_rebuild_tensor_v2'):
    old_rebuild = torch._utils._rebuild_tensor_v2
    def new_rebuild(storage, storage_offset, size, stride, requires_grad, backward_hooks, metadata=None):
        if hasattr(storage, 'cpu'):
            storage = storage.cpu()
        return old_rebuild(storage, storage_offset, size, stride, requires_grad, backward_hooks, metadata)
    torch._utils._rebuild_tensor_v2 = new_rebuild


# Path matches what was logged in Step 134
pkl_path = r"c:\Users\user\Downloads\agentathon\how2sign_pkls_cropTrue_shapeTrue\1P0oKY4FNyI_0-8-rgb_front.pkl"

print(f"Inspecting {pkl_path}")

if not os.path.exists(pkl_path):
    print("File not found!")
    # Try looking in 'pkls' subdir as fallback mentioned in server code
    pkl_path = r"c:\Users\user\Downloads\agentathon\how2sign_pkls_cropTrue_shapeTrue\pkls\1P0oKY4FNyI_0-8-rgb_front.pkl"
    print(f"Trying {pkl_path}")

with open(pkl_path, 'rb') as f:
    data = pickle.load(f)

print("Keys:", data.keys())

if "smplx" in data:
    smplx_data = data["smplx"]
    print("SMPL-X data shape:", smplx_data.shape)
    
    # Check if the pose actually changes across frames
    # smplx_data is usually (Frames, Parameters)
    # Let's check variance across frames for the first few parameters (global orient, body pose)
    variance = np.var(smplx_data, axis=0)
    print("Max variance across frames:", np.max(variance))
    if np.max(variance) < 1e-5:
        print("WARNING: Data appears static (low variance)!")
    else:
        print("Data has movement.")

if "total_valid_index" in data:
    indices = data["total_valid_index"]
    print("Total valid indices count:", len(indices))
    print("First 10 indices:", indices[:10])
    print("Last 10 indices:", indices[-10:])
