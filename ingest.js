// ingest.js
// Reads documents from ./docs and links from ./urls.txt,
// chunks the text, generates Gemini embeddings,
// and stores everything in Supabase.

import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { GoogleGenAI } from "@google/genai";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import xlsx from "xlsx";
import axios from "axios";
import * as cheerio from "cheerio";
import "dotenv/config";

// ==========================================
// CONFIGURATION
// ==========================================

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const DOCS_FOLDER = "./docs";
const URLS_FILE = "./urls.txt";

const CHUNK_SIZE = 500;

// Gemini embedding model
const EMBEDDING_MODEL = "gemini-embedding-001";

// Supabase vector column is vector(768)
const EMBEDDING_DIMENSIONS = 768;

// ==========================================
// HELPERS
// ==========================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ==========================================
// TEXT CHUNKING
// ==========================================

function chunkText(text) {
  const words = text
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);

  const chunks = [];

  for (let i = 0; i < words.length; i += CHUNK_SIZE) {
    const chunk = words
      .slice(i, i + CHUNK_SIZE)
      .join(" ")
      .trim();

    if (chunk) {
      chunks.push(chunk);
    }
  }

  return chunks;
}

// ==========================================
// FILE TEXT EXTRACTION
// ==========================================

async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const buffer = fs.readFileSync(filePath);

  // PDF
  if (ext === ".pdf") {
    console.log("  Reading PDF...");

    const parser = new PDFParse({
      data: buffer,
    });

    const result = await parser.getText();

    await parser.destroy();

    return result.text || "";
  }

  // DOCX
  if (ext === ".docx") {
    console.log("  Reading Word document...");

    const result = await mammoth.extractRawText({
      buffer,
    });

    return result.value || "";
  }

  // Excel
  if (ext === ".xlsx" || ext === ".xls") {
    console.log("  Reading Excel file...");

    const workbook = xlsx.read(buffer, {
      type: "buffer",
    });

    let text = "";

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];

      text += `\n--- Sheet: ${sheetName} ---\n`;

      text += xlsx.utils.sheet_to_csv(sheet);

      text += "\n";
    }

    return text;
  }

  // TXT
  if (ext === ".txt") {
    console.log("  Reading text file...");

    return buffer.toString("utf-8");
  }

  console.log(`  Skipping unsupported file type: ${filePath}`);

  return "";
}

// ==========================================
// WEBSITE EXTRACTION
// ==========================================

async function extractFromUrl(url) {
  const { data } = await axios.get(url, {
    timeout: 15000,
  });

  const $ = cheerio.load(data);

  $("script, style, nav, footer").remove();

  return $("body")
    .text()
    .replace(/\s+/g, " ")
    .trim();
}

// ==========================================
// GEMINI EMBEDDING
// ==========================================

async function getEmbedding(text) {
  const MAX_RETRIES = 5;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await ai.models.embedContent({
        model: EMBEDDING_MODEL,
        contents: text,
        config: {
          outputDimensionality: EMBEDDING_DIMENSIONS,
          taskType: "RETRIEVAL_DOCUMENT",
        },
      });

      if (
        !result.embeddings ||
        !result.embeddings[0] ||
        !result.embeddings[0].values
      ) {
        throw new Error("Gemini returned an empty embedding.");
      }

      const embedding = result.embeddings[0].values;

      if (embedding.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(
          `Wrong embedding dimension. Expected ${EMBEDDING_DIMENSIONS}, got ${embedding.length}.`
        );
      }

      return embedding;
    } catch (err) {
      const status =
        err?.status ||
        err?.code ||
        err?.response?.status;

      const message = err?.message || String(err);

      // Rate limit
      if (status === 429 && attempt < MAX_RETRIES) {
        const waitTime = attempt * 10000;

        console.log(
          `  Gemini rate limit reached. Waiting ${
            waitTime / 1000
          } seconds before retry ${attempt + 1}/${MAX_RETRIES}...`
        );

        await sleep(waitTime);

        continue;
      }

      throw new Error(
        `Gemini embedding failed: ${message}`
      );
    }
  }

  throw new Error("Unable to generate embedding.");
}

// ==========================================
// STORE CHUNKS IN SUPABASE
// ==========================================

async function storeChunks(
  chunks,
  sourceName,
  sourceType
) {
  console.log(
    `  Found ${chunks.length} chunks for ${sourceName}`
  );

  let stored = 0;
  let failed = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];

    if (!chunk.trim()) {
      continue;
    }

    console.log(
      `  Embedding chunk ${i + 1}/${chunks.length}...`
    );

    try {
      const embedding = await getEmbedding(chunk);

      const { error } = await supabase
        .from("documents")
        .insert({
          content: chunk,
          embedding: embedding,
          source_name: sourceName,
          source_type: sourceType,
        });

      if (error) {
        failed++;

        console.error(
          `  Supabase error for ${sourceName}:`,
          error.message
        );
      } else {
        stored++;

        console.log(
          `  Stored chunk ${stored}/${chunks.length}`
        );
      }

      // Small delay between requests
      // Helps reduce rate-limit problems.
      await sleep(2000);
    } catch (err) {
      failed++;

      console.error(
        `  Embedding error for ${sourceName}:`,
        err.message
      );
    }
  }

  console.log(
    `  Finished ${sourceName}: ${stored} stored, ${failed} failed.`
  );
}

// ==========================================
// PROCESS LOCAL FILES
// ==========================================

async function processFiles() {
  if (!fs.existsSync(DOCS_FOLDER)) {
    console.log(
      "No ./docs folder found yet, skipping files."
    );

    return;
  }

  const files = fs
    .readdirSync(DOCS_FOLDER)
    .filter((file) => {
      const ext = path.extname(file).toLowerCase();

      return [
        ".pdf",
        ".docx",
        ".xlsx",
        ".xls",
        ".txt",
      ].includes(ext);
    });

  if (files.length === 0) {
    console.log("No supported documents found in ./docs.");

    return;
  }

  console.log(
    `Found ${files.length} document(s) in ./docs.`
  );

  for (const file of files) {
    const filePath = path.join(
      DOCS_FOLDER,
      file
    );

    console.log("");
    console.log(
      "=========================================="
    );
    console.log(`Processing file: ${file}`);
    console.log(
      "=========================================="
    );

    try {
      const text = await extractText(filePath);

      if (!text || !text.trim()) {
        console.log(
          `  No readable text found in ${file}.`
        );

        continue;
      }

      console.log(
        `  Extracted ${text.length} characters.`
      );

      const chunks = chunkText(text);

      await storeChunks(
        chunks,
        file,
        path.extname(file).replace(".", "") ||
          "unknown"
      );
    } catch (err) {
      console.error(
        `  Failed to process ${file}:`,
        err.message
      );
    }
  }
}

// ==========================================
// PROCESS URLs
// ==========================================

async function processUrls() {
  if (!fs.existsSync(URLS_FILE)) {
    console.log(
      "No urls.txt found yet, skipping websites."
    );

    return;
  }

  const urls = fs
    .readFileSync(URLS_FILE, "utf-8")
    .split("\n")
    .map((url) => url.trim())
    .filter(Boolean);

  if (urls.length === 0) {
    console.log(
      "urls.txt is empty, skipping websites."
    );

    return;
  }

  for (const url of urls) {
    console.log("");
    console.log(
      "=========================================="
    );
    console.log(`Processing URL: ${url}`);
    console.log(
      "=========================================="
    );

    try {
      const text = await extractFromUrl(url);

      if (!text || !text.trim()) {
        console.log(
          `  No readable text found at ${url}.`
        );

        continue;
      }

      const chunks = chunkText(text);

      await storeChunks(
        chunks,
        url,
        "website"
      );
    } catch (err) {
      console.error(
        `  Failed to fetch ${url}:`,
        err.message
      );
    }
  }
}

// ==========================================
// MAIN
// ==========================================

async function main() {
  console.log("");
  console.log("==========================================");
  console.log("       SATTU AI ASSISTANT INGESTION");
  console.log("==========================================");
  console.log("");

  try {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error(
        "GEMINI_API_KEY is missing from .env"
      );
    }

    if (!process.env.SUPABASE_URL) {
      throw new Error(
        "SUPABASE_URL is missing from .env"
      );
    }

    if (!process.env.SUPABASE_SERVICE_KEY) {
      throw new Error(
        "SUPABASE_SERVICE_KEY is missing from .env"
      );
    }

    console.log(
      `Embedding model: ${EMBEDDING_MODEL}`
    );

    console.log(
      `Embedding dimensions: ${EMBEDDING_DIMENSIONS}`
    );

    console.log("");

    // ==========================================
    // LOCAL PDF / EXCEL FILES TEMPORARILY SKIPPED
    // ==========================================

    console.log(
      "Local PDF/Excel files are temporarily skipped."
    );

    console.log(
      "Processing URLs only..."
    );

    console.log("");

    // ==========================================
    // PROCESS URLs
    // ==========================================

    await processUrls();

    console.log("");
    console.log("==========================================");
    console.log("           URL INGESTION DONE");
    console.log("==========================================");
    console.log("");

    console.log(
      "URLs have been processed and stored in Supabase."
    );

  } catch (err) {
    console.error("");
    console.error(
      "FATAL ERROR:",
      err.message
    );
    console.error("");
    process.exit(1);
  }
}

main();