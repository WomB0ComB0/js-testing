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
