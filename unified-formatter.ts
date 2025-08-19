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

import * as fs from 'fs';
import * as path from 'path';
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