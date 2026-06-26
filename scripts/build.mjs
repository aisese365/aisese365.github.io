import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(rootDir, 'dist');
const sourceHtml = path.join(rootDir, 'index.html');
const appVersionConfigFile = path.join(rootDir, 'app-version.json');

const DEFAULT_SITE_URL = 'https://aisese365.github.io';
const DEFAULT_GOOGLE_ANALYTICS_ID = 'G-0B9B32Z26W';
const APP_DOWNLOADS = {
  android: {
    defaultExtension: 'apk',
    primaryTemplate: 'https://pub-9f9a433bef504b16b1b30cd09cc00b91.r2.dev/aisese-{platform}-{version}.{extension}',
    backupTemplate: 'https://github.com/aisese365/aisese365.github.io/releases/download/{version}/aisese-{platform}-{version}.{extension}'
  },
  ios: {
    primaryUrl: 'https://aisese365-ios-install.pages.dev/',
    backupUrl: 'https://aisese365.github.io/ios-install/'
  }
};

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
const STATIC_FILENAMES = new Set([
  'app-version.json'
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

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function interpolateUrlTemplate(template, values) {
  const url = template.replace(/\{([a-z]+)\}/g, (_, key) => {
    if (!Object.prototype.hasOwnProperty.call(values, key)) {
      throw new Error(`Unknown app download template key: ${key}`);
    }
    return encodeURIComponent(values[key]);
  });

  return new URL(url).toString();
}

function resolveDownloadUrl(download, type, values) {
  const fixedUrl = download[`${type}Url`];
  if (fixedUrl) return new URL(fixedUrl).toString();

  const template = download[`${type}Template`];
  if (!template) {
    throw new Error(`Missing ${type} app download URL`);
  }

  return interpolateUrlTemplate(template, values);
}

function normalizeAppVersionConfig(rawConfig) {
  const config = {};

  for (const [platform, download] of Object.entries(APP_DOWNLOADS)) {
    const platformConfig = rawConfig?.[platform];
    if (!platformConfig || typeof platformConfig !== 'object') {
      throw new Error(`Missing app version config for ${platform}`);
    }

    const version = String(platformConfig.version ?? '').trim();
    if (!version) {
      throw new Error(`Missing app version for ${platform}`);
    }

    const extension = String(platformConfig.extension ?? download.defaultExtension ?? '').trim().replace(/^\./, '');
    if ((download.primaryTemplate || download.backupTemplate) && !extension) {
      throw new Error(`Missing app file extension for ${platform}`);
    }

    config[platform] = { version, extension };
  }

  return config;
}

function applyAppVersionConfig(html, appVersionConfig) {
  let result = html;

  for (const [platform, config] of Object.entries(appVersionConfig)) {
    const templateValues = { platform, version: config.version, extension: config.extension };
    const placeholderPrefix = `__APP_${platform.toUpperCase()}_`;

    result = result.replaceAll(`${placeholderPrefix}VERSION__`, escapeHtml(config.version));
    result = result.replaceAll(
      `${placeholderPrefix}PRIMARY_URL__`,
      resolveDownloadUrl(APP_DOWNLOADS[platform], 'primary', templateValues)
    );
    result = result.replaceAll(
      `${placeholderPrefix}BACKUP_URL__`,
      resolveDownloadUrl(APP_DOWNLOADS[platform], 'backup', templateValues)
    );
  }

  return result;
}

function renderHtml(template, appVersionConfig) {
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
  html = applyAppVersionConfig(html, appVersionConfig);

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
    if (!STATIC_FILENAMES.has(entry.name) && !STATIC_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;

    await copyFile(sourcePath, targetPath);
  }
}

const template = await readFile(sourceHtml, 'utf8');
const appVersionConfig = normalizeAppVersionConfig(JSON.parse(await readFile(appVersionConfigFile, 'utf8')));
const result = renderHtml(template, appVersionConfig);

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });
await copyStaticFiles(rootDir, distDir);
await writeFile(path.join(distDir, 'index.html'), result.html);

console.log(`Built dist/ with PUBLIC_SITE_URL=${result.siteUrl}`);
console.log(`Google Analytics: ${result.googleAnalyticsId || 'disabled'}`);
