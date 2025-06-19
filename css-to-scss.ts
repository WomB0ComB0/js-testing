#!/usr/bin/env bun
(async() => { await Bun.write(process.argv[3], (await Bun.file(process.argv[2]).text()).replace(/--([a-zA-Z0-9\-_]+)/g, '$$$1'))})();