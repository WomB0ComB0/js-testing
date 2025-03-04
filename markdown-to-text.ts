import { marked } from 'marked';
import { $ } from 'bun';
import { Logger, LogLevel } from './logger';

// Create a logger instance for this module
const logger = Logger.getLogger('MarkdownToText', {
  minLevel: LogLevel.INFO,
  includeTimestamp: true
});

interface PlainTextRendererOptions {
  spaces?: boolean;
}

interface MarkedOptions {
  sanitize?: boolean;
  mangle?: boolean;
  headerIds?: boolean;
  renderer?: any;
}

class PlainTextRenderer {
  private options: PlainTextRendererOptions;
  private whitespaceDelimiter: string;

  constructor(options?: PlainTextRendererOptions) {
    this.options = options || {};
    this.whitespaceDelimiter = this.options.spaces ? ' ' : '\n';
    logger.debug('PlainTextRenderer initialized', { options: this.options });
  }

  code(code: string, lang?: string, escaped?: boolean): string {
    return this.whitespaceDelimiter + this.whitespaceDelimiter + code + this.whitespaceDelimiter + this.whitespaceDelimiter;
  }

  blockquote(quote: string): string {
    return '\t' + quote + this.whitespaceDelimiter;
  }

  html(html: string): string {
    return html;
  }

  heading(text: string, level: number, raw: string): string {
    return text;
  }

  hr(): string {
    return this.whitespaceDelimiter + this.whitespaceDelimiter;
  }

  list(body: string, ordered: boolean): string {
    return body;
  }

  listitem(text: string): string {
    return '\t' + text + this.whitespaceDelimiter;
  }

  paragraph(text: string): string {
    return this.whitespaceDelimiter + text + this.whitespaceDelimiter;
  }

  table(header: string, body: string): string {
    return this.whitespaceDelimiter + header + this.whitespaceDelimiter + body + this.whitespaceDelimiter;
  }

  tablerow(content: string): string {
    return content + this.whitespaceDelimiter;
  }

  tablecell(content: string, flags: { header: boolean; align: string }): string {
    return content + '\t';
  }

  strong(text: string): string {
    return text;
  }

  em(text: string): string {
    return text;
  }

  codespan(text: string): string {
    return text;
  }

  br(): string {
    return this.whitespaceDelimiter + this.whitespaceDelimiter;
  }

  del(text: string): string {
    return text;
  }

  link(href: string, title: string | null, text: string): string {
    return text;
  }

  image(href: string, title: string | null, text: string): string {
    return text;
  }

  text(text: string): string {
    return text;
  }

  checkbox(checked: boolean): string {
    return checked ? '[x]' : '[ ]';
  }
}

const defaultOptions: MarkedOptions = {
  sanitize: false,
  mangle: false,
  headerIds: false
};

function convertMarkdownToPlainText(markdownText: string, markedOptions: MarkedOptions = defaultOptions): Promise<string> {
  return logger.time('Convert markdown to plain text', async () => {
    try {
      const renderer = new PlainTextRenderer();
      marked.setOptions(markedOptions);
      // @ts-ignore - The type definitions for marked don't match our custom renderer
      const plainText = marked(markdownText, { renderer });
      logger.debug('Markdown converted successfully', { 
        inputLength: markdownText.length,
        outputLength: plainText.length 
      });
      return convertASCIICharsToText(plainText);
    } catch (error) {
      logger.error('Failed to convert markdown to plain text', error);
      throw error;
    }
  });
}

function __convertASCIINamesToText(str: string): string {
  // Convert common HTML entities to their character equivalents
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
    "&hellip;": "…"
  };
  
  let result = str;
  for (const [entity, char] of Object.entries(htmlEntities)) {
    result = result.replaceAll(entity, char);
  }
  return result;
}

function __convertASCIINumbersToText(str: string): string {
  // Convert HTML Numbers (eg. "&#36;" => $)
  return str.replace(/&#(\d+);/g, (match, code) => 
    String.fromCharCode(Number(code))
  );
}

function convertASCIICharsToText(str: string): string {
  logger.debug('Converting ASCII characters to text', { inputLength: str.length });
  return __convertASCIINumbersToText(__convertASCIINamesToText(str));
}

export { convertMarkdownToPlainText, convertASCIICharsToText };