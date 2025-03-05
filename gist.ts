import { $, file } from 'bun';
import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';

function selfExecute<T extends { new(...args: any[]): {} }>(constructor: T) {
  new constructor();
  return constructor;
}

@selfExecute
class Main {
  // API keys
  private geminiApiKey: string;
  private githubToken: string;
  private rl: readline.Interface;

  constructor() {
    this.geminiApiKey = process.env.GEMINI_API_KEY || '';
    this.githubToken = process.env.GITHUB_TOKEN_M || '';
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    this.initialize();
  }

  private initialize() {
    this.validateEnvironmentVariables();
    
    if (require.main === module) {
      this.run().catch(console.error).finally(() => this.rl.close());
    }
  }

  private validateEnvironmentVariables() {
    if (!this.geminiApiKey) {
      console.error('Error: GEMINI_API_KEY environment variable is not set');
      process.exit(1);
    }

    if (!this.githubToken) {
      console.error('Error: No GitHub token found in environment variables');
      process.exit(1);
    }
  }

  private async promptUser(question: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(question, resolve);
    });
  }

  async run() {
    // Get current working directory
    const currentDir = process.cwd();
    console.log(`Current working directory: ${currentDir}`);

    const files = this.listFiles(currentDir);
    this.displayFiles(files);

    const selectedFiles = await this.selectFiles(files);
    console.log("\nSelected files:", selectedFiles);

    // Process each selected file
    for (const file of selectedFiles) {
      const filePath = path.join(currentDir, file);
      const extension = path.extname(file).slice(1);

      console.log(`\nProcessing: ${file} (${extension})`);

      try {
        // Generate description using AI
        const description = await this.generateDescription(filePath, extension);
        console.log(`Description generated successfully.`);

        // Create a gist with the file and its description
        const gistUrl = await this.createGist(file, filePath, description, extension);
        console.log(`Gist created: ${gistUrl}`);

        this.saveDescription(currentDir, file, description);
      } catch (error) {
        console.error(`Error processing ${file}:`, error);
      }
    }
  }

  private listFiles(directory: string): string[] {
    return fs.readdirSync(directory)
      .filter((file: string) => fs.statSync(path.join(directory, file)).isFile());
  }

  private displayFiles(files: string[]) {
    console.log("\nAvailable files:");
    files.forEach((file, index) => {
      console.log(`${index + 1}. ${file}`);
    });
  }

  private async selectFiles(files: string[]): Promise<string[]> {
    const input = await this.promptUser("\nEnter file numbers to process (comma-separated, e.g., '1,3,5'): ");
    
    const selectedIndices = input.split(',')
      .map((num: string) => parseInt(num.trim()) - 1)
      .filter((index: number) => index >= 0 && index < files.length);

    return selectedIndices.map((index: number) => files[index]);
  }

  private saveDescription(directory: string, originalFile: string, description: string) {
    const descriptionFile = path.join(
      directory, 
      `${path.basename(originalFile, path.extname(originalFile))}.md`
    );
    
    fs.writeFileSync(descriptionFile, description);
    console.log(`Description saved to: ${descriptionFile}`);
  }

  async generateDescription(filePath: string, fileType: string): Promise<string> {
    const content = fs.readFileSync(filePath, 'utf-8');

    const truncatedContent = content.length > 5000 ? content.substring(0, 5000) + '...' : content;

    const prompt = `Please analyze this ${fileType} file and provide a detailed description:
    
Filename: ${path.basename(filePath)}
Content:
\`\`\`${fileType}
${truncatedContent}
\`\`\`

Generate a markdown description that includes:
1. A summary of what the file does
2. Key components or functions
3. Any notable patterns or techniques used
4. Potential use cases`;

    try {
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.geminiApiKey
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: prompt
            }]
          }]
        })
      });

      if (!response.ok) {
        throw new Error(`API request failed with status ${response.status}`);
      }

      const data = await response.json();

      // Extract the generated text from the response
      const generatedText = data.candidates[0].content.parts[0].text;

      // Format the final description
      return `# ${path.basename(filePath)} Description\n\n` +
        `**File Type:** ${fileType}\n\n` +
        `**Generated Description:**\n\n` +
        `${generatedText}\n\n` +
        `*Description generated on ${new Date().toLocaleString()}*`;
    } catch (error) {
      console.error('Error calling Gemini API:', error);

      // Fallback to a basic description if API call fails
      return `# ${path.basename(filePath)} Description\n\n` +
        `**File Type:** ${fileType}\n\n` +
        `**Generated Description:**\n` +
        `This is a ${fileType} file with approximately ${content.length} characters.\n\n` +
        `**Sample Content:**\n` +
        '```\n' + (content.length > 100 ? content.substring(0, 100) + '...' : content) + '\n```\n\n' +
        `*Description generated on ${new Date().toLocaleString()}*\n\n` +
        `Note: AI-powered description failed. This is a fallback description.`;
    }
  }

  async createGist(fileName: string, filePath: string, description: string, fileType: string): Promise<string> {
    try {
      // Read file content
      const fileContent = fs.readFileSync(filePath, 'utf-8');

      // Create a descriptive name for the gist
      const gistDescription = `${fileName} - AI-generated description`;

      // Prepare the files object for the gist
      const files: Record<string, { content: string }> = {
        [fileName]: {
          content: fileContent
        },
        [`${path.basename(fileName, path.extname(fileName))}_description.md`]: {
          content: description
        }
      };

      const response = await fetch('https://api.github.com/gists', {
        method: 'POST',
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': `Bearer ${this.githubToken}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          description: gistDescription,
          public: false,
          files: files
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`GitHub API request failed with status ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      return data.html_url;
    } catch (error) {
      console.error('Error creating gist:', error);
      return 'Failed to create gist';
    }
  }
}