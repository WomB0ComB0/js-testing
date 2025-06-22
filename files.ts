import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Filter strings based on a regex pattern
 */
const stringFilter = (
  strings: string | string[],
  regex: RegExp
): string | string[] => {
  if (Array.isArray(strings)) {
    return strings.filter((string) => string.match(regex));
  }
  return strings.match(regex) ? strings : '';
};

/**
 * Convert a string to kebab-case
 */
const toKebab = (input: string): string => {
  const parts = input.split('.');
  if (parts.length > 1) {
    const extension = parts.pop();
    const fileName = parts.join('.');
    const kebabName = fileName
      .replace(/([A-Z])/g, '-$1')
      .replace(/\s+/g, '-')
      .replace(/^-/, '')
      .toLowerCase();
    return `${kebabName}.${extension}`;
  } else {
    return input
      .replace(/([A-Z])/g, '-$1')
      .replace(/\s+/g, '-')
      .replace(/^-/, '')
      .toLowerCase();
  }
};

/**
 * Convert a string to camelCase
 */
const toCamel = (input: string): string => {
  const parts = input.split('.');
  if (parts.length > 1) {
    const extension = parts.pop();
    const fileName = parts.join('.');
    const camelName = fileName
      .replace(/[^a-zA-Z0-9]+(.)?/g, (match, chr) => (chr ? chr.toUpperCase() : ''))
      .replace(/^./, (match) => match.toLowerCase());
    return `${camelName}.${extension}`;
  } else {
    return input
      .replace(/[^a-zA-Z0-9]+(.)?/g, (match, chr) => (chr ? chr.toUpperCase() : ''))
      .replace(/^./, (match) => match.toLowerCase());
  }
};

/**
 * Convert a string to PascalCase
 */
const toPascal = (input: string): string => {
  const parts = input.split('.');
  if (parts.length > 1) {
    const extension = parts.pop();
    const fileName = parts.join('.');
    const pascalName = fileName
      .replace(/[^a-zA-Z0-9]+(.)?/g, (match, chr) => (chr ? chr.toUpperCase() : ''))
      .replace(/^./, (match) => match.toUpperCase());
    return `${pascalName}.${extension}`;
  } else {
    return input
      .replace(/[^a-zA-Z0-9]+(.)?/g, (match, chr) => (chr ? chr.toUpperCase() : ''))
      .replace(/^./, (match) => match.toUpperCase());
  }
};

/**
 * Convert a string to snake_case
 */
const toSnake = (input: string): string => {
  const parts = input.split('.');
  if (parts.length > 1) {
    const extension = parts.pop();
    const fileName = parts.join('.');
    const snakeName = fileName
      .replace(/([A-Z])/g, '_$1')
      .replace(/\s+/g, '_')
      .replace(/^-/, '')
      .toLowerCase();
    return `${snakeName}.${extension}`;
  } else {
    return input
      .replace(/([A-Z])/g, '_$1')
      .replace(/\s+/g, '_')
      .replace(/^-/, '')
      .toLowerCase();
  }
};

/**
 * Type definition for case conversion functions.
 */
type CaseConverter = (input: string) => string;

/**
 * Map of supported case names to their respective converter functions.
 */
const caseConverters: { [key: string]: CaseConverter } = {
  kebab: toKebab,
  camel: toCamel,
  pascal: toPascal,
  snake: toSnake,
};

/**
 * Process all files in a directory to convert them to the specified case
 */
const convertCase = (
  directoryPath: string,
  targetCase: string,
  fileExtensions: string[] = []
): void => {
  const converter = caseConverters[targetCase];
  if (!converter) {
    console.error(`Error: Unsupported case type "${targetCase}". Supported cases are: ${Object.keys(caseConverters).join(', ')}`);
    return;
  }

  const items = fs.readdirSync(directoryPath);

  for (const item of items) {
    const itemPath = path.join(directoryPath, item);
    const stats = fs.statSync(itemPath);

    if (stats.isDirectory()) {
      // Rename directory to target case
      const newName = converter(item);
      if (newName !== item) {
        const newPath = path.join(directoryPath, newName);
        fs.renameSync(itemPath, newPath);
        // Continue processing in the renamed directory
        convertCase(newPath, targetCase, fileExtensions);
      } else {
        // Continue processing in the directory
        convertCase(itemPath, targetCase, fileExtensions);
      }
    } else if (stats.isFile()) {
      // Check if the file has one of the specified extensions
      const extension = path.extname(item).toLowerCase().substring(1);
      if (fileExtensions.length === 0 || fileExtensions.includes(extension)) {
        // Rename file to target case
        const newName = converter(item);
        if (newName !== item) {
          const newPath = path.join(directoryPath, newName);
          fs.renameSync(itemPath, newPath);
        }
      }
    }
  }
};

(() => {
  try {
    const [inputDir, targetCase, ...extensions] = process.argv.slice(2);

    if (!inputDir || !targetCase) {
      console.log('Usage: node your-script.js <directoryPath> <targetCase> [fileExtensions...]');
      console.log('Supported cases: kebab, camel, pascal, snake');
      process.exit(1);
    }

    console.log(`Converting files in ${inputDir} to ${targetCase}-case`);
    if (extensions.length > 0) {
      console.log(`Only processing files with extensions: ${extensions.join(', ')}`);
    } else {
      console.log('Processing all files');
    }

    convertCase(inputDir, targetCase, extensions);

    console.log('Conversion complete!');
  } catch (error) {
    console.error('Error during conversion:', error);
  } finally {
    console.log('Process finished');
  }
})();