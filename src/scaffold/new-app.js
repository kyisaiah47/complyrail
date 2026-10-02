// complyrail new-app: scaffold a Next.js app wired to the engine.
//
//   --app console   one dense working view: the stages, the form and the order record side by side
//   --app simple    one roomy view: the outcome, one primary action, details behind disclosures
//   --app both      both views, a first-visit welcome that explains the product and offers the
//                   choice, and footer controls to switch at any time
//
// Files under files/common go into every app. files/<mode> holds the components only that mode
// needs. The layout, the two pages and package.json are written here, because they differ by mode.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILES = path.join(HERE, 'files');
export const MODES = ['console', 'simple', 'both'];

/* npm drops files named .gitignore and .env* from a published package, so they ship under plain
 * names and are renamed on the way out. */
const RENAME = { gitignore: '.gitignore', 'env.example': '.env.example' };

function walk(dir, base = dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out);
    else out.push(path.relative(base, p));
  }
  return out;
}

export function slugify(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'complyrail-app';
}

function packageJson({ slug, version }) {
  return `${JSON.stringify(
    {
      name: slug,
      version: '0.1.0',
      private: true,
      type: 'module',
      scripts: {
        dev: 'next dev',
        build: 'next build',
        start: 'next start',
        worker: 'node scripts/worker.mjs',
      },
      dependencies: {
        complyrail: `^${version}`,
        next: '^16.3.0',
        react: '^19.2.0',
        'react-dom': '^19.2.0',
      },
      devDependencies: {
        '@types/node': '^22',
        '@types/react': '^19',
        '@types/react-dom': '^19',
        typescript: '^5',
      },
    },
    null,
    2,
  )}\n`;
}

function layout(mode) {
  const both = mode === 'both';
  return `import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { packInfo } from '@/lib/pack-info';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
${both ? "import SiteViewProvider from '@/components/site-view/SiteViewProvider';\nimport PageViews from '@/components/site-view/PageViews';\nimport ViewControls from '@/components/site-view/ViewControls';\nimport '@/components/site-view/site-view.css';\n" : ''}${mode !== 'simple' ? "import '@/components/console/console.css';\n" : ''}${mode !== 'console' ? "import '@/components/simple/simple.css';\n" : ''}import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const info = await packInfo();
  return { title: info.name, description: info.tagline };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const info = await packInfo();
  return (
    <html lang="en">
      <body>
${
  both
    ? `        <SiteViewProvider info={info}>
          <PageViews consoleView={<Header info={info} variant="console" />} simpleView={<Header info={info} variant="simple" />} />
          {children}
          <Footer info={info}>
            <ViewControls />
          </Footer>
        </SiteViewProvider>`
    : `        <Header info={info} variant="${mode}" />
        {children}
        <Footer info={info} />`
}
      </body>
    </html>
  );
}
`;
}

function homePage(mode) {
  const imports = [
    "import { packInfo } from '@/lib/pack-info';",
    mode !== 'simple' ? "import ConsoleHome from '@/components/console/ConsoleHome';" : null,
    mode !== 'console' ? "import SimpleHome from '@/components/simple/SimpleHome';" : null,
    mode === 'both' ? "import PageViews from '@/components/site-view/PageViews';" : null,
  ].filter(Boolean);
  const body =
    mode === 'both'
      ? '<PageViews consoleView={<ConsoleHome info={info} />} simpleView={<SimpleHome info={info} />} />'
      : mode === 'console'
        ? '<ConsoleHome info={info} />'
        : '<SimpleHome info={info} />';
  return `${imports.join('\n')}

export default async function Home() {
  const info = await packInfo();
  return ${body};
}
`;
}

function orderPage(mode) {
  const imports = [
    "import { notFound } from 'next/navigation';",
    "import { getEngine } from '@/lib/engine';",
    "import { packInfo } from '@/lib/pack-info';",
    mode !== 'simple' ? "import ConsoleOrder from '@/components/console/ConsoleOrder';" : null,
    mode !== 'console' ? "import SimpleOrder from '@/components/simple/SimpleOrder';" : null,
    mode === 'both' ? "import PageViews from '@/components/site-view/PageViews';" : null,
  ].filter(Boolean);
  const body =
    mode === 'both'
      ? '<PageViews consoleView={<ConsoleOrder info={info} initial={order} />} simpleView={<SimpleOrder info={info} initial={order} />} />'
      : mode === 'console'
        ? '<ConsoleOrder info={info} initial={order} />'
        : '<SimpleOrder info={info} initial={order} />';
  return `${imports.join('\n')}

export const dynamic = 'force-dynamic';

/* One order. The token in the URL is the only key to it, so the page never lists other orders. */
export default async function OrderPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[a-f0-9]{48}$/.test(token)) notFound();
  const engine = await getEngine();
  const order = await engine.view(token);
  if (!order) notFound();
  const info = await packInfo();
  return ${body};
}
`;
}

function stateModule(mode) {
  if (mode === 'both') {
    return `'use client';
/* State that survives a switch between the Console and Simple views. It lives in the view
 * provider's memory and never reaches browser storage. */
export { useViewState } from '@/components/site-view/SiteViewProvider';
`;
  }
  return `'use client';
import { useState, type Dispatch, type SetStateAction } from 'react';

/* With one view there is nothing to switch, so view state is ordinary component state. */
export function useViewState<T>(_key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  return useState<T>(initial);
}
`;
}

/**
 * newApp({ dir, mode, name, version, force }) -> { dir, files }
 * Throws when the directory is not empty and force is not set.
 */
export function newApp({ dir, mode = 'both', name, version, force = false }) {
  if (!MODES.includes(mode)) throw new Error(`--app must be one of ${MODES.join(', ')}`);
  const target = path.resolve(dir);
  if (fs.existsSync(target) && fs.readdirSync(target).length && !force) {
    throw new Error(`${target} is not empty. Choose an empty directory or pass --force.`);
  }
  const appName = name || path.basename(target);
  const slug = slugify(appName);
  const replace = (text) => text.replaceAll('__APP_NAME__', appName).replaceAll('__APP_SLUG__', slug).replaceAll('__COMPLYRAIL_VERSION__', version);

  const written = [];
  const write = (rel, content) => {
    const out = path.join(target, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, content);
    written.push(rel);
  };

  const sources = ['common', ...(mode === 'both' ? ['console', 'simple', 'both'] : [mode])];
  for (const src of sources) {
    for (const rel of walk(path.join(FILES, src))) {
      const base = path.basename(rel);
      const outRel = RENAME[base] ? path.join(path.dirname(rel), RENAME[base]) : rel;
      write(outRel, replace(fs.readFileSync(path.join(FILES, src, rel), 'utf8')));
    }
  }
  write('package.json', packageJson({ slug, version }));
  write('src/app/layout.tsx', layout(mode));
  write('src/app/page.tsx', homePage(mode));
  write('src/app/order/[token]/page.tsx', orderPage(mode));
  write('src/components/state.ts', stateModule(mode));
  write('complyrail.app.json', `${JSON.stringify({ app: mode, name: appName, complyrail: version }, null, 2)}\n`);
  return { dir: target, files: written.sort() };
}
