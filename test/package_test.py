"""Check the release ZIP layout using a disposable plugin checkout."""
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
import zipfile


class PackageTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        (self.root / "bin").mkdir()
        shutil.copyfile(Path(__file__).resolve().parents[1] / "bin/package", self.root / "bin/package")
        self.runtime = {
            "manyfold_openscad.gemspec": 'Gem::Specification.new do |spec|\n  spec.version = "0.0.0"\nend\n',
            "app/views/status.html.erb": "<p>Status</p>\n",
            "config/routes.rb": "# Routes\n",
            "db/migrate/create_library_models.rb": "# Migration\n",
            "lib/manyfold_openscad.rb": "# Plugin\n",
            "README.md": "# Installation and migrations\n",
            "LICENSE": "GNU Affero General Public License version 3\n",
            "docs/renderer-validation.md": "# Validation\n",
            "test/fixtures/simple_box.scad": "cube([100, 80, 40]);\n",
            "vendor/openscad/openscad.wasm": "Fixture WASM\n",
            "vendor/openscad/COPYING": "Fixture license\n",
        }
        for name, content in self.runtime.items():
            self.write(name, content)
        (self.root / "lib/manyfold_openscad.rb").chmod(0o755)
        for name in ("test/plugin_test.rb", "Dockerfile", "node_modules/package/index.js", ".git/config", "dist/old.zip"):
            self.write(name, "Excluded\n")

    def write(self, name, content):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def run_package(self, *arguments):
        return subprocess.run([sys.executable, str(self.root / "bin/package"), *arguments], cwd=self.root.parent, capture_output=True, text=True)

    def test_default_version_and_installable_archive(self):
        result = self.run_package()
        self.assertEqual(result.returncode, 0, result.stderr)
        output = self.root / "dist/manyfold_openscad.zip"
        self.assertEqual(result.stdout.strip(), str(output))
        with zipfile.ZipFile(output) as archive:
            self.assertEqual(set(archive.namelist()), set(self.runtime))
            for name, content in self.runtime.items():
                self.assertEqual(archive.read(name).decode("utf-8"), content)
            self.assertEqual(stat.S_IMODE(archive.getinfo("lib/manyfold_openscad.rb").external_attr >> 16), 0o755)

    def test_release_version_changes_archive_only(self):
        result = self.run_package("1.2.3")
        self.assertEqual(result.returncode, 0, result.stderr)
        with zipfile.ZipFile(self.root / "dist/manyfold_openscad.zip") as archive:
            expected = self.runtime["manyfold_openscad.gemspec"].replace('"0.0.0"', '"1.2.3"')
            self.assertEqual(archive.read("manyfold_openscad.gemspec").decode("utf-8"), expected)
        self.assertEqual((self.root / "manyfold_openscad.gemspec").read_text(encoding="utf-8"), self.runtime["manyfold_openscad.gemspec"])

    def test_upgrade_replaces_the_same_package(self):
        (self.root / "dist/old.zip").unlink()
        for version in ("0.1.0", "1.2.3"):
            result = self.run_package(version)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(list((self.root / "dist").iterdir()), [self.root / "dist/manyfold_openscad.zip"])
            with zipfile.ZipFile(self.root / "dist/manyfold_openscad.zip") as archive:
                expected = self.runtime["manyfold_openscad.gemspec"].replace('"0.0.0"', f'"{version}"')
                self.assertEqual(archive.read("manyfold_openscad.gemspec").decode("utf-8"), expected)
            self.assertEqual((self.root / "manyfold_openscad.gemspec").read_text(encoding="utf-8"), self.runtime["manyfold_openscad.gemspec"])

    def test_invalid_versions_create_no_package(self):
        for version in ("01.2.3", "1.2", "v1.2.3", "1.2.3-beta.1", "../1.2.3", "1.2.3/other"):
            with self.subTest(version=version):
                result = self.run_package(version)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("VERSION must be", result.stderr)
        self.assertEqual(list((self.root / "dist").iterdir()), [self.root / "dist/old.zip"])


if __name__ == "__main__":
    unittest.main()
