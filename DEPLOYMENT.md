# Deployment Guide for BridgeTalk

Since this project uses a complex Python backend with heavy ML dependencies (`torch`, `smplx`) and large local data files (`.pkl`), standard "free" cloud hosting (like Render Free Tier) will likely fail due to memory limits (512MB RAM isn't enough for PyTorch).

**The best free strategy is a "Hybrid Deployment":**
1.  **Frontend**: Hosted fast & free on **Vercel**.
2.  **Backend**: Hosted on your local machine, exposed securely via **Ngrok**.

---

## Step 1: Deploy Frontend to Vercel

1.  Push your code to **GitHub**.
2.  Go to [Vercel.com](https://vercel.com) and "Add New Project".
3.  Import your repository.
4.  **Important**: In the configuration settings, add an Environment Variable:
    *   **Name**: `VITE_API_URL`
    *   **Value**: (Leave this blank for now, or put `http://localhost:8002` as placeholder. We will update it in Step 2).
5.  Click **Deploy**.

## Step 2: Expose Local Backend with Ngrok

1.  Download and install [Ngrok](https://ngrok.com/download) (it's free).
2.  Start your Python backend normally in your terminal:
    ```bash
    python desktop_tools/text_to_sign_server.py
    ```
3.  Open a **new** terminal and run:
    ```bash
    ngrok http 8002
    ```
4.  Ngrok will give you a Forwarding URL (e.g., `https://a1b2-c3d4.ngrok-free.app`). **Copy this URL.**

### Alternative 2.1: Cloudflare Tunnel (Totally Free & Persistent)
If you don't want to use Ngrok, **Cloudflare Tunnel** is a robust free alternative.
1.  Download `cloudflared` for Windows from [Cloudflare Downloads](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).
2.  Run:
    ```powershell
    .\cloudflared.exe tunnel --url http://localhost:8002
    ```
3.  Copy the URL ending in `.trycloudflare.com`.

### Alternative 2.2: LocalTunnel (No Installation)
If you have Node.js installed (which you do for the frontend), you can use `localtunnel` immediately without downloading anything extra.
1.  Run in terminal:
    ```bash
    npx localtunnel --port 8002
    ```
2.  It will give you a URL like `https://funny-cat-42.loca.lt`.
3.  **Note**: LocalTunnel sometimes asks for a password/IP confirmation on the first visit. Check the terminal output for instructions.

## Step 3: Link Them

1.  Go back to your Project Settings in **Vercel**.
2.  Update the `VITE_API_URL` environment variable with your **Ngrok URL** (e.g., `https://a1b2-c3d4.ngrok-free.app`).
    *   *Note: No trailing slash needed.*
3.  **Redeploy** the frontend (Deployment > Redeploy) for the change to take effect.

## Done!
Your Vercel website is now public and can talk to the brain running on your powerful local computer.

---

### FAQ: Can I host the backend on Render Free Tier?
**Short Answer: No.**

**Why?**
1.  **RAM Limit**: Render's free tier gives you **512MB RAM**. Just importing `torch` and loading the SMPL-X model usually requires ~1.5GB to 2GB of RAM. The server will almost certainly crash with an "Out of Memory" error during startup or the first request.
2.  **Disk & Data**: This project relies on 30,000+ `.pkl` data files (gigabytes of data). Uploading this heavily impacts build times, and free tier instances have ephemeral storage constraints.
3.  **CPU Speed**: Rendering 3D avatars frame-by-frame on a shared 0.1 CPU core would be extremely slow (e.g., several seconds per frame), likely causing timeouts.

**Recommendation**: Stick to the **Hybrid Deployment** (Local Backend + Vercel/Render Frontend). It uses your local machine's power (free) and avoids cloud limits.

---

### Alternative 4: Hugging Face Spaces (The BEST Free Cloud Option)
If you absolutely need it hosted in the cloud for free (no local computer running), **Hugging Face Spaces** is your best bet because their free tier offers **16GB RAM** (CPU Basic), which is enough for this app.

1.  **Create a Space**:
    *   Go to [huggingface.co/spaces](https://huggingface.co/spaces) and create a new Space.
    *   **SDK**: Select **Docker**.
    *   **Hardware**: "Free" (2 vCPU, 16GB RAM).
2.  **Upload Code**:
    *   You will need to upload your entire project (including the 30k+ PKL files) to the Space.
    *   *Warning*: The initial upload will be huge (10GB-30GB) and might take a long time.
3.  **Dockerfile**:
    *   Add a `Dockerfile` to the root of your repo that installs python dependencies and runs `uvicorn`.
4.  **Deployment**:
    *   Once uploaded, Hugging Face will build the container. If successful, you get a public URL (e.g., `https://huggingface.co/spaces/username/space-name`) that acts as your API backend.

91: ### Alternative 5: Oracle Cloud "Always Free" (Advanced)
92: Oracle Cloud offers a very generous free tier (ARM instances with 24GB RAM). This is a full Virtual Private Server (VPS), so you have to manage everything via SSH.
93: 
94: **Prerequisites**: A credit card for identity verification (they usually don't charge, but it's hard to pass their fraud check).
95: 
96: #### Step-by-Step Guide
97: 1.  **Create Instance**:
98:     *   Sign up at [Oracle Cloud Free Tier](https://www.oracle.com/cloud/free/).
99:     *   Create a VM Instance.
100:    *   **Image**: Ubuntu 22.04 or Oracle Linux 8.
101:    *   **Shape**: Select **Ampere** (VM.Standard.A1.Flex). Set OCPUs to 4 and RAM to 24GB.
102:    *   **SSH Keys**: Generate and download your SSH private key (`.key` file).
103:
104: 2.  **Open Ports (Network)**:
105:    *   Go to your Instance details -> VCN -> Security Lists -> Default Security List.
106:    *   Add an **Ingress Rule**:
107:        *   Source: `0.0.0.0/0`
108:        *   Protocol: TCP
109:        *   Destination Port: `8002`
110:    *   *(Crucial Step)*: You also need to open the port on the VM's internal firewall (`iptables`):
111:        ```bash
112:        sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 8002 -j ACCEPT
113:        sudo netfilter-persistent save
114:        ```
115:
116: 3.  **Transfer Files**:
117:    *   Zip your project folder (excluding `node_modules` and `.git`):
118:        ```powershell
119:        # On your local windows machine
120:        Compress-Archive -Path "C:\path\to\agentathon\*" -DestinationPath "project.zip"
121:        ```
122:    *   Copy it to the VM using SCP (replace IPs and paths):
123:        ```bash
124:        scp -i "path/to/private.key" project.zip ubuntu@<VM_PUBLIC_IP>:~/
125:        ```
126:
127: 4.  **Setup & Run**:
128:    *   SSH into the VM: `ssh -i key.key ubuntu@<IP>`
129:    *   Install Python & Unzip:
130:        ```bash
131:        sudo apt update
132:        sudo apt install python3-pip unzip libgl1-mesa-glx -y
133:        unzip project.zip -d app
134:        cd app
135:        ```
136:    *   Install Dependencies:
137:        ```bash
138:        pip3 install fastapi uvicorn torch smplx numpy opencv-python trimesh pyrender scikit-learn pandas
139:        ```
140:    *   Run the Server:
141:        ```bash
142:        python3 desktop_tools/text_to_sign_server.py
143:        # OR with uvicorn directly
144:        uvicorn desktop_tools.text_to_sign_server:app --host 0.0.0.0 --port 8002
145:        ```
146:
147: 5.  **Connect Frontend**: Use `http://<VM_PUBLIC_IP>:8002` as your `VITE_API_URL`.
