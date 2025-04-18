if (require.main === module) {
  try {
    (async () => {
      const { argv } = await import('bun')
      const fs = await import('node:fs')
      const { Logger, LogLevel } = await import('./logger')
      const logger = Logger.getLogger('LinkedinTitleCleaner', {
        minLevel: LogLevel.INFO,
        includeTimestamp: true
      })
      
      logger.info('Starting LinkedIn title cleaner')
      
      const args = argv.slice(2)
      
      if (!args.every((arg) => typeof arg === 'string')) {
        logger.error('Invalid arguments')
        throw new Error('Invalid arguments')
      }
      
      const [argCompany, matchCase] = [args[0], args[1]]
      logger.info(`Processing with company: ${argCompany}${matchCase ? `, match case: ${matchCase}` : ''}`)
      
      try {        
        logger.debug('Reading LinkedIn recruiters file')
        const file = fs.readFileSync('./linkedin-recruiters.csv', 'utf-8')
        const lines = file.split('\n')
        logger.info(`Found ${lines.length} entries to process`)
        
        const information: {
          company: string
          title: string
          link: string
        }[] = []
        
        const cleaner = (s: string) => s.toLowerCase()
          .trim()
          .normalize('NFD')
          .replace(/\p{Diacritic}/gu, '')
          .replace(/[^.\p{L}\p{N}\p{Zs}\p{Emoji}]+/gu, '')
          .replace(/[\s_#]+/g, '')
          .replace(/^-+/, '')
          .replace(/\.{2,}/g, '.')
          .replace(/^\.+/, '')
          .replace(
            /([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/g,
            '',
          )
        {
          logger.debug('Processing entries')
          for(let i = 1; i < lines.length; i++) {
            const line = lines[i].trim()
            if (!line) continue
            
            const parseCsvLine = (line: string): string[] => {
              const result: string[] = [];
              let current = '';
              let inQuotes = false;
              
              for (let i = 0; i < line.length; i++) {
                const char = line[i];
                
                if (char === '"') {
                  inQuotes = !inQuotes;
                } else if (char === ',' && !inQuotes) {
                  result.push(current);
                  current = '';
                } else {
                  current += char;
                }
              }
              
              result.push(current); // Add the last field
              return result;
            };
            
            const parts = parseCsvLine(line);
            
            if (parts.length < 4) {
              logger.warn(`Skipping line with insufficient fields: ${line}`);
              continue;
            }
            
            const [company, , title, link] = parts;
            
            const OPERATIONS: Map<string, (s: string) => string> = new Map([
              ['|', (s) => s.split('|')[0].trim()],
              ['-', (s) => s.split('-')[0].trim()],
              [',', (s) => s.split(',')[0].trim()],
              ['/', (s) => s.split('/')[0].trim()],
              ['@', (s) => s.split('@')[0].trim()],
            ]);

            const filteredTitle = Array.from(OPERATIONS.entries()).reduce((acc, [_, fn]) => fn(acc), title);
            const cleanedTitle = cleaner(filteredTitle);

            information.push({
              company: cleaner(company),
              title: cleanedTitle,
              link: link.trim()
            });
            
            // Debug the first few entries to verify parsing
            if (i < 5) {
              logger.debug(`Parsed: Company="${company}", Title="${title}", Link="${link}"`);
              logger.debug(`Cleaned: Company="${cleaner(company)}", Title="${cleanedTitle}"`);
            }
          }
        }
        
        logger.info(`Processed ${information.length} entries`)

        const output: string[] = []
        logger.debug('Filtering results based on criteria')
        
        Object.entries(information).forEach(([, {company, title, link}]) => {
          
          const companies = argCompany.split('|').map(comp => cleaner(comp.trim()));
          
          if (matchCase) {
            if (companies.includes(company) && title.match(new RegExp(matchCase, 'i'))) {
              output.push(link)
            }
          } else {
            if (companies.includes(company)) {
              output.push(link)
            }
          }
        })
        
        logger.info(`Found ${output.length} matching entries`)
        logger.debug('Writing results to output.txt')
        fs.writeFileSync('./output.txt', output.join('\n'))
        logger.info('Successfully wrote results to output.txt')
      } catch (error) {
        logger.error('Error processing file', { error })
        console.error(error)
      } finally {
        logger.info('[Inner Try]: Done')
        console.log('[Inner Try]: Done')
      }
    })()
  } catch(error) {
    console.error(error)
  } finally {
    console.log('[Outer Try]: Done')
  }
}
// bun linkedin-title-cleaner.ts "google|facebook|meta|airbnb|amazon|microsoft|apple|goldman|intuit|verizon|citadel|visa|fidelity|halliburton" "university|campus|undergrad|intern"