import { $, file } from 'bun';
import * as path from 'path';
import * as fs from 'fs';

function selfExecute<T extends { new(...args: any[]): {} }>(constructor: T) {
  new constructor();
  return constructor;
}

@selfExecute
class Main {
  constructor() {
    if (require.main === module) {
      this.run();
    }
  }

  async run() {
    const scriptDir = path.dirname(process.argv[1]);
    console.log(`Script directory: ${scriptDir}`);
    
    // Get current working directory
    const currentDir = process.cwd();
    console.log(`Current working directory: ${currentDir}`);
    
    // List files in the current directory
    const files = fs.readdirSync(currentDir)
      .filter((file: string) => fs.statSync(path.join(currentDir, file)).isFile());
    
    // Allow user to select files
    console.log("\nAvailable files:");
    files.forEach((file, index) => {
      console.log(`${index + 1}. ${file}`);
    });
    
    // Get user input for file selection
    console.log("\nEnter file numbers to process (comma-separated, e.g., '1,3,5'):");
    const input = await new Promise<string>((resolve) => {
      process.stdin.once('data', (data) => {
        resolve(data.toString().trim());
      });
    });
    
    const selectedIndices = input.split(',').map((num: string) => parseInt(num.trim()) - 1);
    const selectedFiles = selectedIndices
      .filter((index: number) => index >= 0 && index < files.length)
      .map((index: number) => files[index]);
    
    console.log("\nSelected files:", selectedFiles);
    
    // Process each selected file
    for (const file of selectedFiles) {
      const filePath = path.join(currentDir, file);
      const extension = path.extname(file).slice(1);
      
      console.log(`\nProcessing: ${file} (${extension})`);
      
      // Generate description using AI (mock implementation)
      const description = await this.generateDescription(filePath, extension);
      
      console.log(`Description: ${description}`);
      
      // Save description to a file with the same name but .md extension
      const descriptionFile = path.join(currentDir, `${path.basename(file, path.extname(file))}.md`);
      fs.writeFileSync(descriptionFile, description);
      console.log(`Description saved to: ${descriptionFile}`);
    }
  }
  
  async generateDescription(filePath: string, fileType: string): Promise<string> {
    // Read file content
    const content = fs.readFileSync(filePath, 'utf-8');
    
    // In a real implementation, you would call an AI API here
    // This is a simple mock implementation
    const fileContent = content.length > 100 ? content.substring(0, 100) + '...' : content;
    
    return `# ${path.basename(filePath)} Description\n\n` +
           `**File Type:** ${fileType}\n\n` +
           `**Generated Description:**\n` +
           `This is a ${fileType} file with approximately ${content.length} characters.\n\n` +
           `**Sample Content:**\n` +
           '```\n' + fileContent + '\n```\n\n' +
           `*Description generated on ${new Date().toLocaleString()}*`;
  }
}