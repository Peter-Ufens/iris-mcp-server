import * as z from 'zod/v4';
import type { IrisTool } from './_types.js';
import { lierManuellement } from '../utils/rag-journal.js';

/**
 * rag-journal-link-v1 : confirme qu'une recherche RAG ratee (ou qui demandait une clarification)
 * a trouve sa reponse avec une recherche suivante. Ecrit une paire « manuel » dans le journal.
 * Sans IRIS_RAG_JOURNAL_DIR : ne fait rien et le dit.
 */
export const tool: IrisTool = {
  id: 'rag-journal-link-v1',
  description:
    'Journal des recherches (opt-in) : apres une recherche RAG ratee ou en clarification, puis une recherche qui trouve ' +
    'vraiment la reponse, confirme le lien entre les deux. Sans parametre : relie la derniere recherche ratee et la ' +
    'derniere reussie de la session. Ne modifie ni le glossaire ni l index. Inactif si le journal n est pas active.',
  category: 'memory',
  inputSchema: {
    echecId: z.string().optional().describe('Id de la recherche ratee (meta.journal.id). Defaut : la derniere de la session'),
    succesId: z.string().optional().describe('Id de la recherche reussie (meta.journal.id). Defaut : la derniere de la session'),
    note: z.string().max(500).optional().describe('Remarque courte, facultative'),
  },
  execute: async (input) => {
    const r = lierManuellement({
      echecId: input.echecId as string | undefined,
      succesId: input.succesId as string | undefined,
      note: input.note as string | undefined,
    });
    return { content: [{ type: 'text' as const, text: JSON.stringify({ tool: 'rag-journal-link-v1', ...r }, null, 2) }] };
  },
};
