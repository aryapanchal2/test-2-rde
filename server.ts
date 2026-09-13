import express from "express";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { createServer as createViteServer } from "vite";

dotenv.config();

const app = express();
const PORT = 3000;

// Allow large payloads for PDF documents
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Lazy initializer for Gemini client
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is not configured.");
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

// Robust generation with exponential backoff and fallback for transient 503 / 429 errors
async function generateWithRetry(ai: GoogleGenAI, requestConfig: any, maxRetries = 3) {
  // Try primary gemini-3.8-flash first, then gemini-flash-latest if overloaded
  const models = ["gemini-3.8-flash", "gemini-flash-latest"];
  let lastError: any = null;

  for (const model of models) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        console.log(`Calling model ${model} (attempt ${attempt + 1})...`);
        const response = await ai.models.generateContent({
          ...requestConfig,
          model,
        });
        return response;
      } catch (err: any) {
        lastError = err;
        const msg = String(err?.message || "");
        const status = err?.status || err?.code;
        const isTransient =
          msg.includes("503") ||
          msg.includes("high demand") ||
          msg.includes("UNAVAILABLE") ||
          msg.includes("429") ||
          msg.includes("RESOURCE_EXHAUSTED") ||
          status === 503 ||
          status === 429;

        if (isTransient && attempt < maxRetries - 1) {
          const delay = (attempt + 1) * 2000;
          console.warn(`Transient ${status || 503} error on ${model}. Retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else if (isTransient) {
          // Switch to next model
          console.warn(`Retries exhausted for ${model}. Trying fallback model...`);
          break;
        } else {
          // Non-transient error, throw immediately
          throw err;
        }
      }
    }
  }

  throw lastError;
}

// Health check endpoint
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Text-based Chemical Reaction Extraction API
app.post("/api/extract", async (req, res) => {
  try {
    const { fileBase64, mimeType, fileName, textContent } = req.body;

    if (!fileBase64 && (!textContent || !textContent.trim())) {
      return res.status(400).json({
        success: false,
        error: "Please provide either an uploaded document or text content to extract.",
      });
    }

    const ai = getGeminiClient();

    const systemInstruction = `You are an expert chemical reaction data extractor for chemistry research.
Your goal is strictly text-based extraction: identify clearly in written form which starting material is converting into which product for every reaction in the provided chemistry research paper or experimental text.
Do NOT attempt any visual extraction or image creation. Only extract accurate written chemical names and transformations.

Return valid JSON with the following structure:
{
  "paperTitle": "Title of paper or document description",
  "reactions": [
    {
      "step": 1,
      "startingMaterials": ["exact chemical name or formula of reactant 1", "reactant 2"],
      "products": ["exact chemical name or formula of product formed"],
      "reagentsAndCatalysts": "catalysts, bases, or reagents used (if stated)",
      "conditions": "solvents, temperature, time, atmosphere (if stated)",
      "yield": "reported yield % or amount (if stated)",
      "summary": "Clear one-sentence text description: [Starting Material] converts into [Product]"
    }
  ],
  "rawSummary": "A concise, well-structured written summary paragraph of all chemical transformations found in the document."
}`;

    const contents: any[] = [];

    if (fileBase64) {
      // Document file upload (e.g. PDF or text file)
      const validMime = mimeType && mimeType.includes("pdf") ? "application/pdf" : (mimeType || "application/pdf");
      contents.push({
        inlineData: {
          mimeType: validMime,
          data: fileBase64,
        },
      });
      contents.push({
        text: `Analyze this uploaded research document (${fileName || "Paper"}).
Extract every chemical reaction described in the text and experimental procedures.
List which starting material converts into which product in written text form only.`,
      });
    } else {
      // Direct text input or extracted text
      contents.push({
        text: `Analyze the following chemistry research text and extract every chemical reaction:
${textContent}`,
      });
    }

    const response = await generateWithRetry(ai, {
      contents,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
      },
    });

    const outputText = response.text || "{}";
    let parsedData;
    try {
      parsedData = JSON.parse(outputText);
    } catch {
      return res.status(500).json({
        success: false,
        error: "Failed to parse model output as JSON.",
        raw: outputText,
      });
    }

    return res.json({
      success: true,
      paperTitle: parsedData.paperTitle || fileName || "Chemistry Research Document",
      reactions: parsedData.reactions || [],
      rawSummary: parsedData.rawSummary || "",
    });
  } catch (error: any) {
    console.error("Extraction error:", error);
    return res.status(500).json({
      success: false,
      error: error?.message || "An error occurred during chemical reaction extraction.",
    });
  }
});

// Vite middleware / static serving
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Reaction Extractor server running on port ${PORT}`);
  });
}

startServer();
