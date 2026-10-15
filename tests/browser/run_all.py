"""Runs every browser test script in turn (they share one fixed port)."""
import glob, os, subprocess, sys

here = os.path.dirname(os.path.abspath(__file__))
bad = 0
for f in sorted(glob.glob(os.path.join(here, "*.py"))):
    if os.path.basename(f).startswith("_") or f.endswith("run_all.py"):
        continue
    print(f"== {os.path.basename(f)}")
    bad += subprocess.run([sys.executable, f], cwd=here).returncode != 0
sys.exit(1 if bad else 0)
