import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export interface ToolAccess {
  ensureDb: () => Promise<void>;
  getDB: () => any;
}

// Fuzzy matching utilities
function levenshteinDistance(a: string, b: string): number {
  const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));
  
  for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= b.length; j++) matrix[j][0] = j;
  
  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,     // deletion
        matrix[j - 1][i] + 1,     // insertion
        matrix[j - 1][i - 1] + indicator // substitution
      );
    }
  }
  
  return matrix[b.length][a.length];
}

function normalizeString(str: string): string {
  return str.toLowerCase()
    .replace(/[^\w\s]/g, '') // Remove punctuation
    .replace(/\s+/g, ' ')    // Normalize whitespace
    .trim();
}

function normalizeNameForMatching(name: string): string {
  return name.toLowerCase()
    .replace(/\b(elder|president)\b/g, '') // Remove titles
    .replace(/[^\w\s]/g, ' ')              // Replace punctuation with spaces
    .replace(/\s+/g, ' ')                  // Normalize whitespace
    .trim();
}

function fuzzyMatch(input: string, target: string, threshold: number = 0.7): boolean {
  const normalizedInput = normalizeString(input);
  const normalizedTarget = normalizeString(target);
  
  // Exact match or contains
  if (normalizedTarget.includes(normalizedInput) || normalizedInput.includes(normalizedTarget)) {
    return true;
  }
  
  // Levenshtein distance similarity
  const maxLength = Math.max(normalizedInput.length, normalizedTarget.length);
  if (maxLength === 0) return true;
  
  const distance = levenshteinDistance(normalizedInput, normalizedTarget);
  const similarity = 1 - (distance / maxLength);
  
  return similarity >= threshold;
}

// Scripture book name mappings and fuzzy matching
const SCRIPTURE_BOOKS = [
  // Bible - Old Testament
  'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy', 'Joshua', 'Judges', 'Ruth',
  '1 Samuel', '2 Samuel', '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles', 'Ezra', 'Nehemiah',
  'Esther', 'Job', 'Psalms', 'Proverbs', 'Ecclesiastes', 'Song of Solomon', 'Isaiah', 'Jeremiah',
  'Lamentations', 'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos', 'Obadiah', 'Jonah', 'Micah',
  'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai', 'Zechariah', 'Malachi',
  // Bible - New Testament  
  'Matthew', 'Mark', 'Luke', 'John', 'Acts', 'Romans', '1 Corinthians', '2 Corinthians', 'Galatians',
  'Ephesians', 'Philippians', 'Colossians', '1 Thessalonians', '2 Thessalonians', '1 Timothy', 
  '2 Timothy', 'Titus', 'Philemon', 'Hebrews', 'James', '1 Peter', '2 Peter', '1 John', '2 John',
  '3 John', 'Jude', 'Revelation',
  // Book of Mormon
  '1 Nephi', '2 Nephi', 'Jacob', 'Enos', 'Jarom', 'Omni', 'Words of Mormon', 'Mosiah', 'Alma',
  'Helaman', '3 Nephi', '4 Nephi', 'Mormon', 'Ether', 'Moroni',
  // Doctrine and Covenants
  'Doctrine and Covenants', 'D&C',
  // Pearl of Great Price
  'Moses', 'Abraham', 'Joseph Smith—Matthew', 'Joseph Smith—History', 'Articles of Faith'
];

const BOOK_ALIASES: { [key: string]: string } = {
  // Common abbreviations
  'gen': 'Genesis', 'ex': 'Exodus', 'lev': 'Leviticus', 'num': 'Numbers', 'deut': 'Deuteronomy',
  'josh': 'Joshua', 'judg': 'Judges', '1 sam': '1 Samuel', '2 sam': '2 Samuel',
  '1 kgs': '1 Kings', '2 kgs': '2 Kings', '1 chr': '1 Chronicles', '2 chr': '2 Chronicles',
  'neh': 'Nehemiah', 'ps': 'Psalms', 'psalm': 'Psalms', 'prov': 'Proverbs', 'eccl': 'Ecclesiastes',
  'song': 'Song of Solomon', 'isa': 'Isaiah', 'jer': 'Jeremiah', 'lam': 'Lamentations',
  'ezek': 'Ezekiel', 'dan': 'Daniel', 'matt': 'Matthew', '1 cor': '1 Corinthians', 
  '2 cor': '2 Corinthians', 'gal': 'Galatians', 'eph': 'Ephesians', 'phil': 'Philippians',
  'col': 'Colossians', '1 thes': '1 Thessalonians', '2 thes': '2 Thessalonians',
  '1 tim': '1 Timothy', '2 tim': '2 Timothy', 'philem': 'Philemon', 'heb': 'Hebrews',
  '1 pet': '1 Peter', '2 pet': '2 Peter', 'rev': 'Revelation',
  // Book of Mormon abbreviations
  '1 ne': '1 Nephi', '2 ne': '2 Nephi', 'wom': 'Words of Mormon', '3 ne': '3 Nephi',
  '4 ne': '4 Nephi', 'morm': 'Mormon', 'moro': 'Moroni',
  // D&C abbreviations
  'dc': 'Doctrine and Covenants', 'doc': 'Doctrine and Covenants', 'covenants': 'Doctrine and Covenants',
  // Pearl of Great Price abbreviations
  'js-m': 'Joseph Smith—Matthew', 'js-h': 'Joseph Smith—History', 'js-matthew': 'Joseph Smith—Matthew',
  'js-history': 'Joseph Smith—History', 'aof': 'Articles of Faith'
};

function findBestBookMatch(input: string): string | null {
  const normalizedInput = normalizeString(input);
  
  // Check exact alias matches first
  if (BOOK_ALIASES[normalizedInput]) {
    return BOOK_ALIASES[normalizedInput];
  }
  
  // Try fuzzy matching against all books
  let bestMatch = null;
  let bestScore = 0;
  
  for (const book of SCRIPTURE_BOOKS) {
    const normalizedBook = normalizeString(book);
    
    // Check if input is contained in book name or vice versa
    if (normalizedBook.includes(normalizedInput) || normalizedInput.includes(normalizedBook)) {
      return book;
    }
    
    // Check fuzzy similarity
    if (fuzzyMatch(normalizedInput, normalizedBook, 0.6)) {
      const maxLength = Math.max(normalizedInput.length, normalizedBook.length);
      const distance = levenshteinDistance(normalizedInput, normalizedBook);
      const score = 1 - (distance / maxLength);
      
      if (score > bestScore) {
        bestScore = score;
        bestMatch = book;
      }
    }
  }
  
  return bestScore > 0.6 ? bestMatch : null;
}

export function registerAllTools(server: McpServer, access: ToolAccess) {
  const debug = !!process.env.GOSPEL_DEBUG;
  
  // Simple tool wrapper with better error handling
  const safeTool = (name: string, description: string, inputSchema: any, handler: any) => {
    server.registerTool(name, {
      title: name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()), // Convert snake_case to Title Case
      description: description,
      inputSchema: inputSchema
    }, async (args: any) => {
      try {
        if (debug) console.error(`[gospel-library] tool invoke ${name}`);
        
        // Single DB initialization
        await access.ensureDb();
        const database = access.getDB();
        
        const res = await handler(args, database);
        if (debug) console.error(`[gospel-library] tool result ${name} ok`);
        return res;
      } catch (e: any) {
        console.error(`[gospel-library] tool error ${name}:`, e?.message || e);
        return { 
          content: [{ 
            type: 'text', 
            text: `Error: ${e?.message || 'Tool execution failed'}` 
          }] 
        };
      }
    });
  };

  // Enhanced scripture reference parser with fuzzy matching
  const parseReference = (input: string) => {
    if (!input?.trim()) return null;
    
    const normalized = input.replace(/[\u2012-\u2015\u2212]/g, '-').trim();
    
    // Try multiple parsing patterns
    const patterns = [
      // Standard format: "Book Chapter:Verse" or "Book Chapter:Verse-Verse"
      /^\s*([1-3]?\s?[A-Za-z&\.\s]+?)\s+(\d+):(\d+)(?:-(\d+))?\s*$/,
      // Shortened format: "Book Verse" (assumes chapter 1) - e.g., "Omni 7" -> "Omni 1:7"
      /^\s*([1-3]?\s?[A-Za-z&\.\s]+?)\s+(\d+)\s*$/,
      // D&C section format: "D&C 76" or "Section 76"
      /^\s*(?:D&C|Doctrine and Covenants|Section)\s+(\d+)(?::(\d+)(?:-(\d+))?)?\s*$/i
    ];
    
    for (let i = 0; i < patterns.length; i++) {
      const match = normalized.match(patterns[i]);
      if (match) {
        let book: string = '';
        let chapter: number = 0;
        let verseStart: number = 0;
        let verseEnd: number = 0;
        
        if (i === 0) {
          // Standard format
          book = match[1].replace(/\s+/g, ' ').trim();
          chapter = parseInt(match[2]);
          verseStart = parseInt(match[3]);
          verseEnd = match[4] ? parseInt(match[4]) : verseStart;
        } else if (i === 1) {
          // Shortened format - assume chapter 1
          book = match[1].replace(/\s+/g, ' ').trim();
          chapter = 1;
          verseStart = parseInt(match[2]);
          verseEnd = verseStart;
        } else if (i === 2) {
          // D&C format
          book = 'Doctrine and Covenants';
          chapter = parseInt(match[1]);
          verseStart = match[2] ? parseInt(match[2]) : 1;
          verseEnd = match[3] ? parseInt(match[3]) : verseStart;
        }
        
        // Apply fuzzy matching to find the best book name
        const bestBook = findBestBookMatch(book);
        if (bestBook && verseEnd >= verseStart && chapter > 0 && verseStart > 0) {
          return { book: bestBook, chapter, verseStart, verseEnd };
        }
      }
    }
    return null;
  };

  // Simplified passage fetcher
  const fetchPassage = async (database: any, parsed: any) => {
    if (parsed.verseEnd - parsed.verseStart > 50) {
      return { content: [{ type: "text", text: "Verse range too large (max 50 verses)" }] };
    }

    const stmt = database.prepare(`SELECT verse, text FROM scriptures WHERE book=? AND chapter=? AND verse BETWEEN ? AND ? ORDER BY verse;`);
    const result = await stmt.bind(parsed.book, parsed.chapter, parsed.verseStart, parsed.verseEnd).all();
    const verses = result.results || [];

    if (!verses.length) {
      return { content: [{ type: "text", text: `No verses found for ${parsed.book} ${parsed.chapter}:${parsed.verseStart}${parsed.verseEnd !== parsed.verseStart ? '-' + parsed.verseEnd : ''}` }] };
    }

    const citation = `${parsed.book} ${parsed.chapter}:${parsed.verseStart}${parsed.verseEnd !== parsed.verseStart ? '-' + parsed.verseEnd : ''}`;
    const versesText = verses.map((v: any) => `${v.verse} ${v.text}`).join('\n');
    
    return { 
      content: [
        { type: "text", text: citation },
        { type: "text", text: versesText }
      ] 
    };
  };

  // Exact scripture retrieval tool
  safeTool(
    "get_exact_scripture",
    "Fetch an exact LDS scripture verse or short contiguous range (Bible, Book of Mormon, D&C, Pearl of Great Price). Always call before quoting scripture wording.",
    {
      reference: z.string().describe("Required. A verse or short range: 'John 3:16', 'Alma 32:27-28', '1 Nephi 3:7'. Range limit: <=50 verses.")
    },
    async ({ reference }: { reference: string }, database: any) => {
    if (!reference) {
      return { content: [{ type: 'text', text: 'Missing required parameter: reference' }] };
    }
    const parsed = parseReference(reference);
    if (!parsed) {
      return { content: [{ type: 'text', text: 'Invalid scripture reference. Examples: "John 3:16", "1 Nephi 3:7", "Alma 32:27-28"' }] };
    }
    return fetchPassage(database, parsed);
  });

  // Scripture keyword/topic search tool
  safeTool(
    "search_scriptures_by_keyword",
    "Search LDS scriptures by keyword/phrase (topic discovery). Use before teaching on a topic or when user asks 'verses about X'.",
    {
      query: z.string().describe("Required. Keyword or short phrase (<100 chars), e.g. 'charity', 'plan of salvation', 'endure to the end'."),
      limit: z.number().min(1).max(20).optional().describe("Max number of results (default 10).")
    },
    async ({ query, limit }: { query: string; limit?: number }, database: any) => {
    if (!query) {
      return { content: [{ type: 'text', text: 'Missing required parameter: query' }] };
    }
    if (query.length > 100) {
      return { content: [{ type: 'text', text: 'Search query too long (max 100 characters)' }] };
    }
    const lim = Math.min(limit || 10, 20);
    const stmt = database.prepare(`SELECT book, chapter, verse, text FROM scriptures WHERE lower(text) LIKE ? LIMIT ?;`);
    const result = await stmt.bind(`%${query.toLowerCase()}%`, lim).all();
    const rows = result.results || [];
    if (!rows.length) {
      return { content: [{ type: 'text', text: 'No results found.' }] };
    }
    return { 
      content: rows.map((r: any) => ({ 
        type: 'text', 
        text: `${r.book} ${r.chapter}:${r.verse} - ${r.text.substring(0, 150)}${r.text.length > 150 ? '...' : ''}` 
      }))
    };
  });

  // Random scripture tool (optional utility)
  safeTool(
    "get_random_scripture",
    "Return a single random scripture verse (any standard work). Useful for daily verse prompts.",
    {},
    async (_args: {}, database: any) => {
    const stmt = database.prepare(`SELECT book, chapter, verse, text FROM scriptures ORDER BY RANDOM() LIMIT 1;`);
    const row = await stmt.first();
    if (!row) {
      return { content: [{ type: 'text', text: 'No scriptures available.' }] };
    }
    return { 
      content: [
        { type: 'text', text: `${row.book} ${row.chapter}:${row.verse}` },
        { type: 'text', text: row.text }
      ]
    };
  });

  // Conference talks tool
  safeTool(
    "search_conference_talks",
    "General Conference talks (modern prophets/apostles). Use for quotes, sourcing, or locating talks by speaker, conference, or topic. Use 'id' for a specific talk; otherwise filter with speaker/conference/query (keep query <100 chars). Combine with scripture tool if both modern and canonical sources are requested. Always fetch before quoting.",
    {
      id: z.number().optional().describe("Specific talk ID to retrieve"),
      query: z.string().optional().describe("Keyword(s)/phrase to search in talk content. Keep under 100 chars."),
      speaker: z.string().optional().describe("Speaker name (full or partial). E.g. 'Nelson', 'Russell M. Nelson', 'Holland'."),
      conference: z.string().optional().describe("Conference identifier (e.g., 'April 2023', 'Oct 2022', or '2023-04')."),
      limit: z.number().min(1).max(20).optional().describe("Maximum number of results (default 10). Use smaller numbers for broad topics.")
    },
    async ({ id, query, speaker, conference, limit }: { id?: number; query?: string; speaker?: string; conference?: string; limit?: number }, database: any) => {
    
    // Get specific talk by ID
    if (id) {
      const stmt = database.prepare(`SELECT speaker, title, conference, date, full_text FROM conference_talks WHERE id=?;`);
      const row = await stmt.bind(id).first();
      if (!row) {
        return { content: [{ type: 'text', text: 'Talk not found.' }] };
      }
      
      const text = row.full_text || '';
      const truncated = text.length > 1500 ? text.substring(0, 1500) + '...\n[Text truncated - use ID to get full talk]' : text;
      
      return { 
        content: [
          { type: 'text', text: `${row.speaker} - ${row.title} (${row.conference}, ${row.date})` },
          { type: 'text', text: truncated }
        ] 
      };
    }

    // Build search query with fuzzy matching support
    let sql = `SELECT id, speaker, title, conference, date, substr(full_text, 1, 200) as excerpt FROM conference_talks WHERE 1=1`;
    const binds: any[] = [];

    if (speaker) {
      // First try exact/simple matching
      let speakerMatched = false;
      
      // Try enhanced fuzzy matching by getting all speakers and finding the best match
      const allSpeakersStmt = database.prepare(`SELECT DISTINCT speaker FROM conference_talks;`);
      const allSpeakersResult = await allSpeakersStmt.bind().all();
      const allSpeakers = (allSpeakersResult.results || []).map((row: any) => row.speaker);
      
      let bestSpeakerMatch = null;
      let bestScore = 0;
      
      const normalizedInput = normalizeNameForMatching(speaker);
      
      for (const dbSpeaker of allSpeakers) {
        const normalizedDbSpeaker = normalizeNameForMatching(dbSpeaker);
        
        // Check for exact substring matches first
        if (normalizedDbSpeaker.includes(normalizedInput) || normalizedInput.includes(normalizedDbSpeaker)) {
          bestSpeakerMatch = dbSpeaker;
          bestScore = 1.0;
          break;
        }
        
        // Check fuzzy similarity with a lower threshold for names
        if (fuzzyMatch(normalizedInput, normalizedDbSpeaker, 0.5)) {
          const maxLength = Math.max(normalizedInput.length, normalizedDbSpeaker.length);
          const distance = levenshteinDistance(normalizedInput, normalizedDbSpeaker);
          const score = 1 - (distance / maxLength);
          
          // Debug output for troubleshooting
          if (debug && normalizedDbSpeaker.includes('russell') && normalizedInput.includes('russel')) {
            console.error(`[DEBUG] Comparing "${normalizedInput}" vs "${normalizedDbSpeaker}": distance=${distance}, score=${score}`);
          }
          
          if (score > bestScore) {
            bestScore = score;
            bestSpeakerMatch = dbSpeaker;
          }
        }
      }
      
      if (bestSpeakerMatch && bestScore > 0.4) {
        sql += ` AND speaker = ?`;
        binds.push(bestSpeakerMatch);
        speakerMatched = true;
      }
      
      // If no good fuzzy match found, fall back to partial matching
      if (!speakerMatched) {
        sql += ` AND lower(speaker) LIKE ?`;
        binds.push(`%${speaker.toLowerCase()}%`);
      }
    }

    if (conference) {
      // Conference name fuzzy matching
      let conferenceMatched = false;
      
      // Get all conference names and try fuzzy matching
      const allConferencesStmt = database.prepare(`SELECT DISTINCT conference FROM conference_talks;`);
      const allConferencesResult = await allConferencesStmt.bind().all();
      const allConferences = (allConferencesResult.results || []).map((row: any) => row.conference);
      
      let bestConferenceMatch = null;
      let bestScore = 0;
      
      const normalizedInput = conference.toLowerCase()
        .replace(/\b(oct|october)\b/g, 'october')
        .replace(/\b(apr|april)\b/g, 'april')
        .replace(/\b(gen|general)\b/g, 'general')
        .replace(/\b(conf|conference)\b/g, 'conference')
        .trim();
      
      for (const dbConference of allConferences) {
        const normalizedDbConference = dbConference.toLowerCase();
        
        // Check for exact substring matches first
        if (normalizedDbConference.includes(normalizedInput) || normalizedInput.includes(normalizedDbConference)) {
          bestConferenceMatch = dbConference;
          bestScore = 1.0;
          break;
        }
        
        // Check fuzzy similarity 
        if (fuzzyMatch(normalizedInput, normalizedDbConference, 0.6)) {
          const maxLength = Math.max(normalizedInput.length, normalizedDbConference.length);
          const distance = levenshteinDistance(normalizedInput, normalizedDbConference);
          const score = 1 - (distance / maxLength);
          
          if (score > bestScore) {
            bestScore = score;
            bestConferenceMatch = dbConference;
          }
        }
      }
      
      if (bestConferenceMatch && bestScore > 0.6) {
        sql += ` AND conference = ?`;
        binds.push(bestConferenceMatch);
        conferenceMatched = true;
      }
      
      // If no good fuzzy match found, fall back to partial matching
      if (!conferenceMatched) {
        sql += ` AND lower(conference) LIKE ?`;
        binds.push(`%${conference.toLowerCase()}%`);
      }
    }

    if (query) {
      if (query.length > 100) {
        return { content: [{ type: 'text', text: 'Search query too long (max 100 characters)' }] };
      }
      sql += ` AND lower(full_text) LIKE ?`;
      binds.push(`%${query.toLowerCase()}%`);
    }

    const lim = Math.min(limit || 10, 20);
    sql += ` ORDER BY date DESC LIMIT ?`;
    binds.push(lim);

    const stmt = database.prepare(sql);
    const result = await stmt.bind(...binds).all();
    const rows = result.results || [];

    if (!rows.length) {
      return { content: [{ type: 'text', text: 'No talks found matching those criteria.' }] };
    }

    // If only one result, return the full talk content
    if (rows.length === 1) {
      const talk = rows[0];
      const fullTalkStmt = database.prepare(`SELECT speaker, title, conference, date, full_text FROM conference_talks WHERE id=?;`);
      const fullTalk = await fullTalkStmt.bind(talk.id).first();
      
      if (fullTalk && fullTalk.full_text) {
        // Return the complete talk without truncation since there's only one result
        return { 
          content: [
            { type: 'text', text: `${fullTalk.speaker} - ${fullTalk.title} (${fullTalk.conference}, ${fullTalk.date})` },
            { type: 'text', text: fullTalk.full_text }
          ] 
        };
      }
    }

    // Multiple results - return excerpts
    return { 
      content: rows.map((r: any) => ({ 
        type: 'text', 
        text: `[ID: ${r.id}] ${r.speaker} - ${r.title} (${r.conference})\n${r.excerpt}...` 
      }))
    };
  });
}
