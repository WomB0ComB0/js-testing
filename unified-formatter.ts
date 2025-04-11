import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';

function selfExecute<T extends { new(...args: any[]): {} }>(constructor: T) {
  new constructor()
  return constructor;
}

@selfExecute
class Main {
  private rl: readline.Interface;
  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    })
    this.initialize()
  }
  
  private initialize() {
    if (require.main === module) {
      this.run().catch(console.error).finally(() => this.rl.close())
    }
  }
  
  private async promtUser(question: string): Promise<string> => {
    return new Promise((resolve): void => {
      this.rl.question(question, resolve)
    })
  }
  
  async run() => {
    const currentDir = process.cwd();
    console.log(`Current working directory: ${currentDir}`)
    
    
  }
  
  private listFiles(directory: string): string[] {
    return fs.readdirSync(directory)
      .filter((file: string) => fs.statSync(path.join(directory, file)).isFile())
  }
}