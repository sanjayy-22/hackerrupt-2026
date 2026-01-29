import os
import sys
import pickle
from typing import List, Dict

import cv2
import numpy as np
import torch
import io
import trimesh

import torch.serialization

# Enhanced Monkey-patch to force CPU load for cuda-tagged tensors
def _force_cpu_deserialize(obj, location):
    if hasattr(obj, 'cpu'):
        return obj.cpu()
    return obj

torch.serialization._cuda_deserialize = _force_cpu_deserialize

# Patch the registry to ensure our deserializer is used for CUDA tags
# This is critical because the registry is populated at import time
if hasattr(torch.serialization, '_package_registry'):
    new_registry = []
    for tag, val_fn, des_fn in torch.serialization._package_registry:
        if "cuda" in val_fn.__name__ or "cuda" in des_fn.__name__:
            new_registry.append((tag, val_fn, _force_cpu_deserialize))
        else:
            new_registry.append((tag, val_fn, des_fn))
    torch.serialization._package_registry = new_registry

# Patch validate_cuda_device to bypass check
if hasattr(torch.serialization, 'validate_cuda_device'):
    torch.serialization.validate_cuda_device = lambda location: 0

# Patch _rebuild_tensor_v2 to ensure CPU
if hasattr(torch, '_utils') and hasattr(torch._utils, '_rebuild_tensor_v2'):
    old_rebuild = torch._utils._rebuild_tensor_v2
    def new_rebuild(storage, storage_offset, size, stride, requires_grad, backward_hooks, metadata=None):
        if hasattr(storage, 'cpu'):
            storage = storage.cpu()
        return old_rebuild(storage, storage_offset, size, stride, requires_grad, backward_hooks, metadata)
    torch._utils._rebuild_tensor_v2 = new_rebuild

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from tqdm import tqdm

# NOTE:
# This file wires together the user's SMPL-X rendering + text indexer code
# into a simple HTTP API that the React app can call instead of Meshy.
#
# It assumes that:
# - The SMPL-X utilities are importable as in the original project:
#     from common.utils.smplx import smplx
#     from common.utils.smplx.smplx.utils import Struct
# - The HOW2SIGN dataset + PKL files live under MODEL_PATH.

# Force usage of local patched smplx (contains fixes for missing keys in .npz)
curr_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.abspath(os.path.join(curr_dir, ".."))
local_smplx_path = os.path.join(project_root, "common", "utils", "smplx")

if os.path.exists(local_smplx_path):
    # Insert at 0 to prioritize local version over any global pip install
    if local_smplx_path not in sys.path:
        sys.path.insert(0, local_smplx_path)
    import smplx
    print(f"DEBUG: Loaded smplx from {os.path.dirname(smplx.__file__)}")
else:
    print(f"WARNING: Local smplx paths not found at {local_smplx_path}. Falling back to global.")
    import smplx


# ---------------------------------------------------------
# Constants / paths – ADJUST THESE TO MATCH YOUR ENV
# ---------------------------------------------------------

PREDEFINED_HEIGHT, PREDEFINED_WIDTH = 720, 1280
PRED_FOCALS = [14921.82254791, 14921.82254791]
PRED_PRINCPTS = [620.60418701, 413.40108109]

DEVICE = torch.device("cpu")
print(f"DEBUG: Device set to: {DEVICE}")

# Project root (repo root) and public dir (for videos)
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PUBLIC_DIR = os.path.join(PROJECT_ROOT, "public")
VIDEOS_DIR = os.path.join(PUBLIC_DIR, "videos")
os.makedirs(VIDEOS_DIR, exist_ok=True)

# Paths for your environment – now using folders inside this project:
# smplx.create() will append "smplx" internally when model_type="smplx",
# so we pass the PROJECT_ROOT here, and expect:
#   <project_root>/smplx/SMPLX_NEUTRAL.npz (and related files)
SMPLX_MODEL_PATH = PROJECT_ROOT
PKL_ROOT = os.path.join(PROJECT_ROOT, "how2sign_pkls_cropTrue_shapeTrue")

# CSV used for retrieval
CSV_PATH = os.path.join(PROJECT_ROOT, "SignAvatars", "datasets", "language2motion", "text", "how2sign_realigned_train.csv")


# ---------------------------------------------------------
# SMPL-X model init (from user's code, simplified)
# ---------------------------------------------------------

startup_error = None

try:
    smplx_layer = smplx.create(
        SMPLX_MODEL_PATH,
        model_type="smplx",
        gender="NEUTRAL",
        use_pca=False,
        use_face_contour=False,
        ext="npz",
    ).to(DEVICE)
except Exception as e:
    print(f"Error loading SMPL-X model: {e}")
    import traceback

    traceback.print_exc()
    smplx_layer = None
    startup_error = e  # Capture the error for debugging



def get_coord(
    root_pose,
    body_pose,
    lhand_pose,
    rhand_pose,
    jaw_pose,
    shape,
    expr,
    cam_trans,
    mesh: bool = False,
):
    if smplx_layer is None:
        raise RuntimeError("SMPL-X model not loaded.")

    batch_size = root_pose.shape[0]
    zero_pose = torch.zeros((1, 3)).float().to(DEVICE).repeat(batch_size, 1)

    output = smplx_layer(
        betas=shape,
        body_pose=body_pose,
        global_orient=root_pose,
        right_hand_pose=rhand_pose,
        left_hand_pose=lhand_pose,
        jaw_pose=jaw_pose,
        leye_pose=zero_pose,
        reye_pose=zero_pose,
        expression=expr,
    )

    mesh_cam = output.vertices

    if mesh:
        render_mesh_cam = mesh_cam + cam_trans[:, None, :]
        return render_mesh_cam


def render_frame(img, mesh, face, cam_param):
    mesh = trimesh.Trimesh(mesh, face)
    rot = trimesh.transformations.rotation_matrix(np.radians(180), [1, 0, 0])
    mesh.apply_transform(rot)
    import pyrender

    # Define material using pyrender directly
    material = pyrender.MetallicRoughnessMaterial(
        metallicFactor=0.125,
        roughnessFactor=0.6,
        baseColorFactor=(0.425, 0.72, 0.8, 1),
    )

    mesh = trimesh.Trimesh(vertices=mesh.vertices, faces=mesh.faces)

    mesh_node = pyrender.Mesh.from_trimesh(mesh, material=material, smooth=True)

    scene = pyrender.Scene(bg_color=[0.0, 0.0, 0.0, 0.0], ambient_light=(0.3, 0.3, 0.3))
    scene.add(mesh_node, "mesh")

    focal, princpt = cam_param["focal"], cam_param["princpt"]
    camera = pyrender.IntrinsicsCamera(
        fx=focal[0], fy=focal[1], cx=princpt[0], cy=princpt[1]
    )
    scene.add(camera)

    renderer = pyrender.OffscreenRenderer(
        viewport_width=img.shape[1], viewport_height=img.shape[0], point_size=1.0
    )

    # Lighting
    light = pyrender.DirectionalLight(color=np.array([1.0, 1.0, 1.0]), intensity=0.8)
    light_pose = np.eye(4)
    light_pose[:3, 3] = np.array([0, -1, 1])
    scene.add(light, pose=light_pose)
    light_pose[:3, 3] = np.array([0, 1, 1])
    scene.add(light, pose=light_pose)
    light_pose[:3, 3] = np.array([1, 1, 2])
    scene.add(light, pose=light_pose)

    spot_l = pyrender.SpotLight(
        color=np.ones(3),
        intensity=15.0,
        innerConeAngle=np.pi / 3,
        outerConeAngle=np.pi / 2,
    )
    light_pose[:3, 3] = [1, 2, 2]
    scene.add(spot_l, pose=light_pose)
    light_pose[:3, 3] = [-1, 2, 2]
    scene.add(spot_l, pose=light_pose)

    rgb, depth = renderer.render(
        scene, flags=pyrender.RenderFlags.RGBA | pyrender.RenderFlags.SHADOWS_DIRECTIONAL
    )
    rgb = rgb[:, :, :3].astype(np.float32)
    valid_mask = (depth > 0)[:, :, None]

    img = rgb * valid_mask + img * (1 - valid_mask)
    return img


def put_text(image, text: str):
    org = (10, 30)
    font = cv2.FONT_HERSHEY_SIMPLEX
    font_scale = 1
    color = (255, 255, 255)
    thickness = 2

    text_size, _ = cv2.getTextSize(text, font, font_scale, thickness)
    text_width, text_height = text_size
    img_height, img_width, _ = image.shape
    x, y = org

    lines: List[str] = []
    line = ""
    for word in text.split(" "):
        word_size, _ = cv2.getTextSize(
            (line + " " + word).strip(), font, font_scale, thickness
        )
        word_width, _ = word_size
        if x + word_width > img_width / 3:
            lines.append(line)
            line = word
        else:
            if line:
                line += " "
            line += word
    lines.append(line)

    for i, line in enumerate(lines):
        y_offset = i * text_height * 1.2
        cv2.putText(
            image,
            line,
            (x, int(y + y_offset)),
            font,
            font_scale,
            color,
            thickness,
            cv2.LINE_AA,
        )


def render_video(clips: List[Dict], output_path: str, background_path: str, min_duration_frames: int = 0):
    if smplx_layer is None:
        print("Cannot render: SMPL-X model not loaded.")
        return

    img_list: List[np.ndarray] = []

    if os.path.exists(background_path):
        background = cv2.imread(background_path)
    else:
        background = np.zeros(
            (PREDEFINED_HEIGHT, PREDEFINED_WIDTH, 3), dtype=np.uint8
        )

    for clip in clips:
        pkl_path = clip["pkl_path"]
        text_annotation = clip["text"]

        print(f"Processing {pkl_path}...")
        # Use pickle.load to avoid "Invalid magic number" errors with torch.load on some systems
        # The monkey patches above ensures tensors are loaded to CPU
        with open(pkl_path, 'rb') as f:
            results_dict = pickle.load(f)
        all_pose = results_dict["smplx"]
        all_pose = torch.tensor(all_pose).to(DEVICE)

        g, b, l, r, j, s, exp, cam_trans = (
            all_pose[:, :3],
            all_pose[:, 3:66],
            all_pose[:, 66:111],
            all_pose[:, 111:156],
            all_pose[:, 156:159],
            all_pose[:, 159:169],
            all_pose[:, 169:179],
            all_pose[:, 179:182],
        )

        valid_indices = results_dict.get("total_valid_index", [])
        if torch.is_tensor(valid_indices):
            valid_indices = valid_indices.cpu().numpy()
        elif isinstance(valid_indices, list):
            valid_indices = np.array(valid_indices)
            
        print(f"DEBUG: Found {len(valid_indices)} valid indices: {valid_indices}", flush=True)


        meshes = (
            get_coord(g, b, l, r, j, s, exp, cam_trans[0][None], mesh=True)
            .detach()
            .cpu()
            .numpy()
        )

        faces = smplx_layer.faces
        print(f"DEBUG: meshes shape: {meshes.shape}", flush=True)
        if torch.is_tensor(faces):
            faces = faces.detach().cpu().numpy()
        print(f"DEBUG: faces shape: {faces.shape}", flush=True)

        for i, idx in enumerate(valid_indices):
            try:
                # Ensure idx is integer
                idx = int(idx)
                # print(f"DEBUG: Rendering frame {i} (index {idx})", flush=True)
                img = render_frame(
                    background.copy(),
                    meshes[idx],
                    faces,
                    {"focal": PRED_FOCALS, "princpt": PRED_PRINCPTS},
                ).astype(np.uint8)
                # put_text(img, text_annotation)
                img_list.append(img)
            except Exception as e:
                print(f"ERROR rendering frame {idx}: {e}", flush=True)

            # Enforce minimum duration if requested (e.g. for "Hi" query)
    if min_duration_frames > 0 and len(img_list) > 0:
        current_frames = len(img_list)
        if current_frames < min_duration_frames:
            print(f"Extending video from {current_frames} to {min_duration_frames} frames using ping-pong loop...")
            
            # Create a ping-pong segment (Forward + Backward without repeating ends)
            # e.g. [0, 1, 2] -> [0, 1, 2, 1]
            if current_frames > 1:
                # Use copies to ensure no reference issues
                forward = [img.copy() for img in img_list]
                # Backward slice: start at second to last, go to second item (index 1), so we don't repeat first or last
                # Actually, standard pingpong is 0,1,2, 1, 0, 1, 2...
                # current logic: 0,1,2 + 1 = 0,1,2,1. Next loop: 0,1,2,1,0...
                # Ideally we want 0,1,2 -> 1 -> 0 -> 1 -> 2
                
                # Let's just create a sequence that loops nicely
                # reversed_middle = img_list[-2:0:-1] # indices len-2 down to 1
                # segment = forward + [img.copy() for img in reversed_middle]
                
                # Simpler approach: create a big list of potential frames doing full pingpong
                # then slice what we need
                
                # But for the user request, let's stick to the previous simple logic but with .copy()
                reversed_part = [img.copy() for img in img_list[-2:0:-1]]
                segment = forward + reversed_part
            else:
                segment = [img_list[0].copy()]
            
            while len(img_list) < min_duration_frames:
                for frame in segment:
                    if len(img_list) >= min_duration_frames:
                        break
                    img_list.append(frame.copy())

    print(f"Saving video to {output_path} with {len(img_list)} frames...")
    
    if not img_list:
        print("Error: No frames to render!")
        return

    # Debug frame proeprties
    first_frame = img_list[0]
    print(f"Frame 0 shape: {first_frame.shape}, dtype: {first_frame.dtype}")
    
    # Use avc1 as it worked previously
    fourcc = cv2.VideoWriter_fourcc(*"avc1")
    out = cv2.VideoWriter(
        output_path, fourcc, 24, (PREDEFINED_WIDTH, PREDEFINED_HEIGHT)
    )
    if not out.isOpened():
        print("ERROR: Could not open VideoWriter with avc1! Trying mp4v...")
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        out = cv2.VideoWriter(
            output_path, fourcc, 24, (PREDEFINED_WIDTH, PREDEFINED_HEIGHT)
        )
        if not out.isOpened():
             print("ERROR: Could not open VideoWriter with mp4v either!")

    for i, img in enumerate(img_list):
        if img.shape != (PREDEFINED_HEIGHT, PREDEFINED_WIDTH, 3):
             print(f"Warning: Frame {i} has wrong shape {img.shape}")
        out.write(img)
    out.release()
    print("Done.")


# ---------------------------------------------------------
# Text indexer (Updated with user's logic)
# ---------------------------------------------------------

import pandas as pd
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity


# Import TextIndexer from the actual project module
if PROJECT_ROOT not in sys.path:
    sys.path.append(PROJECT_ROOT)

try:
    from SignAvatars.retrieval.indexer import TextIndexer
except ImportError:
    # Fallback if the path setup fails or the file is missing,
    # though we expect it to exist based on user metadata.
    print("WARNING: Could not import SignAvatars.retrieval.indexer. Using local fallback.")
    
    class TextIndexer:
        def __init__(self, csv_path):
            self.csv_path = csv_path
            self.df = None
            self.vectorizer = None
            self.tfidf_matrix = None
            self.load_data()

        def load_data(self):
            """Loads the CSV data and builds the TF-IDF index."""
            if not os.path.exists(self.csv_path):
                raise FileNotFoundError(f"CSV file not found at: {self.csv_path}")
            
            print(f"Loading data from {self.csv_path}...")
            # Load only necessary columns to save memory
            self.df = pd.read_csv(self.csv_path, sep='\t', usecols=['SENTENCE_NAME', 'SENTENCE'])
            
            # Drop rows with missing sentences
            self.df.dropna(subset=['SENTENCE'], inplace=True)
            
            print(f"Indexing {len(self.df)} sentences...")
            self.vectorizer = TfidfVectorizer(stop_words='english')
            self.tfidf_matrix = self.vectorizer.fit_transform(self.df['SENTENCE'])
            print("Indexing complete.")

        def search(self, query, top_k=1):
            """Searches for the most similar sentences to the query."""
            if self.vectorizer is None or self.tfidf_matrix is None:
                raise ValueError("Index not built. Call load_data() first.")

            query_vec = self.vectorizer.transform([query])
            similarities = cosine_similarity(query_vec, self.tfidf_matrix).flatten()
            
            # Get top k indices
            top_indices = similarities.argsort()[-top_k:][::-1]
            
            results = []
            for idx in top_indices:
                # Explicit float conversion for JSON serialization safety
                score = float(similarities[idx])
                sentence_name = self.df.iloc[idx]['SENTENCE_NAME']
                sentence_text = self.df.iloc[idx]['SENTENCE']
                results.append({
                    'score': score,
                    'sentence_name': sentence_name,
                    'sentence': sentence_text
                })
                
            return results


# Initialize with the project's CSV path
indexer = TextIndexer(CSV_PATH)


def sentence_name_to_pkl_path(sentence_name: str) -> str:
    """
    Map a SENTENCE_NAME from the CSV to a .pkl file path.

    This is a heuristic and might need adjustment depending on your dataset
    layout. Adjust this to match how your PKL files are organized.
    """
    # Example: SENTENCE_NAME: 'how2sign_train_000001' ->
    #   D:\how2sign_pkls_cropTrue_shapeTrue\how2sign_pkls_cropTrue_shapeTrue\how2sign_train_000001.pkl
    candidate = os.path.join(PKL_ROOT, f"{sentence_name}.pkl")
    if os.path.exists(candidate):
        return candidate

    # Fallback: try under a "pkls" subfolder
    candidate2 = os.path.join(PKL_ROOT, "pkls", f"{sentence_name}.pkl")
    return candidate2


# ---------------------------------------------------------
# FastAPI wiring
# ---------------------------------------------------------


class TextToSignRequest(BaseModel):
    text: str


class TextToSignResponse(BaseModel):
    videoUrl: str
    matchedSentence: str
    sentenceName: str


app = FastAPI(title="Text to Sign SMPL-X Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/videos", StaticFiles(directory=PUBLIC_DIR), name="videos")


@app.post("/text-to-sign", response_model=TextToSignResponse)
def text_to_sign(req: TextToSignRequest):
    if smplx_layer is None:
        raise RuntimeError(f"SMPL-X model not loaded on server. Startup error: {startup_error}")

    query = req.text.strip()
    if not query:
        raise ValueError("Empty query.")

    results = indexer.search(query, top_k=1)
    if not results:
        raise RuntimeError("No results from text indexer.")

    best = results[0]
    sentence_name = best["sentence_name"]
    sentence_text = best["sentence"]

    pkl_path = sentence_name_to_pkl_path(sentence_name)
    if not os.path.exists(pkl_path):
        raise FileNotFoundError(f"PKL file not found for {sentence_name}: {pkl_path}")

    import time
    timestamp = int(time.time())
    out_filename = f"text_to_sign_{sentence_name}_{timestamp}.mp4"
    out_path = os.path.join(PUBLIC_DIR, out_filename)

    background_path = os.path.join(PUBLIC_DIR, "blender.png")
    
    # Special handling for "hi" - ensure at least 5 seconds (5 * 24 = 120 frames)
    min_frames = 0
    if query.lower() == "hi":
        min_frames = 120  # 5 seconds at 24 FPS
        
    render_video(
        clips=[{"pkl_path": pkl_path, "text": sentence_text}],
        output_path=out_path,
        background_path=background_path,
        min_duration_frames=min_frames,
    )



    # Serve via the mounted static files path
    video_url = f"/videos/{out_filename}"

    return TextToSignResponse(
        videoUrl=video_url,
        matchedSentence=sentence_text,
        sentenceName=sentence_name,
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8002)


