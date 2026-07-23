# Kuafuor Motion Lab ☁️ 雲端精析 — async pose analysis on Modal (scale-to-zero, T4).
# Mirrors the SenseVoice pipeline exactly:
#   POST / (bearer SENSEVOICE_TOKEN)  { video_url, out_put_url, callback_url, job_id }
#   202: { "spawned": true, "job_id": "<uuid>" }  — result arrives later via the callback.
# The GPU job: yolo11m-pose + ByteTrack (multi-person), draws skeletons onto every analysed
# frame, encodes an H.264 MP4, PUTs it to the pre-signed Supabase upload URL, computes per-person
# stats, then POSTs { job_id, duration_ms, stats } to the callback (x-callback-secret).
# 唔蝕錢 caps: 3-minute video max, analyse at <=15 fps, long side <=960px, hard 1800s timeout.
# Modal secret "sensevoice" provides: SENSEVOICE_TOKEN, CALLBACK_SECRET (CALLBACK_URL unused here —
# the edge function passes pose-callback's URL per request).
import os
import modal
from fastapi import Header, HTTPException

app = modal.App("kuafuor-poselab")

MAX_MS = 183_000          # 3 min (+3s tolerance)
ANALYZE_FPS = 15
LONG_SIDE = 960

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "libgl1", "libglib2.0-0")
    .pip_install(
        "ultralytics==8.3.49",
        "opencv-python-headless==4.10.0.84",
        "imageio[ffmpeg]==2.36.1",
        "lapx>=0.5.5",          # ByteTrack assignment
        "requests",
    )
    # 焗模型入 image：cold start 唔使再落 weights
    .run_commands("python -c \"from ultralytics import YOLO; YOLO('yolo11m-pose.pt')\"")
)


@app.cls(
    gpu="T4",
    image=image,
    secrets=[modal.Secret.from_name("sensevoice")],
    scaledown_window=300,
    timeout=1800,
)
class PoseLab:
    @modal.enter()
    def load(self):
        from ultralytics import YOLO
        self.model = YOLO("yolo11m-pose.pt")

    @modal.method()
    def run(self, video_url: str, out_put_url: str, callback_url: str, job_id: str):
        import math
        import tempfile
        import cv2
        import imageio
        import requests

        callback_secret = os.environ["CALLBACK_SECRET"]

        def report(payload):
            try:
                requests.post(callback_url, json={"job_id": job_id, **payload},
                              headers={"x-callback-secret": callback_secret}, timeout=30)
            except Exception as e:  # noqa: BLE001
                print("callback failed:", e)

        try:
            # 1) 落片
            src = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False).name
            with requests.get(video_url, stream=True, timeout=120) as r:
                r.raise_for_status()
                with open(src, "wb") as f:
                    for chunk in r.iter_content(1 << 20):
                        f.write(chunk)

            # 2) probe + 唔蝕錢 caps
            cap = cv2.VideoCapture(src)
            fps = cap.get(cv2.CAP_PROP_FPS) or 30
            n_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
            w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
            h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
            cap.release()
            if fps <= 0 or n_frames <= 0 or w <= 0 or h <= 0:
                report({"error": "讀唔到影片（格式唔支援）"}); return
            duration_ms = int(n_frames / fps * 1000)
            if duration_ms > MAX_MS:
                report({"error": f"影片太長（{duration_ms/1000:.0f} 秒）— 上限 3 分鐘"}); return

            stride = max(1, round(fps / ANALYZE_FPS))
            out_fps = fps / stride
            scale = min(1.0, LONG_SIDE / max(w, h))
            ow, oh = (int(w * scale) // 2 * 2, int(h * scale) // 2 * 2)

            # 3) track + 標註 + 統計
            writer = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False).name
            wr = imageio.get_writer(writer, fps=max(1.0, out_fps), codec="libx264",
                                    pixelformat="yuv420p", macro_block_size=2, quality=7)
            people = {}   # track_id -> stats accumulator
            frame_i = 0
            results = self.model.track(source=src, stream=True, persist=True,
                                       imgsz=LONG_SIDE, vid_stride=stride,
                                       tracker="bytetrack.yaml", verbose=False)
            for res in results:
                frame = res.plot(line_width=2)          # BGR，骨架+框+ID 已燒
                if scale < 1.0:
                    frame = cv2.resize(frame, (ow, oh))
                wr.append_data(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))

                if res.keypoints is not None and res.boxes is not None and res.boxes.id is not None:
                    ids = res.boxes.id.int().tolist()
                    kps = res.keypoints.xy.cpu().numpy()      # (n,17,2) COCO
                    boxes = res.boxes.xyxy.cpu().numpy()
                    t = frame_i * stride / fps
                    for pid, kp, bb in zip(ids, kps, boxes):
                        p = people.setdefault(pid, {
                            "frames": 0, "first_t": t, "last_t": t,
                            "prev": None, "max_speed": 0.0, "speed_sum": 0.0,
                            "speed_n": 0, "punches": 0, "above": False,
                        })
                        p["frames"] += 1
                        p["last_t"] = t
                        bh = max(1.0, float(bb[3] - bb[1]))   # 人高做歸一化基準
                        wrists = [kp[9], kp[10]]              # COCO: 9=左腕 10=右腕
                        if p["prev"] is not None:
                            dt = max(1e-3, t - p["prev"]["t"])
                            sp = 0.0
                            for wi, wxy in enumerate(wrists):
                                px, py = p["prev"]["w"][wi]
                                if px > 0 and wxy[0] > 0:
                                    d = math.hypot(wxy[0] - px, wxy[1] - py) / bh   # 身位/秒
                                    sp = max(sp, d / dt)
                            p["max_speed"] = max(p["max_speed"], sp)
                            p["speed_sum"] += sp; p["speed_n"] += 1
                            # 揮拳估計：手速指數升穿 3 身位/秒 當一次（上升沿）
                            if sp > 3.0 and not p["above"]:
                                p["punches"] += 1; p["above"] = True
                            elif sp < 1.5:
                                p["above"] = False
                        p["prev"] = {"t": t, "w": [(float(x), float(y)) for x, y in wrists]}
                frame_i += 1
            wr.close()

            # 4) 上載已標註 MP4（pre-signed PUT，零額外憑證）
            with open(writer, "rb") as f:
                up = requests.put(out_put_url, data=f,
                                  headers={"Content-Type": "video/mp4", "x-upsert": "true"},
                                  timeout=300)
            if up.status_code >= 300:
                report({"error": f"上載結果失敗 ({up.status_code})"}); return

            stats = {
                "analyzed_fps": round(out_fps, 1),
                "people": [
                    {
                        "id": pid,
                        "seconds": round(p["last_t"] - p["first_t"], 1),
                        "max_hand_speed": round(p["max_speed"], 2),      # 身位/秒
                        "avg_hand_speed": round(p["speed_sum"] / p["speed_n"], 2) if p["speed_n"] else 0,
                        "punch_estimate": p["punches"],
                    }
                    for pid, p in sorted(people.items(), key=lambda kv: -kv[1]["frames"])[:8]
                ],
            }
            report({"duration_ms": duration_ms, "stats": stats})
        except Exception as e:  # noqa: BLE001
            report({"error": str(e)[:400]})


# CPU ack endpoint：驗 token、spawn GPU job、即刻返（同 SenseVoice 一樣嘅 async 樣式）
web_image = modal.Image.debian_slim(python_version="3.11").pip_install("fastapi[standard]==0.115.6")


@app.function(image=web_image, secrets=[modal.Secret.from_name("sensevoice")])
@modal.fastapi_endpoint(method="POST", docs=False)
def pose(data: dict, authorization: str = Header(default=None)):
    import os
    if not authorization or authorization != "Bearer " + os.environ["SENSEVOICE_TOKEN"]:
        raise HTTPException(status_code=401, detail="unauthorized")
    for k in ("video_url", "out_put_url", "callback_url", "job_id"):
        if not (data or {}).get(k):
            raise HTTPException(status_code=400, detail=f"{k} required")
    PoseLab().run.spawn(data["video_url"], data["out_put_url"], data["callback_url"], data["job_id"])
    return {"spawned": True, "job_id": data["job_id"]}
