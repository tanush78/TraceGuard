"""Print the reproducible synthetic benchmark without starting the API."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.detector import Detector

print(json.dumps(Detector().metadata, indent=2))
