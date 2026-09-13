import { useState, useRef, ChangeEvent, DragEvent } from "react";
import { Upload, FileText, ArrowRight, Copy, Check, RotateCcw, AlertCircle, Sparkles } from "lucide-react";
import { ExtractionResponse, ReactionStep } from "./types";
import { SAMPLE_PROCEDURE } from "./sampleData";

export default function App() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractionResponse | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [pastedText, setPastedText] = useState<string>("");
  const [showPasteMode, setShowPasteMode] = useState<boolean>(false);
  const [lastPayload, setLastPayload] = useState<{
    fileBase64?: string;
    mimeType?: string;
    fileName?: string;
    textContent?: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Safe file reader converting File to base64 with slice isolation
  const readFileAsBase64 = async (file: File): Promise<string> => {
    // 1. First attempt: isolated slice with arrayBuffer
    try {
      const slice = file.slice(0, file.size, file.type || "application/pdf");
      const buffer = await slice.arrayBuffer();
      let binary = "";
      const bytes = new Uint8Array(buffer);
      const len = bytes.byteLength;
      const chunkSize = 16384;
      for (let i = 0; i < len; i += chunkSize) {
        const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
        binary += String.fromCharCode.apply(null, Array.from(chunk));
      }
      return btoa(binary);
    } catch {
      // 2. Fallback attempt: FileReader on sliced blob
      return new Promise<string>((resolve, reject) => {
        try {
          const reader = new FileReader();
          reader.onload = () => {
            const resultStr = reader.result as string;
            const commaIndex = resultStr.indexOf(",");
            resolve(commaIndex >= 0 ? resultStr.slice(commaIndex + 1) : resultStr);
          };
          reader.onerror = () => {
            reject(reader.error || new Error("Failed to read file"));
          };
          const slice = file.slice(0, file.size);
          reader.readAsDataURL(slice);
        } catch (innerErr) {
          reject(innerErr);
        }
      });
    }
  };

  // Helper to process file into base64 or text
  const handleFileProcess = async (file: File) => {
    setSelectedFile(file);
    setError(null);
    setResult(null);
    setLoading(true);

    try {
      const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      if (isPdf) {
        const base64Data = await readFileAsBase64(file);
        await submitExtraction({
          fileBase64: base64Data,
          mimeType: "application/pdf",
          fileName: file.name,
        });
      } else {
        // Plain text, markdown, or text-based documents
        let text = "";
        try {
          const slice = file.slice(0, file.size);
          text = await slice.text();
        } catch {
          const slice = file.slice(0, file.size);
          const buffer = await slice.arrayBuffer();
          const decoder = new TextDecoder("utf-8");
          text = decoder.decode(buffer);
        }

        if (!text.trim()) {
          throw new Error("The uploaded file contains no readable text content.");
        }

        await submitExtraction({
          textContent: text,
          fileName: file.name,
        });
      }
    } catch (err: any) {
      console.error("File reading error:", err);
      const rawMsg = String(err?.message || err?.name || "");
      if (
        rawMsg.includes("permission problems") ||
        rawMsg.includes("NotReadableError") ||
        err?.name === "NotReadableError"
      ) {
        setError(
          "Your operating system locked this file because it is currently open in another app (like Adobe Acrobat, PDF reader, or cloud-sync). Please close the document in other programs, or use 'Paste Text Directly' below."
        );
        setShowPasteMode(true);
      } else {
        setError(rawMsg || "Could not read the uploaded file. Please try pasting the text directly.");
      }
      setLoading(false);
    }
  };

  const submitExtraction = async (payload: {
    fileBase64?: string;
    mimeType?: string;
    fileName?: string;
    textContent?: string;
  }) => {
    setLastPayload(payload);
    setError(null);
    setLoading(true);
    try {
      const response = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to extract reaction data from document.");
      }

      setResult(data);
    } catch (err: any) {
      console.error("Extraction error:", err);
      setError(err.message || "Failed to communicate with extraction server.");
    } finally {
      setLoading(false);
    }
  };

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFileProcess(e.target.files[0]);
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileProcess(e.dataTransfer.files[0]);
    }
  };

  const handleLoadSample = async () => {
    setSelectedFile(new File([SAMPLE_PROCEDURE], "Suzuki-Miyaura_Procedure.txt", { type: "text/plain" }));
    setError(null);
    setResult(null);
    setLoading(true);
    await submitExtraction({
      textContent: SAMPLE_PROCEDURE,
      fileName: "Suzuki-Miyaura_Procedure.txt",
    });
  };

  const handlePasteSubmit = async () => {
    if (!pastedText.trim()) {
      setError("Please paste chemical procedure or research paper text first.");
      return;
    }
    setSelectedFile(null);
    setError(null);
    setResult(null);
    setLoading(true);
    await submitExtraction({
      textContent: pastedText.trim(),
      fileName: "Pasted Chemical Procedure",
    });
  };

  const handleReset = () => {
    setSelectedFile(null);
    setResult(null);
    setError(null);
    setPastedText("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleCopyText = () => {
    if (!result) return;
    const textLines = [
      `Document: ${result.paperTitle || "Uploaded Document"}`,
      `Extraction Results (${result.reactions.length} reactions):`,
      "",
      ...result.reactions.map(
        (r, i) =>
          `Reaction ${i + 1}:\n• Starting Material(s): ${r.startingMaterials.join(", ")}\n• Converts into Product(s): ${r.products.join(", ")}${
            r.reagentsAndCatalysts ? `\n• Reagents/Catalysts: ${r.reagentsAndCatalysts}` : ""
          }${r.conditions ? `\n• Conditions: ${r.conditions}` : ""}${r.yield ? `\n• Yield: ${r.yield}` : ""}\n• Summary: ${r.summary}`
      ),
      "",
      `Overview Summary:\n${result.rawSummary || "None"}`,
    ].join("\n");

    navigator.clipboard.writeText(textLines);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
      {/* Top Header */}
      <header className="border-b border-slate-200 bg-white sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-700 text-white flex items-center justify-center font-semibold text-lg shadow-xs">
              Rx
            </div>
            <div>
              <h1 className="font-semibold text-slate-900 text-base leading-tight">
                Reaction Text Extractor
              </h1>
              <p className="text-xs text-slate-500">
                Text-based chemical conversion extraction from research literature
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <button
              id="btn-sample-procedure"
              onClick={handleLoadSample}
              disabled={loading}
              className="text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-md transition-colors flex items-center space-x-1.5 cursor-pointer disabled:opacity-50"
            >
              <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
              <span>Load Sample Procedure</span>
            </button>
            {result && (
              <button
                id="btn-reset"
                onClick={handleReset}
                className="text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-md transition-colors flex items-center space-x-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Upload Another</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-8">
        {/* Hidden File Input */}
        <input
          ref={fileInputRef}
          type="file"
          id="file-upload-input"
          accept=".pdf,.txt,.doc,.docx"
          onChange={handleFileInputChange}
          className="hidden"
        />

        {/* Upload Interface Box */}
        {!result && !loading && (
          <div
            id="dropzone-area"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-xl p-10 sm:p-14 text-center transition-all ${
              isDragging
                ? "border-emerald-500 bg-emerald-50/50 scale-[1.01]"
                : "border-slate-300 bg-white hover:border-slate-400"
            }`}
          >
            <div className="w-16 h-16 rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center mx-auto mb-4">
              <Upload className="w-8 h-8" />
            </div>

            <h2 className="text-xl font-semibold text-slate-900 mb-2">
              Upload Chemistry Research Paper
            </h2>
            <p className="text-sm text-slate-600 max-w-md mx-auto mb-6">
              Select or drop your research paper (PDF or text) to extract in written text form which starting material is converting into which product.
            </p>

            {/* Primary Upload Button */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                id="btn-document-upload"
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center space-x-2 px-6 py-3 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-medium text-sm transition-colors shadow-xs cursor-pointer"
              >
                <Upload className="w-4 h-4" />
                <span>Choose Document (PDF or Text)</span>
              </button>

              <button
                id="btn-toggle-paste"
                type="button"
                onClick={() => setShowPasteMode(!showPasteMode)}
                className="inline-flex items-center space-x-1.5 px-4 py-3 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-sm transition-colors cursor-pointer"
              >
                <FileText className="w-4 h-4 text-slate-500" />
                <span>{showPasteMode ? "Hide Paste Area" : "Or Paste Text Directly"}</span>
              </button>
            </div>

            <div className="mt-3 text-xs text-slate-400">
              Supports: PDF, TXT files containing chemistry experimental sections or reaction data
            </div>

            {/* Direct Text Paste Drawer */}
            {showPasteMode && (
              <div className="mt-6 pt-6 border-t border-slate-200 text-left">
                <label htmlFor="pasted-chem-text" className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-2">
                  Paste Experimental Text / Reaction Procedure:
                </label>
                <textarea
                  id="pasted-chem-text"
                  rows={6}
                  value={pastedText}
                  onChange={(e) => setPastedText(e.target.value)}
                  placeholder="Paste experimental section or reaction text here (e.g. 'To a solution of compound 1... was added... to afford compound 2 in 85% yield')..."
                  className="w-full p-3 text-xs font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-slate-50"
                />
                <div className="mt-2 flex justify-end">
                  <button
                    id="btn-submit-pasted-text"
                    type="button"
                    onClick={handlePasteSubmit}
                    disabled={!pastedText.trim()}
                    className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-xs font-medium rounded-md shadow-xs transition-colors cursor-pointer"
                  >
                    Extract From Pasted Text
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div id="loading-state" className="bg-white border border-slate-200 rounded-xl p-12 text-center shadow-xs">
            <div className="inline-block animate-spin rounded-full h-10 w-10 border-4 border-slate-200 border-t-emerald-600 mb-4" />
            <h3 className="text-base font-semibold text-slate-900 mb-1">
              Extracting Chemical Reactions...
            </h3>
            <p className="text-sm text-slate-500 max-w-sm mx-auto">
              Reading document text and identifying starting materials converting into products.
            </p>
            {selectedFile && (
              <div className="mt-4 inline-flex items-center space-x-2 text-xs text-slate-600 bg-slate-100 px-3 py-1.5 rounded-md">
                <FileText className="w-3.5 h-3.5 text-slate-500" />
                <span>{selectedFile.name}</span>
              </div>
            )}
          </div>
        )}

        {/* Error State */}
        {error && (
          <div id="error-alert" className="mt-4 bg-red-50 border border-red-200 text-red-800 p-4 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm">
            <div className="flex items-start space-x-3">
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <span className="font-semibold">Extraction Notice: </span>
                <span>{error}</span>
              </div>
            </div>
            <div className="flex items-center space-x-2 shrink-0 self-end sm:self-auto">
              {lastPayload && (
                <button
                  id="btn-retry-extraction"
                  type="button"
                  onClick={() => submitExtraction(lastPayload)}
                  className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded-md transition-colors cursor-pointer shadow-xs"
                >
                  Retry Now
                </button>
              )}
              {!showPasteMode && (
                <button
                  id="btn-error-open-paste"
                  type="button"
                  onClick={() => setShowPasteMode(true)}
                  className="px-3 py-1.5 bg-white border border-red-300 hover:bg-red-50 text-red-700 text-xs font-medium rounded-md transition-colors cursor-pointer"
                >
                  Paste Text Instead
                </button>
              )}
            </div>
          </div>
        )}

        {/* Results View */}
        {result && (
          <div id="results-container" className="space-y-6">
            {/* Header info bar */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-1">
                  Extraction Results
                </div>
                <h2 className="text-lg font-semibold text-slate-900">
                  {result.paperTitle || selectedFile?.name || "Uploaded Document"}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Found {result.reactions.length} chemical transformation{result.reactions.length === 1 ? "" : "s"}
                </p>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  id="btn-copy-written-summary"
                  onClick={handleCopyText}
                  className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium transition-colors cursor-pointer"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span className="text-emerald-700">Copied to Clipboard</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy Written Text</span>
                    </>
                  )}
                </button>
                <button
                  id="btn-re-upload"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium transition-colors cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Upload Another Paper</span>
                </button>
              </div>
            </div>

            {/* Reactions List - Written text only */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
                Reaction Conversions (Written Form)
              </h3>

              {result.reactions.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-500 text-sm">
                  No chemical reactions or transformations were detected in the provided text.
                </div>
              ) : (
                result.reactions.map((reaction: ReactionStep, index: number) => (
                  <div
                    key={index}
                    id={`reaction-step-${reaction.step || index + 1}`}
                    className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 shadow-xs hover:border-slate-300 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-3">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                        Reaction {reaction.step || index + 1}
                      </span>
                      {reaction.yield && (
                        <span className="text-xs font-medium text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded-full">
                          Yield: {reaction.yield}
                        </span>
                      )}
                    </div>

                    {/* Transformation Flow: Starting Material -> Product */}
                    <div className="grid grid-cols-1 md:grid-cols-[1fr,auto,1fr] items-center gap-4 py-2">
                      {/* Starting Material Box */}
                      <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                          Starting Material(s)
                        </div>
                        <ul className="space-y-1">
                          {reaction.startingMaterials && reaction.startingMaterials.length > 0 ? (
                            reaction.startingMaterials.map((mat, i) => (
                              <li key={i} className="text-sm font-medium text-slate-900 font-mono">
                                • {mat}
                              </li>
                            ))
                          ) : (
                            <li className="text-sm text-slate-500 italic">Not specified</li>
                          )}
                        </ul>
                      </div>

                      {/* Directional Indicator */}
                      <div className="flex flex-col items-center justify-center py-1 text-emerald-700">
                        <div className="hidden md:flex items-center justify-center w-8 h-8 rounded-full bg-emerald-50 border border-emerald-200">
                          <ArrowRight className="w-4 h-4" />
                        </div>
                        <span className="text-xs font-medium text-emerald-800 mt-1">
                          converts into
                        </span>
                      </div>

                      {/* Product Box */}
                      <div className="bg-emerald-50/40 border border-emerald-200/80 rounded-lg p-4">
                        <div className="text-xs font-semibold text-emerald-800 uppercase tracking-wider mb-1.5">
                          Product(s)
                        </div>
                        <ul className="space-y-1">
                          {reaction.products && reaction.products.length > 0 ? (
                            reaction.products.map((prod, i) => (
                              <li key={i} className="text-sm font-semibold text-emerald-950 font-mono">
                                • {prod}
                              </li>
                            ))
                          ) : (
                            <li className="text-sm text-slate-500 italic">Not specified</li>
                          )}
                        </ul>
                      </div>
                    </div>

                    {/* Written Summary Sentence */}
                    {reaction.summary && (
                      <div className="mt-4 pt-3 border-t border-slate-100 text-sm text-slate-700">
                        <span className="font-semibold text-slate-900">Transformation Summary: </span>
                        <span>{reaction.summary}</span>
                      </div>
                    )}

                    {/* Supplementary Reaction Details (Reagents, Conditions) */}
                    {(reaction.reagentsAndCatalysts || reaction.conditions) && (
                      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs bg-slate-50 p-3 rounded-lg border border-slate-100">
                        {reaction.reagentsAndCatalysts && (
                          <div>
                            <span className="font-semibold text-slate-700">Reagents & Catalysts: </span>
                            <span className="text-slate-600">{reaction.reagentsAndCatalysts}</span>
                          </div>
                        )}
                        {reaction.conditions && (
                          <div>
                            <span className="font-semibold text-slate-700">Conditions: </span>
                            <span className="text-slate-600">{reaction.conditions}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Written Summary Box */}
            {result.rawSummary && (
              <div id="written-summary-card" className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 shadow-xs">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500 mb-2">
                  Complete Written Synthesis Summary
                </h3>
                <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line bg-slate-50 p-4 rounded-lg border border-slate-200 font-sans">
                  {result.rawSummary}
                </p>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Clean Footer */}
      <footer className="border-t border-slate-200 bg-white py-4 text-center text-xs text-slate-500">
        Strictly text-based chemistry extraction • No visual diagrams or image processing
      </footer>
    </div>
  );
}
