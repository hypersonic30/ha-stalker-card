"""Same scenario as main.py, but with native HLS switched off so hls.js (the Android path) really runs."""
import os, runpy
os.environ["STALKER_FORCE_HLSJS"] = "1"
runpy.run_path(os.path.join(os.path.dirname(os.path.abspath(__file__)), "main.py"), run_name="__main__")
