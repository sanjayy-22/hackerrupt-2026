
import cv2
import os

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
if not cap.isOpened():
    print("Error opening video.")
    exit(1)

fps = cap.get(cv2.CAP_PROP_FPS)
frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
duration = frame_count / fps

print(f"FPS: {fps}")
print(f"Frame Count: {frame_count}")
print(f"Duration: {duration:.2f} seconds")

if frame_count >= 120:
    print("SUCCESS: Video is at least 5 seconds long (buffered).")
else:
    print("FAILURE: Video is too short.")

cap.release()
