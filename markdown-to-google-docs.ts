import { Logger, LogLevel } from './logger';
import { convertMarkdownToPlainText } from './markdown-to-text';
import { google } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';

function selfExecute<T extends { new(...args: any[]): {} }>(constructor: T) {
  new constructor();
  return constructor;
}

interface GoogleDocOptions {
  title: string;
  recipientEmail: string;
  markdownContent: string;
  credentialsPath?: string;
}

// Create a logger instance for this module
const logger = Logger.getLogger('GoogleDocsManager', {
  minLevel: LogLevel.INFO,
  includeTimestamp: true
});

class GoogleDocsManager {
  private auth: GoogleAuth;
  private docsService: any;
  private driveService: any;

  constructor(credentialsPath: string = './service-account.json') {
    this.auth = new GoogleAuth({
      keyFile: credentialsPath,
      scopes: [
        'https://www.googleapis.com/auth/documents',
        'https://www.googleapis.com/auth/drive'
      ]
    });

    this.docsService = google.docs({ version: 'v1', auth: this.auth });
    this.driveService = google.drive({ version: 'v3', auth: this.auth });
    logger.debug('GoogleDocsManager initialized', { credentialsPath });
  }

  async createDocument(title: string): Promise<string> {
    try {
      const response = await logger.time('Create Google Doc', async () => {
        return await this.docsService.documents.create({
          requestBody: {
            title: title
          }
        });
      });
      
      logger.info(`Document created with ID: ${response.data.documentId}`, { title });
      return response.data.documentId;
    } catch (error) {
      logger.error(`Error creating Google Doc`, error);
      throw error;
    }
  }

  async shareDocument(documentId: string, email: string): Promise<void> {
    try {
      await logger.time('Share Google Doc', async () => {
        return await this.driveService.permissions.create({
          fileId: documentId,
          requestBody: {
            type: 'user',
            role: 'writer',
            emailAddress: email
          }
        });
      });
      
      logger.info(`Document shared with ${email}`, { documentId });
    } catch (error) {
      logger.error(`Error sharing Google Doc`, error, { documentId, email });
      throw error;
    }
  }

  async updateDocumentContent(documentId: string, content: string): Promise<void> {
    try {
      await logger.time('Update document content', async () => {
        return await this.docsService.documents.batchUpdate({
          documentId: documentId,
          requestBody: {
            requests: [
              {
                insertText: {
                  location: {
                    index: 1
                  },
                  text: content
                }
              }
            ]
          }
        });
      });
      
      logger.info('Document content updated successfully', { 
        documentId, 
        contentLength: content.length 
      });
    } catch (error) {
      logger.error(`Error updating Google Doc content`, error, { documentId });
      throw error;
    }
  }

  async createAndShareDocument(options: GoogleDocOptions): Promise<string> {
    try {
      logger.info('Starting document creation process', { 
        title: options.title, 
        recipient: options.recipientEmail 
      });
      
      // Convert markdown to plain text
      const plainText = await convertMarkdownToPlainText(options.markdownContent);
      
      // Create a new document
      const documentId = await this.createDocument(options.title);
      
      // Update document with content
      await this.updateDocumentContent(documentId, plainText);
      
      // Share the document
      await this.shareDocument(documentId, options.recipientEmail);
      
      const documentUrl = `https://docs.google.com/document/d/${documentId}/edit`;
      logger.success('Document created, updated, and shared successfully', { documentUrl });
      
      // Return the document URL
      return documentUrl;
    } catch (error) {
      logger.error(`Error in createAndShareDocument`, error, { 
        title: options.title, 
        recipient: options.recipientEmail 
      });
      throw error;
    }
  }
}

@selfExecute
class Main {
  constructor() {
    if (require.main === module) {
      this.main();
    }
  }

  async main() {
    const args = process.argv.slice(2);
  
  if (args.length < 3) {
    console.log('Usage: bun run markdown-to-google-docs.ts <input.md> <document-title> <recipient-email> [credentials-path]');
    process.exit(1);
  }
  
  const [inputFile, title, email, credentialsPath] = args;
  
  try {
    // Read markdown content from file
    const markdownContent = await Bun.file(inputFile).text();
    
    // Create Google Docs manager
    const manager = new GoogleDocsManager(credentialsPath);
    
    // Create and share document
    const documentUrl = await manager.createAndShareDocument({
      title,
      recipientEmail: email,
      markdownContent
    });
    
    console.log(`Document created and shared successfully!`);
    console.log(`URL: ${documentUrl}`);
  } catch (error) {
    console.error(`Error: ${error}`);
    process.exit(1);
    }
  }
}

export { GoogleDocsManager, GoogleDocOptions, Main }; 