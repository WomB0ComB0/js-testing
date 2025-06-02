import { Octokit } from '@octokit/rest';
import { env, argv } from 'bun';

function selfExecute<T extends { new(...args: any[]): {} }>(constructor: T): T {
  new constructor();
  return constructor;
}

@selfExecute
class Main {
  private octokit: Octokit;
  private args: [string, ...string[]] = argv.slice(2) as [string, ...string[]];
  private fundingContent: string[] = [
    'github: WomB0ComB0',
    'open_collective: mike-odnis', 
    'ko_fi: Y8Y77AJEA',
    'buy_me_a_coffee: mikeodnis'
  ];

  constructor() {
    if (!env.GITHUB_TOKEN) {
      throw new Error('GITHUB_TOKEN environment variable is required');
    }
    
    this.octokit = new Octokit({ auth: env.GITHUB_TOKEN });

    if (this.args.length < 2) {
      throw new Error('Owner and repo arguments are required');
    }

    if (require.main === module) {
      this.updateFundingFile();
    }
  }

  async updateFundingFile() {
    const [owner, repo, path = '.github/FUNDING.yml'] = this.args;
    const content = Buffer.from(this.fundingContent.join('\n') + '\n').toString('base64');

    try {
      // Try to get existing file first
      const { data } = await this.octokit.repos.getContent({
        owner,
        repo, 
        path
      });

      // Update existing file
      await this.octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path,
        message: 'Update FUNDING.yml',
        content,
        sha: (data as any).sha
      });

      console.log('Successfully updated FUNDING.yml');

    } catch (error: any) {
      if (error.status === 404) {
        // Create new file if it doesn't exist
        await this.octokit.repos.createOrUpdateFileContents({
          owner,
          repo,
          path,
          message: 'Create FUNDING.yml',
          content
        });
        
        console.log('Successfully created FUNDING.yml');
      } else {
        console.error('Error updating FUNDING.yml:', error.message);
        throw error;
      }
    }
  }
}