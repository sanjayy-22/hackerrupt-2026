
import torch
import os
import pickle
import traceback
import torch._utils
import torch.serialization

# Define the patch function
def _force_cpu_deserialize(obj, location):
    if hasattr(obj, 'cpu'):
        return obj.cpu()
    return obj

# Patch the registry
new_registry = []
for tag, val_fn, des_fn in torch.serialization._package_registry:
    if "cuda" in val_fn.__name__ or "cuda" in des_fn.__name__:
        print("Replacing cuda deserializer in registry")
        new_registry.append((tag, val_fn, _force_cpu_deserialize))
    else:
        new_registry.append((tag, val_fn, des_fn))
torch.serialization._package_registry = new_registry

# Patch validate_cuda_device to bypass check (just in case)
if hasattr(torch.serialization, 'validate_cuda_device'):
    torch.serialization.validate_cuda_device = lambda location: 0

# Patch _rebuild_tensor_v2 to ensure CPU (just in case)
if hasattr(torch._utils, '_rebuild_tensor_v2'):
    old_rebuild = torch._utils._rebuild_tensor_v2
    def new_rebuild(storage, storage_offset, size, stride, requires_grad, backward_hooks, metadata=None):
        if hasattr(storage, 'cpu'):
            storage = storage.cpu()
        return old_rebuild(storage, storage_offset, size, stride, requires_grad, backward_hooks, metadata)
    torch._utils._rebuild_tensor_v2 = new_rebuild


pkl_path = r"c:\Users\user\Downloads\agentathon\how2sign_pkls_cropTrue_shapeTrue\--7E2sU6zP4_10-5-rgb_front.pkl"

print(f"Attempting to load: {pkl_path}")
if os.path.exists(pkl_path):
    try:
        with open(pkl_path, 'rb') as f:
            data = pickle.load(f)
        print("Success!")
        print("Keys:", data.keys())
    except Exception as e:
        print(f"Error loading: {e}")
        traceback.print_exc()
