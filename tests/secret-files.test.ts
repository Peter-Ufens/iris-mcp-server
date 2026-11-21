// S0 (Bob 14/11) : fs-read-v1 ne lit jamais un fichier de secrets, meme sous ALLOWED_ROOTS.
// Donnees inventees uniquement (aucune vraie cle, aucun vrai chemin).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { tool } from '../src/tools/fs-read-v1.js';
import { isSecretFileName, assertNotSecretFile, secretDirectoryIn, PathGuardError } from '../src/utils/path-guard.js';
import { mkdir } from 'node:fs/promises';

const FAUX = 'CLE_INVENTEE=valeur-de-test-sans-importance';

let testDir: string;
let lienCree = false;

async function lire(nom: string): Promise<{ content?: string; error?: string }> {
  const result = await tool.execute({ path: join(testDir, nom) });
  return JSON.parse(result.content[0]!.text);
}

beforeAll(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'iris-secrets-'));
  for (const nom of ['.env', '.env.local', '.env.outil', 'prod.env', 'id_rsa', 'secrets.h', 'credentials.json', 'cle.pem', 'mcp.json']) {
    await writeFile(join(testDir, nom), FAUX, 'utf-8');
  }
  await writeFile(join(testDir, '.env.example'), 'CLE_INVENTEE=', 'utf-8');
  await writeFile(join(testDir, 'notes.txt'), 'Bonjour Iris', 'utf-8');
  await writeFile(join(testDir, 'SECRETS-POLITIQUE.md'), 'Doc sans secret', 'utf-8');
  for (const nom of ['.env~', 'id_rsa_old', 'token.txt', 'service-account.json']) {
    await writeFile(join(testDir, nom), FAUX, 'utf-8');
  }
  await mkdir(join(testDir, '.git'));
  await writeFile(join(testDir, '.git', 'config'), `[remote "origin"]\n${FAUX}`, 'utf-8');
  await mkdir(join(testDir, 'secrets'));
  await writeFile(join(testDir, 'secrets', 'notes.txt'), FAUX, 'utf-8');
  try {
    // Un lien au nom innocent vers un vrai .env : doit etre refuse (nom resolu).
    await symlink(join(testDir, '.env'), join(testDir, 'innocent.txt'), 'file');
    lienCree = true;
  } catch {
    lienCree = false; // Windows sans droit de creer des liens : test du lien ignore
  }
  process.env.ALLOWED_ROOTS = testDir;
});

afterAll(async () => {
  await rm(testDir, { recursive: true, force: true });
  delete process.env.ALLOWED_ROOTS;
});

describe('isSecretFileName (pur)', () => {
  it.each([
    '.env', '.ENV', '.env.local', '.env.outil', '.env.bak', 'prod.env', 'Docker.ENV',
    'cle.pem', 'serveur.key', 'cert.p12', 'cert.pfx', 'putty.ppk', 'coffre.kdbx', 'app.keystore', 'app.jks',
    'id_rsa', 'id_ed25519', '.git-credentials', '.netrc', '.npmrc', '.pypirc',
    'secrets.json', 'secret.yaml', 'secrets.h', 'credentials', 'credentials.json',
    'mcp.json', 'claude_desktop_config.json',
    'C:\\Projets\\RAG\\stack\\.env', '/home/exemple/.env.prod',
    // S0-bis (review Gaby + Bob 14/11) : noms qui passaient
    '.env~', '.env_backup', '.env-prod', 'prod.env.bak', 'docker.env.old', 'prod.env~',
    'id_ed25519_github', 'id_rsa_old', 'id_rsa.bak', '.pgpass', '.htpasswd', '.envrc', '.dockercfg',
    'gcp-credentials.json', 'aws_credentials.ini', 'service-account.json', 'service_account_prod.json',
    'client_secret_123.json', 'terraform.tfvars', 'terraform.tfstate', 'terraform.tfstate.backup',
    'prod.tfvars.json', 'token.txt', 'api-key.txt', 'access_token.json', 'api_keys.yaml',
  ])('refuse %s', (nom) => {
    expect(isSecretFileName(nom)).toBe(true);
  });

  it.each([
    '.env.example', '.env.sample', '.env.template', '.env.dist', 'notes.txt', 'README.md',
    'environnement.md', 'SECRETS-POLITIQUE.md', 'secret-sauce-recette.md', 'keynote.txt',
    'package.json', 'tsconfig.json', 'id_rsa.pub', 'C:\\Projets\\docs\\guide.md',
    // S0-bis : faux positifs a eviter
    'id_ed25519_github.pub', 'vite-env.d.ts', 'tokenizer.ts', 'tokens.json', 'credentials-guide.md',
    'environment.ts', 'monkey.txt',
  ])('laisse passer %s', (nom) => {
    expect(isSecretFileName(nom)).toBe(false);
  });

  it('assertNotSecretFile teste chaque chemin (demande et resolu)', () => {
    expect(() => assertNotSecretFile('C:\\x\\notes.txt', 'C:\\x\\.env')).toThrow(PathGuardError);
    expect(() => assertNotSecretFile('C:\\x\\notes.txt', 'C:\\x\\notes.txt')).not.toThrow();
  });
});

describe('secretDirectoryIn (pur, S0-bis)', () => {
  it.each([
    ['C:\\Projets\\app\\.git\\config', '.git'],
    ['/home/exemple/.ssh/known_hosts', '.ssh'],
    ['C:\\Projets\\outil\\secrets\\notes.md', 'secrets'],
    ['C:\\Projets\\outil\\SECRETS\\a.json', 'SECRETS'],
    ['/srv/.aws/config', '.aws'],
  ])('%s passe par le dossier %s', (chemin, dossier) => {
    expect(secretDirectoryIn(chemin)).toBe(dossier);
  });

  it.each(['C:\\Projets\\docs\\secret-sauce\\guide.md', 'C:\\Projets\\app\\gitignore\\a.txt', 'C:\\Projets\\.github\\x.yml'])(
    '%s : aucun dossier de secrets',
    (chemin) => {
      expect(secretDirectoryIn(chemin)).toBeNull();
    },
  );

  it('un fichier nomme comme un dossier de secrets n est pas un dossier (dernier segment ignore)', () => {
    expect(secretDirectoryIn('C:\\Projets\\docs\\secrets')).toBeNull();
  });
});

describe('fs-read-v1 refuse les fichiers de secrets', () => {
  it.each(['.env', '.env.local', '.env.outil', 'prod.env', 'id_rsa', 'secrets.h', 'credentials.json', 'cle.pem', 'mcp.json'])(
    'refuse %s sans rien renvoyer du contenu',
    async (nom) => {
      const payload = await lire(nom);
      expect(payload.error).toContain('fichier de secrets');
      expect(payload.content).toBeUndefined();
      expect(JSON.stringify(payload)).not.toContain('valeur-de-test');
    },
  );

  it.each(['.env~', 'id_rsa_old', 'token.txt', 'service-account.json', '.git/config', 'secrets/notes.txt'])(
    'S0-bis : refuse %s sans rien renvoyer du contenu',
    async (nom) => {
      const payload = await lire(join(...nom.split('/')));
      expect(payload.error).toMatch(/fichier de secrets|contient des secrets/);
      expect(payload.error).toContain('ne pas chercher a contourner');
      expect(JSON.stringify(payload)).not.toContain('valeur-de-test');
    },
  );

  it('lit toujours un fichier normal', async () => {
    expect((await lire('notes.txt')).content).toBe('Bonjour Iris');
  });

  it('lit un modele .env.example (sans valeur)', async () => {
    expect((await lire('.env.example')).content).toBe('CLE_INVENTEE=');
  });

  it('lit une doc dont le nom contient SECRETS mais qui n est pas un secret', async () => {
    expect((await lire('SECRETS-POLITIQUE.md')).content).toBe('Doc sans secret');
  });

  it('refuse un lien au nom innocent qui pointe vers un .env', async (ctx) => {
    if (!lienCree) ctx.skip();
    const payload = await lire('innocent.txt');
    expect(payload.error).toContain('fichier de secrets');
    expect(JSON.stringify(payload)).not.toContain('valeur-de-test');
  });
});
