import { extname } from 'node:path';
import { custom } from 'zod';
import { bundle, type BundleProps } from '../bundle';
import type { DocumentBody, DocumentDefinition, DocumentFormat, DocumentFormatInput, ResolvedConfig } from '../types';

type Options = Pick<DocumentDefinition, 'format'> & {
  path: string;
  contents: string;
  frontmatter: Record<string, unknown>;
  config: ResolvedConfig;
};

/**
 * Schema for a document's body.
 * @returns A Zod object representing a document body.
 */
export function body({
  // output,
  path,
  format: formatInput = 'detect',
  contents,
  frontmatter,
  config,
}: Options) {
  return custom().transform<DocumentBody>(async (value, { addIssue }) => {
    // determine the document format
    const { mdAsMarkdoc = false } = config;
    let format = getFormat({ file: path, format: formatInput });
    if (format === 'md' && mdAsMarkdoc) format = 'mdoc';

    // bundle the document
    const options: BundleProps = {
      contents,
      entryPath: path,
      format,
      plugins: { ...config },
      frontmatter,
    };
    const { code, errors } = await bundle(options);
    if (errors && errors.length) {
      addIssue({ fatal: true, code: 'custom', message: errors[0].text });
      return null as never;
    }

    return { format, raw: contents, code };
  });
}

// Copied from https://mdxjs.com/packages/mdx/#optionsmdextensions
// Although we are likely to only use .md / .mdx anyway...
const mdExtensions = [
  '.md',

  // others
  '.markdown',
  '.mdown',
  '.mkdn',
  '.mkd',
  '.mdwn',
  '.mkdown',
  '.ron',
];

export function getFormat({ file, format }: { file: string; format: DocumentFormatInput }): DocumentFormat {
  if (format === 'detect') {
    const ext = extname(file);
    if (mdExtensions.includes(ext)) return 'md';
    else if (ext === '.mdx') return 'mdx';
    else if (ext === '.mdoc') return 'mdoc';
    else throw new Error(`Unable to detect format for file: ${file}`);
  }

  return format;
}
