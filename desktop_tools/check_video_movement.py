
import cv2
import os
import numpy as np

# Find the most recent mp4 file in public dir
public_dir = os.path.join(os.getcwd(), "public")
files = [f for f in os.listdir(public_dir) if f.endswith(".mp4")]
if not files:
    print("No video found.")
    exit(1)

# Get the latest file
latest_file = max([os.path.join(public_dir, f) for f in files], key=os.path.getctime)
print(f"Checking video: {latest_file}")

cap = cv2.VideoCapture(latest_file)

frames = []
while True:
    ret, frame = cap.read()
    if not ret:
        break
    # Convert to grayscale to simplify comparison
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    frames.append(gray)

cap.release()

frame_count = len(frames)
print(f"Total Frames: {frame_count}")

if frame_count < 2:
    print("Video has less than 2 frames.")
    exit(1)

# Calculate differences between consecutive frames
diffs = []
for i in range(1, len(frames)):
    # Absolute difference between current and previous frame
    diff = cv2.absdiff(frames[i], frames[i-1])
    mean_diff = np.mean(diff)
    diffs.append(mean_diff)

avg_frame_diff = np.mean(diffs)
max_frame_diff = np.max(diffs)

print(f"Average Frame Difference: {avg_frame_diff:.4f}")
print(f"Max Frame Difference: {max_frame_diff:.4f}")

if avg_frame_diff > 0.5:
    print("SUCCESS: Video shows movement.")
else:
    print("FAILURE: Video appears static.")
