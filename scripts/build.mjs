import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(rootDir, 'dist');
const sourceHtml = path.join(rootDir, 'index.html');

const DEFAULT_SITE_URL = 'https://aisese365.github.io';
const DEFAULT_GOOGLE_ANALYTICS_ID = 'G-0B9B32Z26W';

const STATIC_EXTENSIONS = new Set([
  '.gif',
  '.ico',
  '.jpeg',
  '.jpg',
  '.png',
  '.svg',
  '.txt',
  '.webmanifest',
  '.webp',
  '.xml'
]);

function firstDefinedEnv(names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(process.env, name)) {
      return process.env[name].trim();
    }
  }
  return undefined;
}

function normalizeSiteUrl(value) {
  const raw = value || DEFAULT_SITE_URL;
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  const url = new URL(withProtocol);
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/+$/, '');
}

function renderHtml(template) {
  const siteUrl = normalizeSiteUrl(firstDefinedEnv([
    'PUBLIC_SITE_URL',
    'SITE_URL',
    'PUBLIC_SITE_DOMAIN',
    'SITE_DOMAIN'
  ]));
  const googleAnalyticsId = firstDefinedEnv([
    'GOOGLE_ANALYTICS_ID',
    'GA_MEASUREMENT_ID'
  ]) ?? DEFAULT_GOOGLE_ANALYTICS_ID;

  let html = template.replaceAll('__PUBLIC_SITE_URL__', siteUrl);

  if (googleAnalyticsId) {
    html = html.replaceAll('__GOOGLE_ANALYTICS_ID__', googleAnalyticsId);
  } else {
    html = html.replace(/\n?\s*<!-- GOOGLE_ANALYTICS_START -->[\s\S]*?<!-- GOOGLE_ANALYTICS_END -->\s*\n?/m, '\n');
  }

  const unresolved = html.match(/__[A-Z0-9_]+__/g);
  if (unresolved) {
    throw new Error(`Unresolved build placeholders: ${Array.from(new Set(unresolved)).join(', ')}`);
  }

  return {
    html,
    googleAnalyticsId,
    siteUrl
  };
}

async function copyStaticFiles(fromDir, toDir) {
  await mkdir(toDir, { recursive: true });
  const entries = await readdir(fromDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (['dist', 'node_modules', 'scripts'].includes(entry.name)) continue;

    const sourcePath = path.join(fromDir, entry.name);
    const targetPath = path.join(toDir, entry.name);

    if (entry.isDirectory()) {
      await copyStaticFiles(sourcePath, targetPath);
      continue;
    }

    if (entry.name === 'index.html') continue;
    if (!STATIC_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;

    await copyFile(sourcePath, targetPath);
  }
}

const template = await readFile(sourceHtml, 'utf8');
const result = renderHtml(template);

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });
await copyStaticFiles(rootDir, distDir);
await writeFile(path.join(distDir, 'index.html'), result.html);

console.log(`Built dist/ with PUBLIC_SITE_URL=${result.siteUrl}`);
console.log(`Google Analytics: ${result.googleAnalyticsId || 'disabled'}`);
