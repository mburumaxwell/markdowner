import chokidar from 'chokidar';
import { globby } from 'globby';
import matter from 'gray-matter';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { assets } from './assets';
import { getConfig } from './config';
import { MarkdownlayerError, MarkdownlayerErrorData, getYamlErrorLine } from './errors';
import { logger } from './logger';
import { assertStatement, autogeneratedNote, outputAssets, outputEntryFiles } from './output';
import { resolveSchema, type ResolveSchemaOptions } from './schemas/resolve';
import type { DocumentDefinition, GenerationMode, ResolvedConfig } from './types';
import { getDataVariableName, idToFileName, makeVariableName } from './utils';

type GeneratedCount = { cached: number; generated: number; total: number };

export type GenerateOptions = {
  /**
   * Build mode.
   * Enables production optimizations or development hints.
   */
  mode: GenerationMode;

  /**
   * The path to the configuration file.
   */
  configPath?: string;
};

export async function generate({ mode, configPath: providedConfigPath }: GenerateOptions) {
  // get the config
  const { configImports, contentDirPath, output, ...config } = await getConfig(mode, providedConfigPath);

  // create output directories if not exists
  await mkdir(output.assets, { recursive: true });
  await mkdir(output.generated, { recursive: true });

  // write files that would be imported by the application (index.d.ts, index.mjs)
  // we do not need to regenerate these files when content changes
  await outputEntryFiles({ output, ...config });

  // generate the content (initial)
  await generateInner({ configImports, contentDirPath, output, ...config });

  // watch for changes in the config or content folder (development mode only)
  if (mode === 'development') {
    logger.info(`Watching for changes in '${contentDirPath}'`);

    const files = [contentDirPath];
    files.push(...configImports); // watch config file and its dependencies

    const watcher = chokidar.watch(files, {
      cwd: contentDirPath,
      ignored: /(^|[/\\])[._]./, // ignore dot & underscore files
      ignoreInitial: true, // ignore initial scan
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 }, // wait for file to be written
    });
    watcher.on('all', async (eventName, filename) => {
      if (eventName === 'addDir' || eventName === 'unlinkDir') return; // ignore dir changes
      if (filename == null) return;

      filename = join(contentDirPath, filename);

      try {
        // remove changed file cache
        for (const [key, value] of Object.entries(config.cache.uniques)) {
          if (value === filename) delete config.cache.uniques[key];
        }

        // changes in the config file should restart the whole process
        if (configImports.includes(filename)) {
          logger.debug('markdownlayer config changed, restarting...');
          watcher?.close();
          return generate({ mode, configPath: providedConfigPath });
        }

        // regenerate the content
        logger.info(`${filename} changed`);
        await generateInner({ configImports, contentDirPath, output, ...config });
      } catch (error) {
        logger.warn(error);
      }
    });
  }
}

async function generateInner(config: ResolvedConfig) {
  // iterate over the definitions and generate the docs
  const generations: Record<string, GeneratedCount> = {};
  for (const [type, def] of Object.entries(config.definitions)) {
    const generation = await generateDocuments({ ...def, type, config });
    generations[type] = generation;
  }

  // output all assets
  await outputAssets({ assets, ...config });

  // save the cache
  await config.cache.save();

  // print some stats
  const { cached, total }: GeneratedCount = Object.values(generations).reduce((acc, count) => {
    acc.cached += count.cached;
    acc.generated += count.generated;
    acc.total += count.total;
    return acc;
  });
  logger.info(`Generated ${total} documents (${cached} from cache) in .markdownlayer`);
}

type GenerateDocsOptions = DocumentDefinition & { type: string; config: ResolvedConfig };
async function generateDocuments(options: GenerateDocsOptions): Promise<GeneratedCount> {
  const { type, config } = options;
  const { configPath, contentDirPath, patterns = '**/*.{md,mdoc,mdx}', cache, output } = config;

  // ensure that all definitions have at least one pattern
  if (patterns.length === 0) {
    throw new MarkdownlayerError(MarkdownlayerErrorData.ConfigNoPatternsError);
  }

  // find the files
  const definitionDir = join(contentDirPath, type);
  const files = await globby(patterns, {
    cwd: definitionDir,
    gitignore: true, // use .gitignore
    ignore: ['**/_*'], // ignore files starting with underscore
    dot: false, // ignore dot files
    onlyFiles: true, // only files, skip directories
    absolute: true,
  });

  let cached = 0;
  let generated = 0;
  const docs: Record<string, unknown> = {}; // key is document identifier

  await mkdir(join(output.generated, type), { recursive: true });

  // parse the files and "compile" in a loop
  for (const file of files) {
    // if the file has not been modified, use the cached version
    const hash = (await stat(file)).mtimeMs.toString();
    const cacheEntry = cache.items[file];
    const changed = !cacheEntry || cacheEntry.hash !== hash;
    if (!changed) {
      docs[file] = cacheEntry.document;
      cached++;
      continue;
    }

    const contents = await readFile(file, 'utf8');
    const parsedMatter = matter(contents);
    const frontmatter = parsedMatter.data as Record<string, unknown>;

    let data: Record<string, unknown> = frontmatter;
    const resolveSchemaOptions: ResolveSchemaOptions = {
      type,
      schema: options.schema,

      path: file,
      contents,

      frontmatter,
      config,
    };
    const schema = resolveSchema(resolveSchemaOptions);
    if (schema) {
      const parsed = await schema.safeParseAsync(frontmatter); // Use `safeParseAsync` to allow async transforms
      if (parsed.success) {
        data = parsed.data as Record<string, unknown>;
      } else {
        throw new MarkdownlayerError({
          ...MarkdownlayerErrorData.InvalidDocumentFrontmatterError,
          message: MarkdownlayerErrorData.InvalidDocumentFrontmatterError.message({
            definition: type,
            path: relative(configPath, file),
            error: parsed.error,
          }),
          location: {
            file,
            line: getYamlErrorLine(parsedMatter.matter, String(parsed.error.errors[0].path[0])),
            column: 0,
          },
        });
      }
    }

    // write json file
    const outputFilePath = join(output.generated, type, `${idToFileName(relative(definitionDir, file))}.json`);
    await writeFile(outputFilePath, JSON.stringify(data, null, 2), { encoding: 'utf8' });

    // update the cache
    docs[file] = data;
    cache.items[file] = { hash, type, document: data };
    generated++;
  }

  // write the collection file
  let outputFilePath = join(output.generated, type, 'index.json');
  await writeFile(outputFilePath, JSON.stringify(Object.values(docs), null, 2), { encoding: 'utf8' });

  // write import file
  outputFilePath = join(output.generated, type, 'index.mjs');
  const lines: string[] = [
    autogeneratedNote,
    '',
    ...Object.keys(docs).map(
      (id) => `import ${makeVariableName(id)} from './${idToFileName(relative(definitionDir, id))}.json'${assertStatement};`,
    ),
    '',
    `export const ${getDataVariableName(type)} = [`,
    `  ${Object.keys(docs)
      .map((id) => `${makeVariableName(id)}`)
      .join(',\n  ')},`,
    '];',
    '',
  ];
  await writeFile(outputFilePath, lines.join('\n'), { encoding: 'utf8' });

  return { cached, generated, total: Object.keys(docs).length };
}
