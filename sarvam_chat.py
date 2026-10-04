import os
from pathlib import Path

from sarvamai import SarvamAI

env_path = Path(__file__).with_name(".env")
for line in env_path.read_text().splitlines():
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    name, value = line.split("=", 1)
    os.environ.setdefault(name.strip(), value.strip().strip('"').strip("'"))

api_key = os.environ.get("SARVAM_API_KEY", "").strip()
if not api_key:
    raise SystemExit("SARVAM_API_KEY is empty. Paste your key into .env and run this again.")

client = SarvamAI(api_subscription_key=api_key)
response = client.chat.completions(
    model="sarvam-105b-conversations",
    messages=[{"role": "user", "content": "Reply with one short sentence."}],
)
print(response.choices[0].message.content)
