"""Run the plugin's container tests against a disposable release ZIP."""
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import zipfile


def main():
    root = Path(__file__).resolve().parents[1]
    version = "1.2.3"
    with tempfile.TemporaryDirectory(prefix="manyfold-openscad-package-test-") as temporary:
        workspace = Path(temporary)
        source = workspace / "source"
        source.mkdir()
        for directory in ("app", "config", "db", "lib", "vendor", "docs"):
            shutil.copytree(root / directory, source / directory)
        shutil.copytree(root / "test/fixtures", source / "test/fixtures")
        shutil.copy2(root / "manyfold_openscad.gemspec", source)
        shutil.copy2(root / "README.md", source)
        shutil.copy2(root / "LICENSE", source)
        (source / "bin").mkdir()
        shutil.copy2(root / "bin/package", source / "bin/package")
        subprocess.run([sys.executable, str(source / "bin/package"), version], check=True, stdout=subprocess.DEVNULL)

        plugin = workspace / "plugin"
        with zipfile.ZipFile(source / "dist/manyfold_openscad.zip") as archive:
            archive.extractall(plugin)
        (plugin / "test").mkdir(exist_ok=True)
        print(f"Testing plugin from release ZIP (version {version}).", flush=True)
        subprocess.run([str(root / "test/run-container"), str(plugin), version], check=True)


if __name__ == "__main__":
    main()
