import { marked } from 'marked';
import type { MarkedOptions, Renderer, Tokens } from 'marked';
import { Logger, LogLevel } from './logger';

// Create a logger instance for this module
const logger = Logger.getLogger('MarkdownToText', {
  minLevel: LogLevel.INFO,
  includeTimestamp: true
});

interface PlainTextRendererOptions extends MarkedOptions {
  spaces?: boolean;
}

class PlainTextRenderer implements Renderer {
  parser: any;
  options: PlainTextRendererOptions;
  private whitespaceDelimiter: string;

  constructor(options?: PlainTextRendererOptions) {
    this.options = options || {};
    this.whitespaceDelimiter = this.options.spaces ? ' ' : '\n';
    this.parser = {
      parse: (text: string) => text
    };
    logger.debug('PlainTextRenderer initialized', { options: this.options });
  }

  // Helper method to safely convert any value to string
  private safeToString(value: any): string {
    if (value == null) {
      return '';
    }
    
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch (e) {
        logger.warn('Failed to stringify object', { error: e });
        return '[Complex Object]';
      }
    }
    
    return String(value);
  }

  // Renderer methods
  space(): string {
    return this.whitespaceDelimiter;
  }

  code(token: Tokens.Code): string {
    return `${this.whitespaceDelimiter}${this.whitespaceDelimiter}${this.safeToString(token.text)}${this.whitespaceDelimiter}${this.whitespaceDelimiter}`;
  }

  blockquote(token: Tokens.Blockquote): string {
    return `\t${this.safeToString(token.text)}${this.whitespaceDelimiter}`;
  }

  html(token: Tokens.HTML | Tokens.Tag): string {
    return this.safeToString(token.text);
  }

  heading(token: Tokens.Heading): string {
    return this.safeToString(token.text);
  }

  hr(): string {
    return `${this.whitespaceDelimiter}${this.whitespaceDelimiter}`;
  }

  list(token: Tokens.List): string {
    return this.safeToString(token.items.map(item => item.text).join(this.whitespaceDelimiter));
  }

  listitem(token: Tokens.ListItem): string {
    return `\t${this.safeToString(token.text)}${this.whitespaceDelimiter}`;
  }

  paragraph(token: Tokens.Paragraph): string {
    return `${this.whitespaceDelimiter}${this.safeToString(token.text)}${this.whitespaceDelimiter}`;
  }

  table(token: Tokens.Table): string {
    const header = token.header.map(cell => cell.text).join('\t');
    const rows = token.rows.map(row => row.map(cell => cell.text).join('\t')).join(this.whitespaceDelimiter);
    return `${this.whitespaceDelimiter}${header}${this.whitespaceDelimiter}${rows}${this.whitespaceDelimiter}`;
  }

  tablerow(token: Tokens.TableRow): string {
    return `${this.safeToString(token.text)}${this.whitespaceDelimiter}`;
  }

  tablecell(token: Tokens.TableCell): string {
    return `${this.safeToString(token.text)}\t`;
  }

  strong(token: Tokens.Strong): string {
    return this.safeToString(token.text);
  }

  em(token: Tokens.Em): string {
    return this.safeToString(token.text);
  }

  codespan(token: Tokens.Codespan): string {
    return this.safeToString(token.text);
  }

  br(): string {
    return `${this.whitespaceDelimiter}${this.whitespaceDelimiter}`;
  }

  del(token: Tokens.Del): string {
    return this.safeToString(token.text);
  }

  link(token: Tokens.Link): string {
    return this.safeToString(token.text);
  }

  image(token: Tokens.Image): string {
    return this.safeToString(token.text);
  }

  text(token: Tokens.Text | Tokens.Escape): string {
    return this.safeToString(token.text);
  }

  checkbox(token: Tokens.Checkbox): string {
    return token.checked ? '[x]' : '[ ]';
  }
}

const defaultOptions: MarkedOptions = {};

function convertMarkdownToPlainText(markdownText: string, markedOptions: MarkedOptions = defaultOptions): string {
  try {
    const tokens = marked.lexer(markdownText);
    let plainText = '';

    const tocRegex = /(?:^|\n)(?:#+\s*(?:Table of Contents|Contents|TOC)\s*(?:\n+))(((?:\n*[\s]*\*.*\[.*\]\(.*\).*(?:\n|$))+))/i;
    const tocMatch = markdownText.match(tocRegex);
    let tableOfContents = '';
    
    if (tocMatch && tocMatch[1]) {
      // Extract the table of contents section
      tableOfContents = tocMatch[1];
      
      // Process the TOC links to make them plain text but preserve structure
      tableOfContents = tableOfContents
        .replace(/\*\s*\[(.*?)\]\(.*?\)/g, '• $1')  // Convert markdown links to bullet points
        .replace(/\s{4}\*/g, '    •')               // Preserve indentation for nested items
        .replace(/\s{8}\*/g, '        •');          // Preserve indentation for deeper nested items
    }

    const extractText = (token: any): string => {
      if (typeof token === 'string') return token;
      
      if (token.text) return token.text;
      
      if (token.tokens) {
        return token.tokens.map(extractText).join(' ');
      }
      
      if (token.items) {
        return token.items.map(extractText).join('\n');
      }
      
      if (token.type === 'table') {
        let tableText = '';
        if (token.header) {
          tableText += token.header.map((cell: any) => cell.text).join(' | ') + '\n';
        }
        if (token.rows) {
          tableText += token.rows.map((row: any) => row.map((cell: any) => cell.text).join(' | ')).join('\n');
        }
        return tableText;
      }
      
      return '';
    };
    
    plainText = tokens.map(extractText).join('\n\n');
    plainText = plainText
      .replace(/\n{3,}/g, '\n\n')
      .replace(tocRegex, tableOfContents);

    return convertASCIICharsToText(plainText);
  } catch (error) {
    logger.error(`Error converting markdown to plain text: ${error}`);
    const renderer = new PlainTextRenderer();
    marked.setOptions(markedOptions);
    const plainText = marked(markdownText, { renderer }).toString();
    return convertASCIICharsToText(plainText);
  }
}

function convertASCIICharsToText(str: string): string {
  logger.debug('Converting ASCII characters to text', { inputLength: str.length });
  
  let result = str;
  
  const htmlEntities: Record<string, string> = {
    "&quot;": '"',
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&apos;": "'",
    "&nbsp;": " ",
    "&ndash;": "–",
    "&mdash;": "—",
    "&lsquo;": "'",
    "&rsquo;": "'",
    "&ldquo;": '"',
    "&rdquo;": '"',
    "&bull;": "•",
    "&hellip;": "…",
    "&copy;": "©",
    "&reg;": "®",
    "&trade;": "™",
    "&euro;": "€",
    "&pound;": "£",
    "&yen;": "¥",
    "&cent;": "¢",
    "&sect;": "§",
    "&para;": "¶",
    "&deg;": "°",
    "&plusmn;": "±",
    "&times;": "×",
    "&divide;": "÷",
    "&frac14;": "¼",
    "&frac12;": "½",
    "&frac34;": "¾",
    "&ne;": "≠",
    "&le;": "≤",
    "&ge;": "≥",
    "&micro;": "µ",
    "&middot;": "·"
  };
  
  for (const [entity, char] of Object.entries(htmlEntities)) {
    result = result.replaceAll(entity, char);
  }
  
  result = result.replace(/&#(\d+);/g, (match, code) => 
    String.fromCharCode(Number(code))
  );
  
  result = result.replace(/&#[xX]([A-Fa-f0-9]+);/g, (match, code) => 
    String.fromCharCode(parseInt(code, 16))
  );
  
  return result;
}

export { convertMarkdownToPlainText, convertASCIICharsToText };