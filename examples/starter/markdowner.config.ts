import type { MarkdownerConfig } from 'markdowner/core';
import rehypeSlug from 'rehype-slug';
import { rehypeAutolinkHeadings, rehypePrettyCode } from './src/markdowner';

const markdownConfig: MarkdownerConfig = {
  contentDirPath: './src/content',
  definitions: [
    { type: 'LegalDoc', patterns: 'legal/*.{md,mdoc,mdx}' },

    // blog
    { type: 'BlogPost', patterns: 'blog/posts/*.{md,mdoc,mdx}' },
    { type: 'Changelog', patterns: 'blog/changelog/*.{md,mdoc,mdx}' },
  ],
  remarkPlugins: [],
  rehypePlugins: [rehypeSlug, rehypeAutolinkHeadings, rehypePrettyCode],
};

export default markdownConfig;
