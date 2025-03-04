import { Logger, LogLevel } from './logger';
import { convertMarkdownToPlainText } from './markdown-to-text';
import { google } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';
import { marked } from 'marked';
import type { Token, Tokens } from 'marked';
import * as stringSimilarity from 'string-similarity';

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

type ParagraphPosition = { 
  startIndex: number, 
  endIndex: number, 
  content: string 
};

interface RendererContext {
  findTextPositions: (contentWithPositions: {text: string, startIndex: number, endIndex: number}[], text: string) => {startIndex: number, endIndex: number}[];
  contentWithPositions: {text: string, startIndex: number, endIndex: number}[];
  requests: any[];
  paragraphs: ParagraphPosition[];
  findParagraphByText: (paragraphs: ParagraphPosition[], text: string) => ParagraphPosition | null;
}

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

  async convertMarkdownToFormattedDoc(documentId: string, markdownContent: string): Promise<void> {
    try {
      logger.debug('Starting markdown conversion', { documentId });
      
      // First convert to plain text (keeping markdown syntax)
      const plainText = convertMarkdownToPlainText(markdownContent);
      await this.updateDocumentContent(documentId, plainText);
      
      // Get the document
      const document = await this.docsService.documents.get({ documentId });
      
      // Apply formatting
      const requests = await this.createFormattingRequestsFromMarkdown(markdownContent, document.data);
      
      // Apply formatting in batches
      if (requests.length > 0) {
        await logger.time('Apply text formatting', async () => {
          const batchSize = 1000;
          for (let i = 0; i < requests.length; i += batchSize) {
            const batch = requests.slice(i, i + batchSize);
            await this.docsService.documents.batchUpdate({
              documentId: documentId,
              requestBody: {
                requests: batch
              }
            });
          }
        });
      }
      
      // Now clean up the markdown syntax
      const cleanupRequests = this.createMarkdownSyntaxCleanupRequests(document.data);
      if (cleanupRequests.length > 0) {
        await this.docsService.documents.batchUpdate({
          documentId: documentId,
          requestBody: {
            requests: cleanupRequests
          }
        });
      }
      
      logger.info('Document formatting applied successfully', { 
        documentId, 
        requestCount: requests.length 
      });
    } catch (error) {
      logger.error(`Error formatting Google Doc content`, error, { documentId });
      throw error;
    }
  }

  private processTokensRecursively(tokens: Token[], context: RendererContext): void {
    for (const token of tokens) {
      switch (token.type) {
        case 'strong':
          this.applyStrongFormatting(token as Tokens.Strong, context);
          break;
        case 'em':
          this.applyEmFormatting(token as Tokens.Em, context);
          break;
        case 'link':
          this.applyLinkFormatting(token as Tokens.Link, context);
          break;
        case 'codespan':
          this.applyCodespanFormatting(token as Tokens.Codespan, context);
          break;
      }
      
      if ('tokens' in token && Array.isArray(token.tokens)) {
        this.processTokensRecursively(token.tokens, context);
      }
      
      if (token.type === 'list') {
        const listToken = token as Tokens.List;
        for (const item of listToken.items) {
          if (item.tokens) {
            this.processTokensRecursively(item.tokens, context);
          }
        }
      }
    }
  }

  private applyStrongFormatting(token: Tokens.Strong, context: RendererContext): void {
    const cleanText = token.text.replace(/<[^>]*>/g, '');
    const positions = context.findTextPositions(context.contentWithPositions, cleanText);
    for (const position of positions) {
      context.requests.push({
        updateTextStyle: {
          range: {
            startIndex: position.startIndex,
            endIndex: position.endIndex
          },
          textStyle: {
            bold: true
          },
          fields: 'bold'
        }
      });
    }
  }

  private applyEmFormatting(token: Tokens.Em, context: RendererContext): void {
    const positions = context.findTextPositions(context.contentWithPositions, token.text);
    for (const position of positions) {
      context.requests.push({
        updateTextStyle: {
          range: {
            startIndex: position.startIndex,
            endIndex: position.endIndex
          },
          textStyle: {
            italic: true
          },
          fields: 'italic'
        }
      });
    }
  }

  private applyLinkFormatting(token: Tokens.Link, context: RendererContext): void {
    const positions = context.findTextPositions(context.contentWithPositions, token.text);
    for (const position of positions) {
      context.requests.push({
        updateTextStyle: {
          range: {
            startIndex: position.startIndex,
            endIndex: position.endIndex
          },
          textStyle: {
            link: {
              url: token.href
            }
          },
          fields: 'link'
        }
      });
    }
  }

  private applyCodespanFormatting(token: Tokens.Codespan, context: RendererContext): void {
    const positions = context.findTextPositions(context.contentWithPositions, token.text);
    for (const position of positions) {
      context.requests.push({
        updateTextStyle: {
          range: {
            startIndex: position.startIndex,
            endIndex: position.endIndex
          },
          textStyle: {
            weightedFontFamily: {
              fontFamily: 'Courier New'
            }
          },
          fields: 'weightedFontFamily'
        }
      });
    }
  }

  private async createFormattingRequestsFromMarkdown(markdownContent: string, document: any): Promise<any[]> {
    const requests: any[] = [];
    
    const renderer = new marked.Renderer();
    const contentWithPositions = this.getContentWithPositions(document);
    
    const paragraphs = document.body.content
      .filter((item: any) => item.paragraph)
      .map((item: any) => ({
        startIndex: item.startIndex,
        endIndex: item.endIndex,
        content: item.paragraph.elements.map((el: any) => el.textRun?.content || '').join('')
      }));
    
    type ContentPosition = {text: string, startIndex: number, endIndex: number};
    type ParagraphPosition = {startIndex: number, endIndex: number, content: string};
    
    type RendererContext = {
      findParagraphByText: (paragraphs: ParagraphPosition[], text: string) => ParagraphPosition | null;
      findTextPositions: (contentWithPositions: ContentPosition[], text: string) => TextPosition[];
      paragraphs: ParagraphPosition[];
      contentWithPositions: ContentPosition[];
      requests: any[];
    };
    
    const context: RendererContext = {
      findParagraphByText: this.findParagraphByText.bind(this),
      findTextPositions: this.findTextPositions.bind(this),
      paragraphs,
      contentWithPositions,
      requests
    };

    function isHeadingToken(token: Tokens.Generic): token is Tokens.Heading {
      return token.type === 'heading' && 'depth' in token && 'text' in token;
    }

    function isListToken(token: Tokens.Generic): token is Tokens.List {
      return token.type === 'list' && 'items' in token && 'ordered' in token;
    }

    type TextPosition = { startIndex: number, endIndex: number };

    function stripHtml(html: string): string {
      return html.replace(/<[^>]*>/g, '');
    }

    renderer.heading = function(token: Tokens.Heading): string {
      if (!isHeadingToken(token)) {
        logger.warn('Invalid heading token', token);
        return '';
      }
      
      const cleanText = stripHtml(token.text);
      
      const paragraph = context.findParagraphByText(context.paragraphs, cleanText);
      if (paragraph) {
        context.requests.push({
          updateParagraphStyle: {
            range: {
              startIndex: paragraph.startIndex,
              endIndex: paragraph.endIndex - 1
            },
            paragraphStyle: {
              namedStyleType: `HEADING_${Math.min(Math.max(token.depth, 1), 6)}`
            },
            fields: 'namedStyleType'
          }
        });
      }
      return cleanText;
    };
    
    renderer.strong = function({ text }: Tokens.Strong): string {
      const positions = context.findTextPositions(context.contentWithPositions, text);
      for (const position of positions) {
        context.requests.push({
          updateTextStyle: {
            range: {
              startIndex: position.startIndex,
              endIndex: position.endIndex
            },
            textStyle: {
              bold: true
            },
            fields: 'bold'
          }
        });
      }
      return text;
    };
    
    renderer.em = function({ text }: Tokens.Em): string {
      const positions = context.findTextPositions(context.contentWithPositions, text);
      for (const position of positions) {
        context.requests.push({
          updateTextStyle: {
            range: {
              startIndex: position.startIndex,
              endIndex: position.endIndex
            },
            textStyle: {
              italic: true
            },
            fields: 'italic'
          }
        });
      }
      return text;
    };
    
    renderer.link = function({ href, title, text }: Tokens.Link): string {
      const positions = context.findTextPositions(context.contentWithPositions, text);
      for (const position of positions) {
        context.requests.push({
          updateTextStyle: {
            range: {
              startIndex: position.startIndex,
              endIndex: position.endIndex
            },
            textStyle: {
              link: {
                url: href
              }
            },
            fields: 'link'
          }
        });
      }
      return text;
    };
    
    renderer.code = function({ text, lang, escaped }: Tokens.Code): string {
      const positions = context.findTextPositions(context.contentWithPositions, text);
      for (const position of positions) {
        context.requests.push({
          updateTextStyle: {
            range: {
              startIndex: position.startIndex,
              endIndex: position.endIndex
            },
            textStyle: {
              weightedFontFamily: {
                fontFamily: 'Courier New'
              },
              backgroundColor: {
                color: {
                  rgbColor: {
                    red: 0.95,
                    green: 0.95,
                    blue: 0.95
                  }
                }
              }
            },
            fields: 'weightedFontFamily,backgroundColor'
          }
        });
      }
      return text;
    };
    
    renderer.codespan = function({ text }: Tokens.Codespan): string {
      const positions = context.findTextPositions(context.contentWithPositions, text);
      for (const position of positions) {
        context.requests.push({
          updateTextStyle: {
            range: {
              startIndex: position.startIndex,
              endIndex: position.endIndex
            },
            textStyle: {
              weightedFontFamily: {
                fontFamily: 'Courier New'
              }
            },
            fields: 'weightedFontFamily'
          }
        });
      }
      return text;
    };
    
    renderer.list = function(token: Tokens.List): string {
      if (!isListToken(token)) {
        logger.warn('Invalid list token', token);
        return '';
      }

      for (const item of token.items) {
        const paragraph = context.findParagraphByText(context.paragraphs, item.text.trim());
        if (paragraph) {
          context.requests.push({
            createParagraphBullets: {
              range: {
                startIndex: paragraph.startIndex,
                endIndex: paragraph.endIndex - 1
              },
              bulletPreset: token.ordered ? 'NUMBERED_DECIMAL_NESTED' : 'BULLET_DISC_CIRCLE_SQUARE'
            }
          });
        }
      }
      
      return token.items.map(item => item.text).join('\n');
    };
    
    const tokens = marked.lexer(markdownContent);
    
    this.processTokensRecursively(tokens, context);
    
    for (const token of tokens) {
      if (token.type === 'heading') {
        const headingToken = token as Tokens.Heading;
        const paragraph = context.findParagraphByText(context.paragraphs, headingToken.text.trim());
        if (paragraph) {
          let headingStyle: string;
          switch (headingToken.depth) {
            case 1: headingStyle = 'HEADING_1'; break;
            case 2: headingStyle = 'HEADING_2'; break;
            case 3: headingStyle = 'HEADING_3'; break;
            case 4: headingStyle = 'HEADING_4'; break;
            case 5: headingStyle = 'HEADING_5'; break;
            case 6: headingStyle = 'HEADING_6'; break;
            default: headingStyle = 'NORMAL_TEXT';
          }
          
          context.requests.push({
            updateParagraphStyle: {
              range: {
                startIndex: paragraph.startIndex,
                endIndex: paragraph.endIndex - 1
              },
              paragraphStyle: {
                namedStyleType: headingStyle
              },
              fields: 'namedStyleType'
            }
          });
        }
      } else if (token.type === 'list') {
        const listToken = token as Tokens.List;
        const paragraphs = context.paragraphs;
        
        for (const item of listToken.items) {
          const paragraph = context.findParagraphByText(paragraphs, item.text.trim());
          if (paragraph) {
            requests.push({
              createParagraphBullets: {
                range: {
                  startIndex: paragraph.startIndex,
                  endIndex: paragraph.endIndex - 1
                },
                bulletPreset: listToken.ordered ? 'NUMBERED_DECIMAL_NESTED' : 'BULLET_DISC_CIRCLE_SQUARE'
              }
            });
          }
        }
      }
    }
    
    return requests;
  }

  public getContentWithPositions(document: any): {text: string, startIndex: number, endIndex: number}[] {
    const result: {text: string, startIndex: number, endIndex: number}[] = [];
    
    if (document.body && document.body.content) {
      for (const item of document.body.content) {
        if (item.paragraph) {
          for (const element of item.paragraph.elements) {
            if (element.textRun && element.textRun.content) {
              result.push({
                text: element.textRun.content,
                startIndex: element.startIndex,
                endIndex: element.endIndex
              });
            }
          }
        }
      }
    }
    
    return result;
  }

  public findTextPositions(contentWithPositions: {text: string, startIndex: number, endIndex: number}[], searchText: string): {startIndex: number, endIndex: number}[] {
    const results: {startIndex: number, endIndex: number}[] = [];
    
    for (const item of contentWithPositions) {
      let index = item.text.indexOf(searchText);
      while (index !== -1) {
        results.push({
          startIndex: item.startIndex + index,
          endIndex: item.startIndex + index + searchText.length
        });
        index = item.text.indexOf(searchText, index + 1);
      }
    }
    
    return results;
  }

  public findParagraphByText(
    paragraphs: ParagraphPosition[],
    text: string,
    similarityThreshold = 0.8
  ): ParagraphPosition | null {
    const target = text.trim().toLowerCase();
    
    for (const paragraph of paragraphs) {
      const source = paragraph.content.trim().toLowerCase();
      const similarity = stringSimilarity.compareTwoStrings(source, target);
      
      if (similarity >= similarityThreshold) {
        return paragraph;
      }
    }
    
    logger.warn('Paragraph not found for text:', { target, paragraphs });
    return null;
  }

  private createMarkdownSyntaxCleanupRequests(document: any): any[] {
    const requests: any[] = [];
    const contentWithPositions = this.getContentWithPositions(document);
    
    // Find and replace markdown syntax patterns
    const patterns = [
      { regex: /\*\*(.*?)\*\*/g, replacement: '$1' },  // Bold
      { regex: /\*(.*?)\*/g, replacement: '$1' },      // Italic
      { regex: /`(.*?)`/g, replacement: '$1' },        // Code
      { regex: /__(.*?)__/g, replacement: '$1' },      // Underline
      { regex: /_(.*?)_/g, replacement: '$1' },        // Underline/Italic
      { regex: /~~(.*?)~~/g, replacement: '$1' }       // Strikethrough
    ];
    
    for (const item of contentWithPositions) {
      for (const pattern of patterns) {
        let match;
        while ((match = pattern.regex.exec(item.text)) !== null) {
          const fullMatch = match[0];
          const startIndex = item.startIndex + match.index;
          const endIndex = startIndex + fullMatch.length;
          
          requests.push({
            replaceAllText: {
              replaceText: match[1],  // The text without markdown syntax
              containsText: {
                text: fullMatch,
                matchCase: true
              }
            }
          });
        }
      }
    }
    
    return requests;
  }

  async createAndShareDocument(options: GoogleDocOptions): Promise<string> {
    try {
      logger.info('Starting document creation process', { 
        title: options.title, 
        recipient: options.recipientEmail 
      });
      
      const documentId = await this.createDocument(options.title);
      
      await this.convertMarkdownToFormattedDoc(documentId, options.markdownContent);
      
      await this.shareDocument(documentId, options.recipientEmail);
      
      const documentUrl = `https://docs.google.com/document/d/${documentId}/edit`;
      logger.success('Document created, updated, and shared successfully', { documentUrl });
      
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
      const markdownContent = await Bun.file(inputFile).text();
      
      const manager = new GoogleDocsManager(credentialsPath);
      
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