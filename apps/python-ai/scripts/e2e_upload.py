import time

import httpx

with open("sample.wav", "rb") as handle:
    response = httpx.post(
        "http://localhost:8000/internal/songs/upload",
        files={"file": ("sample.wav", handle, "audio/wav")},
        data={"options": '{"educational_level":"intermediate"}'},
        timeout=30,
    )

print("upload", response.status_code, response.text)
payload = response.json()
job_id = payload["job_id"]
song_id = payload["song_id"]

job = {}
for _ in range(30):
    job = httpx.get(f"http://localhost:8000/internal/jobs/{job_id}", timeout=10).json()
    print("status", job["status"], job.get("progress"))
    if job["status"] in {"completed", "failed"}:
        break
    time.sleep(2)

if job["status"] == "completed":
    analysis = httpx.get(
        f"http://localhost:8000/internal/songs/{song_id}/analysis",
        timeout=10,
    ).json()
    print("analysis bpm", analysis["harmony"]["tempo_bpm"], "key", analysis["harmony"]["key"])
else:
    print("failed", job.get("error"))
