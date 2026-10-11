# Demo asset notices

The demo uses Manyfold 0.150.0's default compiled stylesheet and its icon fonts.
These files preserve the upstream license texts and notices for those assets.
Dependency versions come from `yarn.lock` in the pinned Docker image, rather
than the ranges in its `package.json`.

| Asset | Version | Notice |
| --- | --- | --- |
| Manyfold stylesheet | 0.150.0 | [AGPL-3.0](manyfold-LICENSE.md) |
| Bootstrap CSS | 5.3.8 | [MIT](bootstrap-LICENSE.txt) |
| Bootstrap Icons CSS and fonts | 1.13.1 | [MIT](bootstrap-icons-LICENSE.txt) |
| RPG Awesome Continued CSS and font | 1.0.6 | [Upstream license](rpg-awesome-continued-LICENSE.md), [notice](rpg-awesome-continued-NOTICE.txt), [README](rpg-awesome-continued-README.md) |
| Tom Select CSS | 2.6.2 | [Apache-2.0](tom-select-LICENSE.txt) |
| Uppy Core CSS | 6.0.1 | [MIT](uppy-core-LICENSE.txt) |
| Uppy Dashboard CSS | 5.1.0 | [MIT](uppy-dashboard-LICENSE.txt) |
| driver.js CSS | 1.8.0 | [MIT](driverjs-LICENSE.txt) |

RPG Awesome Continued is by Miguel Rodríguez, Daniela Howe and Ivan Montiel,
using icons from [Game Icons](https://game-icons.net/). Its package includes a
BSD-style `LICENSE.md`; its README and stylesheet identify the CSS as MIT, the
font as SIL OFL 1.1, and its documentation as CC BY 3.0. The original notices
are retained together with the full [MIT](MIT.txt), [OFL 1.1](OFL-1.1.txt), and
[CC BY 3.0](CC-BY-3.0.txt) texts.

[manifest.json](manifest.json) records each exact package download, version and
upstream repository, along with the pinned Manyfold image and
[stylesheet source](https://github.com/manyfold3d/manyfold/tree/449286dd994601226bf39a25ac852fe0414aa0dc).
The export copies this directory to the published demo alongside the plugin's
AGPL license and the OpenSCAD renderer's existing notices.
