import { camelCase } from 'change-case';
import { slug as githubSlug } from 'github-slugger';
import { pluralize, singularize } from 'inflection';
import { extname, normalize, sep as separator } from 'node:path';

import type { DocumentDefinitionGitOptions } from '../types';

export function makeVariableName(id: string) {
  return leftPadWithUnderscoreIfStartsWithNumber(camelCase(idToFileName(id).replace(/[^A-Z0-9_]/gi, '/0')));
}

export function getDataVariableName(type: string): string {
  return 'all' + pluralize(toPascalCase(type));
}

export function generateTypeName(type: string): string {
  return singularize(toPascalCase(type));
}

export function idToFileName(id: string): string {
  return leftPadWithUnderscoreIfStartsWithNumber(id).replace(/\//g, '__');
}

export function leftPadWithUnderscoreIfStartsWithNumber(str: string): string {
  return /^[0-9]/.test(str) ? '_' + str : str;
}

export function toPascalCase(str: string) {
  return str
    .replace(/[^a-zA-Z0-9]+/g, ' ') // Replace non-alphanumeric characters with spaces
    .split(' ') // Split the string by spaces
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()) // Capitalize the first letter of each word and join them
    .join('');
}

export function getDocumentIdAndSlug(relativePath: string): { id: string; slug: string } {
  const withoutFileExt = relativePath.replace(new RegExp(extname(relativePath) + '$'), '');
  const rawSlugSegments = withoutFileExt.split(separator);

  const slug = rawSlugSegments
    // Slugify each route segment to handle capitalization and spaces.
    // Note: using `slug` instead of `new Slugger()` means no slug deduping.
    .map((segment) => githubSlug(segment))
    // Remove the last segment if it is "index"
    .filter((segment, index) => !(index === rawSlugSegments.length - 1 && segment === 'index'))
    .join('/');

  return { id: normalize(relativePath), slug };
}

/**
 * Returns the DocumentDefinitionGitOptions based on the provided git parameter.
 * If git is false, it returns default values with git functionality disabled.
 * If git is true, it returns the default values.
 * If git is an object, it destructures it with default values.
 * @param git - A boolean or an object of type DocumentDefinitionGitOptions.
 * @returns The DocumentDefinitionGitOptions based on the provided git parameter.
 */
export function getDocumentDefinitionGitOptions(
  git: boolean | DocumentDefinitionGitOptions,
): DocumentDefinitionGitOptions {
  // If git is false, return default values with git functionality disabled
  if (git === false) return { updated: false, authors: false };

  // If git is true, return the default values
  if (git === true) return { updated: true, authors: false };

  // If git is an object, destructure it with default values
  const { updated = true, authors = false } = git;
  return { updated, authors };
}
