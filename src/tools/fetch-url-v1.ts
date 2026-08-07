import * as z from 'zod/v4';
import type { IrisTool } from './_types.js';
import { fetchText, MAX_TEXT_CHARS } from '../utils/http-fetch.js';
import { htmlToText, isHtmlContentType } from '../utils/html-text.js';
import { jsonResult, errorResult } from '../utils/git-run.js';

export const tool: IrisTool = {
  id: 'fetch-url-v1',
  description:
    'Recupere le contenu texte d une page web ou d une API publique en https (GET). ' +
    'Garde anti-SSRF : http, hotes locaux et IP privees refuses, redirections limitees a 3, ' +
    'texte plafonne (200 000 caracteres) avec indicateur de troncature. Le HTML est converti en texte.',
  category: 'web',
  inputSchema: {
    url: z
      .string()
      .min(1)
      .max(2048)
      .describe('URL https complete (http, localhost et IP privees sont refuses)'),
    max_chars: z
      .number()
      .int()
      .min(200)
      .max(MAX_TEXT_CHARS)
      .optional()
      .describe(`Plafond de caracteres du texte retourne (defaut et maximum ${MAX_TEXT_CHARS})`),
  },
  execute: async (input) => {
    const url = input.url as string;
    const maxChars = input.max_chars as number | undefined;

    try {
      const res = await fetchText(url, { maxChars });
      const html = isHtmlContentType(res.contentType);
      return jsonResult({
        url: res.url,
        final_url: res.finalUrl,
        status: res.status,
        content_type: res.contentType,
        // Le plafond s applique au corps brut : apres conversion HTML, le texte est plus court.
        format: html ? 'html_vers_texte' : 'brut',
        text: html ? htmlToText(res.text) : res.text,
        truncated: res.truncated,
        bytes_approx: res.bytesApprox,
        redirects: res.redirects,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return errorResult(msg);
    }
  },
};
