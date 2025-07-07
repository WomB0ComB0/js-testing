/**
 * Copyright 2025 Mike Odnis
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { $, argv } from 'bun';

if (require.main === module) {
  (async () => {
    const excludedDirs = [
      './node_modules',
      './nested_*',
      './.git'
    ];
    

    const folderStructure = await $`tree -I "${excludedDirs.map(dir => dir.slice(2)).join('|')}"`.text().then(output => output.split('\n').map(line => line.trim()).filter(line => line.length > 0).slice(0, -1).join('\n'));
    
    console.log(folderStructure);
    
    const findArgs = ['.', '-type', 'f'];

    {
      for (const dir of excludedDirs) findArgs.push('-not', '-path', `${dir}/*`);
    }

    const output = await $`
      find ${findArgs} -exec sh -c 'echo ""; echo ""; echo "--------------------------------------------------------------------------------";  echo "{}:"; echo "--------------------------------------------------------------------------------"; cat {} | nl -ba -w1 -s" | "' \;
    `.text();
    
    console.log(output);
  })();
}
